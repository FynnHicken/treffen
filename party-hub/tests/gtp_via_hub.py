"""Guess The Price über den Hub: Host startet aus dem Hub, alle landen in derselben Runde des Raums,
mit Namen aus dem Hub. Nur der Hub-Host kann Runden starten (Ticket). Ein Gast lädt mitten im Spiel
neu und behält seine Punkte.

Braucht Hub (Nginx + party-server) und gtp-server/gtp-client mit gleichem TREFFEN_TICKET_SECRET, dann:
    podman run --rm --network=host -v "$PWD/party-hub/tests":/t:ro,z localhost/mono-ui-test \
        python /t/gtp_via_hub.py http://127.0.0.1:8000 [screenshot-ordner]
"""
import asyncio, random, string, sys
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip("/")
SHOTS = sys.argv[2] if len(sys.argv) > 2 else None
ROOM = "GHUB" + "".join(random.choices(string.digits, k=4))
FAILS = []


def ok(c, m):
    print(("  OK  " if c else "  FAIL") + " " + m)
    if not c:
        FAILS.append(m)


async def enter(browser, name, viewport=None):
    c = await browser.new_context(viewport=viewport or {"width": 1280, "height": 860}, locale="de-DE")
    page = await c.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(f"{BASE}/?room={ROOM}")
    await page.fill("#welcomeNicknameInput", name)
    await page.click("#btnWelcomeDirectJoin")
    await page.wait_for_timeout(1200)
    return page, errors


async def gtp(page, text=None, timeout_s=20):
    """Der GTP-Frame im Hub; wartet optional, bis ein Text darin sichtbar ist."""
    for _ in range(timeout_s * 2):
        fr = next((f for f in page.frames if "/price-guess/" in f.url), None)
        if fr:
            try:
                if text is None:
                    await fr.wait_for_selector("body", timeout=500)
                else:
                    await fr.get_by_text(text, exact=False).first.wait_for(state="visible", timeout=500)
                return fr
            except Exception:
                pass
        await page.wait_for_timeout(500)
    return None


async def shot(page, name):
    if SHOTS:
        await page.screenshot(path=f"{SHOTS}/gtp-{name}.png")


async def guess(frame, price):
    await frame.fill("input[aria-label='Preis in Euro']", str(price))
    await frame.get_by_role("button", name="Schätzen").click()


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        host, he = await enter(b, "Lukas")
        guest, ge = await enter(b, "Fynn")
        phone, pe = await enter(b, "Mia", {"width": 390, "height": 844})

        await host.locator('[data-game-id="price_guess"] .game-btn').click()
        await host.click("#stageStartBtn")
        await host.wait_for_timeout(500)
        await host.click("#launchGameBtn")

        fh, fg, fp = await gtp(host, "Wer spielt mit?"), await gtp(guest, "Wer spielt mit?"), await gtp(phone, "Wer spielt mit?")
        ok(fh and fg and fp, "Alle drei landen im Warteraum von Guess The Price")
        if not (fh and fg and fp):
            await shot(host, "fehler-host"); await shot(guest, "fehler-gast")
            return await finish(b, he + ge + pe)

        src = await host.evaluate("document.getElementById('gameIframe').src")
        ok("/price-guess/?room=" in src and "ticket" not in src.split("#")[0], f"Ticket nur im Fragment: {src.split('#')[0]}")
        await host.wait_for_timeout(1500)
        names = await fh.locator("li").all_inner_texts()
        ok(any("Lukas" in n for n in names) and any("Fynn" in n for n in names) and any("Mia" in n for n in names),
           f"Namen kommen aus dem Hub: {names}")
        av = fh.get_by_test_id("gtp-avatar")
        loaded = await av.evaluate_all("els => els.filter(e => e.complete && e.naturalWidth > 0).length")
        ok(await av.count() == 3 and loaded == 3, f"Avatare aus dem Hub im Warteraum ({loaded}/3 geladen)")
        ok(await fh.get_by_test_id("gtp-start").is_visible(), "Hub-Host sieht „Los geht's“")
        ok(not await fg.get_by_test_id("gtp-start").is_visible(), "Gast sieht keinen Start-Knopf")
        await shot(host, "1-warteraum"); await shot(phone, "1-warteraum-handy")

        # Runde 1: alle schätzen
        await fh.get_by_test_id("gtp-start").click()
        for fr, who in ((fh, "Host"), (fg, "Gast"), (fp, "Handy")):
            try:
                await fr.wait_for_selector("input[aria-label='Preis in Euro']", timeout=8000)
                ok(True, f"Produkt erscheint beim {who}")
            except Exception:
                ok(False, f"Produkt erscheint beim {who}")
        await shot(phone, "2-produkt-handy")
        await guess(fh, 100)
        await guess(fg, 250)
        await guess(fp, 999)
        try:
            await fh.get_by_text("Ergebnis der Runde").wait_for(timeout=8000)
            ok(True, "Runde endet, sobald alle geschätzt haben")
        except Exception:
            ok(False, "Runde endet, sobald alle geschätzt haben")
        await shot(host, "3-ergebnis")
        rows = await fh.locator("h3.font-medium").all_inner_texts()
        ok(len([r for r in rows if r.strip()]) >= 3, f"Ergebnis zeigt alle drei: {rows}")
        ok("€" in await fh.locator("body").inner_text(), "Preise in Euro")

        # Gast lädt die Seite neu (Hub neu laden → Spiel läuft weiter, wieder einsteigen) und behält seinen Platz
        await guest.reload()
        # Der Hub steigt nach dem Neuladen von selbst wieder ins laufende Spiel ein (Countdown)
        await gtp(guest, "Ergebnis", 20)
        await fh.get_by_test_id("gtp-next").click()
        fg2 = await gtp(guest, "Deine Schätzung", 15)
        ok(fg2 is not None, "Nach dem Neuladen ist der Gast in der nächsten Runde wieder dabei")

        # Gesamtwertung: Gast hat noch Punkte aus Runde 1 (gleicher Platz, nicht neu angelegt)
        await guess(fh, 120)
        if fg2:
            await guess(fg2, 260)
        await guess(fp, 50)
        await fh.get_by_text("Ergebnis der Runde").wait_for(timeout=8000)
        await fh.get_by_role("button", name="Gesamtwertung").click()
        await fh.get_by_role("dialog").get_by_role("button", name="Gesamtwertung").click()
        await fh.get_by_text("Runden gespielt").wait_for(timeout=8000)
        await shot(host, "4-gesamt")
        body = await fh.locator("body").inner_text()
        ok("2 Runden gespielt" in body, "Gesamtwertung über 2 Runden")
        ok(await fh.get_by_test_id("gtp-avatar").count() >= 3, "Avatare in der Gesamtwertung")
        fynn_entries = body.count("Fynn")
        ok(fynn_entries == 1, f"Fynn steht genau einmal in der Wertung (kein Doppel nach Neuladen): {fynn_entries}")
        ok("Auflösen" not in body, "Im Hub gibt es kein „Auflösen“ (die Gruppe bleibt zusammen)")

        await finish(b, he + ge + pe)


async def finish(b, errors):
    ok(not errors, f"Keine JS-Fehler im Hub ({errors[:2]})")
    await b.close()
    print("\n" + ("❌ %d Fehler" % len(FAILS) if FAILS else "✅ Guess The Price über den Hub bestanden"))
    sys.exit(1 if FAILS else 0)

asyncio.run(main())

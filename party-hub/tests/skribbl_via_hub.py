"""skribbl über den Hub: Host am Rechner, Gast am Handy. Beide landen in derselben Lobby, sehen die
Hub-Avatare in der Spielerliste, melden sich bereit, das Spiel startet auch auf dem Handy, und wer
zeichnet, sieht dort Wortwahl und Werkzeuge.

Braucht Hub (Nginx + party-server) und skribbl mit gleichem TREFFEN_TICKET_SECRET, dann:
    podman run --rm --network=host -v "$PWD/party-hub/tests":/t:ro,z localhost/mono-ui-test \
        python /t/skribbl_via_hub.py http://127.0.0.1:8000 [screenshot-ordner]
"""
import asyncio, random, string, sys
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip("/")
SHOTS = sys.argv[2] if len(sys.argv) > 2 else None
ROOM = "SHUB" + "".join(random.choices(string.digits, k=4))
FAILS = []
PHONE = {"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True}


def ok(c, m):
    print(("  OK  " if c else "  FAIL") + " " + m)
    if not c:
        FAILS.append(m)


async def enter(browser, name, phone=False):
    c = await browser.new_context(**(PHONE if phone else {"viewport": {"width": 1280, "height": 860}}), locale="de-DE")
    page = await c.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(f"{BASE}/?room={ROOM}")
    await page.fill("#welcomeNicknameInput", name)
    await page.click("#btnWelcomeDirectJoin")
    await page.wait_for_timeout(1200)
    return page, errors


async def frame(page, timeout_s=20):
    for _ in range(timeout_s * 2):
        fr = next((f for f in page.frames if "/skribbl/lobby/" in f.url), None)
        if fr:
            try:
                await fr.wait_for_selector("#player-container .player", timeout=500)
                return fr
            except Exception:
                pass
        await page.wait_for_timeout(500)
    return None


async def shot(page, name):
    if SHOTS:
        await page.screenshot(path=f"{SHOTS}/skribbl-{name}.png")


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        host, he = await enter(b, "Lukas")
        phone, pe = await enter(b, "Mia", phone=True)

        await host.locator('[data-game-id="skribbol"] .game-btn').click()
        await host.click("#stageStartBtn")
        await host.wait_for_timeout(500)
        await host.click("#launchGameBtn")

        fh, fp = await frame(host), await frame(phone)
        ok(fh is not None and fp is not None, "Beide landen in der skribbl-Lobby (Handy eingeschlossen)")
        if not (fh and fp):
            await shot(host, "fehler-host"); await shot(phone, "fehler-handy")
            return await finish(b, he + pe)

        src = await host.evaluate("document.getElementById('gameIframe').src")
        ok(src.split("#")[0].count("ticket") == 0, "Ticket nur im Fragment")
        ok(fh.url.split("?")[0] == fp.url.split("?")[0], "Dieselbe Lobby")

        try:
            await fp.wait_for_function(
                "document.querySelectorAll('#player-container img.player-avatar').length === 2 && "
                "[...document.querySelectorAll('#player-container img.player-avatar')].every(i => i.complete && i.naturalWidth > 0)",
                timeout=8000)
            ok(True, "Hub-Avatare in der Spielerliste (Handy)")
        except Exception:
            n = await fp.locator("#player-container img.player-avatar").count()
            ok(False, f"Hub-Avatare in der Spielerliste (Handy): {n}")
        await shot(phone, "1-lobby-handy")

        for fr in (fh, fp):
            await fr.locator("#ready-state-start").click()
        drawer = None
        for _ in range(20):
            for fr, page in ((fh, host), (fp, phone)):
                if await fr.get_by_text("Wähle ein Wort").first.is_visible():
                    drawer = (fr, page)
            if drawer:
                break
            await host.wait_for_timeout(500)
        ok(drawer is not None, "Spiel startet nach „Bereit“ (auch mit Handy)")
        if drawer:
            fr, page = drawer
            await fr.locator("#word-dialog button:visible, .dialog button:visible").first.click()
            await page.wait_for_timeout(1500)
            ok(await fr.locator("#toolbox").is_visible(), "Zeichner sieht die Werkzeuge")
            await shot(page, "2-zeichnen")
        await finish(b, he + pe)


async def finish(b, errors):
    ok(not errors, f"Keine JS-Fehler im Hub ({errors[:2]})")
    await b.close()
    print("\n" + ("❌ %d Fehler" % len(FAILS) if FAILS else "✅ skribbl über den Hub bestanden"))
    sys.exit(1 if FAILS else 0)

asyncio.run(main())

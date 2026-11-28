"""Mau-Mau über den Hub starten: Host (Desktop) wählt Mau-Mau, Gast (Handy) kommt mit, beide sitzen am Kartentisch.
Host per Ticket, Avatare aus dem Hub, Karten verteilt (eigene offen, fremde verdeckt), Versionen stimmen.

Braucht Hub (Nginx + party-server) und den Mau-Mau-Container mit gleichem TREFFEN_TICKET_SECRET, dann:
    podman run --rm --network=host -v "$PWD/party-hub/tests":/t:ro,z localhost/mono-ui-test \
        python /t/maumau_via_hub.py http://127.0.0.1:8000 [Screenshot-Ordner]
"""
import asyncio, random, string, sys
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip("/")
SHOTS = sys.argv[2] if len(sys.argv) > 2 else None
ROOM = "MHUB" + "".join(random.choices(string.digits, k=4))
ARGS = ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
PHONE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
FAILS = []
HAND = lambda seat: f"Object.values(__tisch.client.state.pieces).filter(v => v.field === 'hand-{seat}')"


def ok(c, m):
    print(("  OK  " if c else "  FAIL") + " " + m)
    if not c:
        FAILS.append(m)


async def enter(browser, name, **ctx):
    ctx.setdefault("viewport", {"width": 1280, "height": 860})
    c = await browser.new_context(locale="de-DE", **ctx)
    page = await c.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(f"{BASE}/?room={ROOM}")
    await page.fill("#welcomeNicknameInput", name)
    await page.click("#btnWelcomeDirectJoin")
    await page.wait_for_timeout(1200)
    return page, errors


async def tisch(page):
    for _ in range(60):
        fr = next((f for f in page.frames if "/maumau/" in f.url), None)
        if fr:
            try:
                await fr.wait_for_function("window.__tisch && __tisch.client.state && __tisch.client.me", timeout=1000)
                return fr
            except Exception:
                pass
        await page.wait_for_timeout(500)
    return None


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=ARGS)
        host, he = await enter(b, "Lukas")
        guest, ge = await enter(b, "Fynn", **PHONE)
        ok(await host.locator('[data-game-id="maumau"]').is_visible(), "Hub zeigt die Mau-Mau-Kachel")
        await host.locator('[data-game-id="maumau"] .game-btn').click()
        await host.click("#stageStartBtn")
        await host.wait_for_timeout(500)
        await host.click("#launchGameBtn")
        ft, fg = await tisch(host), await tisch(guest)
        ok(ft is not None and fg is not None, "Beide sitzen nach dem Start am Kartentisch (iframe /maumau/), Gast am Handy")
        if ft and fg:
            src = await host.evaluate("document.getElementById('gameIframe').src")
            ok("/maumau/?room=" in src and "ticket" not in src.split("#")[0], f"Ticket nur im Fragment: {src.split('#')[0]}")
            await host.wait_for_timeout(1000)
            ok(await ft.evaluate("__tisch.client.isHost") is True, "Hub-Host ist am Tisch Host (Ticket)")
            ok(await fg.evaluate("__tisch.client.isHost") is False, "Gast ist am Tisch kein Host")
            v = await ft.evaluate("__tisch.client.versions")
            ok(v.get("client") == v.get("server"), f"Engine-Versionen Client = Server: {v}")
            await ft.wait_for_function("__tisch.labels.avatarShown().filter(Boolean).length === 2", timeout=8000)
            ok(True, "Avatare auf beiden Platzschildern")
            await ft.click("#start-btn")
            await ft.wait_for_function("__tisch.client.state.status === 'playing'", timeout=10000)
            gseat = await fg.evaluate("__tisch.client.me.seat")
            hseat = await ft.evaluate("__tisch.client.me.seat")
            await fg.wait_for_function(f"{HAND(gseat)}.length === 5", timeout=10000)
            ok(await fg.evaluate(f"{HAND(gseat)}.every(v => v.show)"), "Gast sieht die eigenen 5 Karten")
            ok(await fg.evaluate(f"{HAND(hseat)}.every(v => !v.show)"), "… die des Hosts bleiben verdeckt")
            if SHOTS:
                await guest.wait_for_timeout(1500)
                await guest.screenshot(path=f"{SHOTS}/maumau-hub-handy.png")
        ok(not he and not ge, f"Keine JS-Fehler im Hub ({(he + ge)[:2]})")
        await b.close()
    print("\n" + ("❌ %d Fehler" % len(FAILS) if FAILS else "✅ Mau-Mau über den Hub bestanden"))
    sys.exit(1 if FAILS else 0)

asyncio.run(main())

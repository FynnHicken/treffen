"""Mensch ärgere dich nicht über den Hub starten: Host wählt das Spiel, beide landen am 3D-Tisch,
der Hub-Host ist dort per signiertem Ticket Host, der Gast nicht.

Braucht Hub (Nginx + party-server) und den Mensch-Container mit gleichem TREFFEN_TICKET_SECRET, dann:
    podman run --rm --network=host -v "$PWD/party-hub/tests":/t:ro,z localhost/mono-ui-test \
        python /t/mensch_via_hub.py http://127.0.0.1:8000
"""
import asyncio, random, string, sys
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip("/")
ROOM = "MHUB" + "".join(random.choices(string.digits, k=4))
ARGS = ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
FAILS = []


def ok(c, m):
    print(("  OK  " if c else "  FAIL") + " " + m)
    if not c:
        FAILS.append(m)


async def enter(browser, name, **ctx):
    c = await browser.new_context(viewport={"width": 1280, "height": 860}, locale="de-DE", **ctx)
    page = await c.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(f"{BASE}/?room={ROOM}")
    await page.fill("#welcomeNicknameInput", name)
    await page.click("#btnWelcomeDirectJoin")
    await page.wait_for_timeout(1200)
    return page, errors


async def tisch(page):
    """Der Mensch-Tisch im iframe des Hubs (wartet, bis er verbunden ist)."""
    for _ in range(60):
        fr = next((f for f in page.frames if "/mensch/" in f.url), None)
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
        guest, ge = await enter(b, "Fynn")
        ok(await host.locator('[data-game-id="mensch"]').is_visible(), "Hub zeigt die Mensch-Kachel")
        await host.locator('[data-game-id="mensch"] .game-btn').click()
        await host.click("#stageStartBtn")
        await host.wait_for_timeout(500)
        await host.click("#launchGameBtn")
        ft, fg = await tisch(host), await tisch(guest)
        ok(ft is not None and fg is not None, "Beide sitzen nach dem Start am 3D-Tisch (iframe /mensch/)")
        if ft and fg:
            src = await host.evaluate("document.getElementById('gameIframe').src")
            ok("/mensch/?room=" in src and "ticket" not in src.split("#")[0], f"Ticket nur im Fragment: {src.split('#')[0]}")
            await host.wait_for_timeout(1000)
            ok(await ft.evaluate("__tisch.client.isHost") is True, "Hub-Host ist am Tisch Host (Ticket)")
            ok(await fg.evaluate("__tisch.client.isHost") is False, "Gast ist am Tisch kein Host")
            names = await ft.evaluate("__tisch.client.state.members.map(m => [m.name, m.seat])")
            ok(sorted(n for n, _ in names) == ["Fynn", "Lukas"] and len({s for _, s in names}) == 2, f"Namen aus dem Hub, eigene Plätze: {names}")
            ok(await ft.is_visible("#start-btn") and not await fg.is_visible("#start-btn"), "Nur der Host sieht „Spiel starten“")
        ok(not he and not ge, f"Keine JS-Fehler im Hub ({(he + ge)[:2]})")
        await b.close()
    print("\n" + ("❌ %d Fehler" % len(FAILS) if FAILS else "✅ Mensch über den Hub bestanden"))
    sys.exit(1 if FAILS else 0)

asyncio.run(main())

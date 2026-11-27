"""Schach über den Hub starten: Host (Desktop) wählt Schach, Gast (Handy) kommt mit, beide sitzen am 3D-Tisch.
Host per Ticket, Avatare aus dem Hub, Partie läuft (Zug des Hosts kommt beim Gast an), Versionen stimmen.

Braucht Hub (Nginx + party-server) und den Schach-Container mit gleichem TREFFEN_TICKET_SECRET, dann:
    podman run --rm --network=host -v "$PWD/party-hub/tests":/t:ro,z localhost/mono-ui-test \
        python /t/schach_via_hub.py http://127.0.0.1:8000 [Screenshot-Ordner]
"""
import asyncio, random, string, sys
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip("/")
SHOTS = sys.argv[2] if len(sys.argv) > 2 else None
ROOM = "SHUB" + "".join(random.choices(string.digits, k=4))
ARGS = ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
PHONE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
FAILS = []


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
        fr = next((f for f in page.frames if "/schach/" in f.url), None)
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
        ok(await host.locator('[data-game-id="schach"]').is_visible(), "Hub zeigt die Schach-Kachel")
        await host.locator('[data-game-id="schach"] .game-btn').click()
        await host.click("#stageStartBtn")
        await host.wait_for_timeout(500)
        await host.click("#launchGameBtn")
        ft, fg = await tisch(host), await tisch(guest)
        ok(ft is not None and fg is not None, "Beide sitzen nach dem Start am Schachtisch (iframe /schach/), Gast am Handy")
        if ft and fg:
            src = await host.evaluate("document.getElementById('gameIframe').src")
            ok("/schach/?room=" in src and "ticket" not in src.split("#")[0], f"Ticket nur im Fragment: {src.split('#')[0]}")
            await host.wait_for_timeout(1000)
            ok(await ft.evaluate("__tisch.client.isHost") is True, "Hub-Host ist am Tisch Host (Ticket)")
            ok(await fg.evaluate("__tisch.client.isHost") is False, "Gast ist am Tisch kein Host")
            seats = await ft.evaluate("__tisch.client.state.members.map(m => [m.name, m.seat])")
            ok(sorted(s for _, s in seats) == [0, 1], f"Einer Weiß, einer Schwarz (wer zuerst da ist, sitzt vorn): {seats}")
            white, black = (ft, fg) if dict(seats)["Lukas"] == 0 else (fg, ft)
            v = await ft.evaluate("__tisch.client.versions")
            ok(v.get("client") == v.get("server") and v.get("rulesApi") == 2, f"Engine-Versionen Client = Server: {v}")
            await ft.wait_for_function("__tisch.labels.avatarShown().filter(Boolean).length === 2", timeout=8000)
            ok(True, "Avatare auf beiden Platzschildern")
            await ft.click("#start-btn")
            await ft.wait_for_function("__tisch.client.state.status === 'playing'", timeout=10000)
            await white.evaluate("""(() => { const s = __tisch.client.state; const id = Object.keys(s.pieces).find(k => s.pieces[k].field === 'e2');
                __tisch.client.grab(id); __tisch.client.drop(id, 'e4'); })()""")
            await black.wait_for_function("__tisch.client.myTurn && __tisch.client.state.pieces['w-P-e2'].field === 'e4'", timeout=10000)
            ok(True, "Zug von Weiß kommt beim Gegenüber an, Schwarz ist am Zug")
            if SHOTS:
                await guest.wait_for_timeout(1500)
                await guest.screenshot(path=f"{SHOTS}/schach-hub-handy.png")
        ok(not he and not ge, f"Keine JS-Fehler im Hub ({(he + ge)[:2]})")
        await b.close()
    print("\n" + ("❌ %d Fehler" % len(FAILS) if FAILS else "✅ Schach über den Hub bestanden"))
    sys.exit(1 if FAILS else 0)

asyncio.run(main())

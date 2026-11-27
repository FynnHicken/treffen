"""Browser-Test der Bretter für 6 und 8 Spieler (Engine 2.1, Spielvarianten): Brett wechselt in der Lobby,
Platzschilder passen, Computer spielen, Screenshots am Rechner und am Handy.

    podman run --rm --network=host -v "$PWD/games/mensch":/work:z -w /work localhost/mono-ui-test \
        python tests/ui/boards_smoke.py http://127.0.0.1:8095 /work/tests/ui/shots
"""
import asyncio, os, random, string, sys
from playwright.async_api import async_playwright

BASE, OUT = sys.argv[1].rstrip("/"), sys.argv[2]
os.makedirs(OUT, exist_ok=True)
FAILS = []
ARGS = ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
PHONE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)


def ok(c, m):
    print(("  OK  " if c else "  FAIL") + " " + m)
    if not c:
        FAILS.append(m)


async def until(page, js, timeout=15):
    for _ in range(int(timeout * 10)):
        if await page.evaluate(js):
            return True
        await asyncio.sleep(0.1)
    return False


async def main():
    room = "B" + "".join(random.choices(string.digits, k=5))
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(args=ARGS)
        host_ctx = await browser.new_context(locale="de-DE", viewport={"width": 1280, "height": 800})
        host = await host_ctx.new_page()
        errors = []
        host.on("pageerror", lambda e: errors.append(str(e)))
        await host.goto(f"{BASE}/?room={room}&name=Gastgeber")
        ok(await until(host, "window.__tisch?.client?.state?.game?.variant === '4'"), "Start: klassisches Brett (automatisch)")
        guest_ctx = await browser.new_context(locale="de-DE", **PHONE)
        guest = await guest_ctx.new_page()
        await guest.goto(f"{BASE}/?room={room}&name=Handy")
        ok(await until(guest, "window.__tisch?.client?.me?.seat != null"), "Handy sitzt")

        for n in (6, 8):
            await host.evaluate(f"window.__tisch.client.setSettings({{variant: '{n}'}})")
            ok(await until(host, f"window.__tisch.client.state.game.seats === {n}"), f"Host wählt {n}er-Brett")
            ok(await until(guest, f"window.__tisch.client.state.game.seats === {n} && window.__tisch.table.seats === {n}"),
               f"Handy sieht {n} Plätze")
            ok(await host.evaluate(f"window.__tisch.labels.texts().length === {n}"), f"{n} Platzschilder")
            ok(await host.evaluate(f"Object.keys(window.__tisch.client.state.layout.fields).length === {n * 18}"),
               f"{n * 18} Felder")
            for s in range(2, n):
                await host.evaluate(f"window.__tisch.client.addBot({s})")
            ok(await until(host, f"window.__tisch.client.state.members.filter(m => m.seat !== null).length === {n}"),
               f"{n} Plätze besetzt")
            await asyncio.sleep(1.2)
            await host.screenshot(path=f"{OUT}/brett{n}_lobby.png")
            await guest.screenshot(path=f"{OUT}/brett{n}_handy.png")
            if n == 8:
                break
            for s in range(2, n):
                await host.evaluate(f"window.__tisch.client.removeBot({s})")
            await until(host, "window.__tisch.client.state.members.filter(m => m.seat !== null).length === 2")

        # Beide Menschen schauen zu, Computer spielen alle 8 Plätze (feste Wahl: das Brett bleibt)
        await guest.evaluate("window.__tisch.client.stand()")
        await host.evaluate("window.__tisch.client.stand()")
        await until(host, "window.__tisch.client.state.members.filter(m => m.seat !== null).length === 6")
        for s in (0, 1):
            await host.evaluate(f"window.__tisch.client.addBot({s})")
        ok(await until(host, "window.__tisch.client.state.members.filter(m => m.is_bot).length === 8"
                             " && window.__tisch.client.state.game.seats === 8"), "8 Computer, Brett bleibt")
        await host.evaluate("window.__tisch.client.start()")
        ok(await until(host, "window.__tisch.client.state.status === 'playing'"), "8er-Partie läuft")
        moved = await until(host, """Object.values(window.__tisch.client.state.pieces).some(p => !p.field.startsWith('h-'))""", 60)
        ok(moved, "Computer bringen Figuren aufs Brett")
        await asyncio.sleep(1.5)
        await host.screenshot(path=f"{OUT}/brett8_spiel.png")
        await guest.screenshot(path=f"{OUT}/brett8_spiel_handy.png")
        v = await host.evaluate("document.getElementById('versions').textContent")
        ok("Mensch 1.1.0" in v and "Spieltisch 2.1.0" in v, f"Versionszeile: {v}")
        ok(not errors, f"keine JS-Fehler {errors[:2]}")
        await browser.close()
    print()
    if FAILS:
        print(f"❌ {len(FAILS)} Fehler")
        sys.exit(1)
    print("✅ Bretter 6/8 im Browser ok")


asyncio.run(main())

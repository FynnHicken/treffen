"""Browser-Test der Schach-Spielarten (Teamschach, Tandem, Vierschach): Wechsel in der Lobby, Plätze, Bretter,
Computer-Partien, ein echter Zug je Spielart, Screenshots am Rechner und am Handy.

    podman run --rm --network=host -v "$PWD/games/schach":/work:z -w /work localhost/mono-ui-test \
        python tests/ui/variants_smoke.py http://127.0.0.1:8096 /work/tests/ui/shots
"""
import asyncio, os, random, string, sys
from playwright.async_api import async_playwright

BASE, OUT = sys.argv[1].rstrip("/"), sys.argv[2]
os.makedirs(OUT, exist_ok=True)
FAILS = []
ARGS = ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
PHONE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
T = "window.__tisch"


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


async def own_move(page, timeout=20):
    """Wartet, bis dieser Spieler am Zug ist, und setzt die erste erlaubte Figur per Zug am Tisch (GRAB + DROP)."""
    if not await until(page, f"{T}.client.myTurn && ({T}.client.state.play.moves || []).length > 0", timeout):
        return None
    mv = await page.evaluate(f"{T}.client.state.play.moves[0]")
    await page.evaluate(f"{T}.client.grab('{mv['piece']}'); {T}.client.drop('{mv['piece']}', '{mv['to']}')")
    moved = await until(page, f"{T}.client.state.pieces['{mv['piece']}'].field === '{mv['to']}'", 5)
    return mv if moved else None


async def main():
    room = "V" + "".join(random.choices(string.digits, k=5))
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(args=ARGS)
        host = await (await browser.new_context(locale="de-DE", viewport={"width": 1280, "height": 800})).new_page()
        errors = []
        host.on("pageerror", lambda e: errors.append(str(e)))
        await host.goto(f"{BASE}/?room={room}&name=Gastgeber")
        ok(await until(host, f"{T}?.client?.state?.game?.variant === 'klassisch'"), "Start: klassisch")
        guest = await (await browser.new_context(locale="de-DE", **PHONE)).new_page()
        guest.on("pageerror", lambda e: errors.append(str(e)))
        await guest.goto(f"{BASE}/?room={room}&name=Handy")
        ok(await until(guest, f"{T}?.client?.me?.seat === 1"), "Handy sitzt auf Platz 2")

        for variant, fields in (("team", 64), ("tandem", 128), ("vierer", 160)):
            print(f"== {variant} ==")
            await host.evaluate(f"{T}.client.setSettings({{variant: '{variant}'}})")
            ok(await until(guest, f"{T}.client.state.game.variant === '{variant}' && {T}.table.seats === 4"),
               f"{variant}: Handy sieht 4 Plätze")
            n = await host.evaluate(f"Object.values({T}.client.state.layout.fields).filter(f => f.kind === 'square').length")
            ok(n == fields, f"{variant}: {fields} Felder ({n})")
            for s in (2, 3):
                await host.evaluate(f"{T}.client.addBot({s})")
            ok(await until(host, f"{T}.client.state.members.filter(m => m.seat !== null).length === 4"), f"{variant}: 4 Plätze besetzt")
            await asyncio.sleep(1)
            await host.screenshot(path=f"{OUT}/{variant}_lobby.png")
            await host.evaluate(f"{T}.client.start()")
            ok(await until(host, f"{T}.client.state.status === 'playing'"), f"{variant}: Partie läuft")
            mv = await own_move(host)
            ok(mv is not None, f"{variant}: Gastgeber zieht am Tisch ({mv})")
            mv = await own_move(guest, 30)
            ok(mv is not None, f"{variant}: Handy zieht am Tisch ({mv})")
            await asyncio.sleep(2.5)
            await host.screenshot(path=f"{OUT}/{variant}_spiel.png")
            await guest.screenshot(path=f"{OUT}/{variant}_handy.png")
            status = await host.evaluate("document.getElementById('status').textContent")
            ok(bool(status.strip()), f"{variant}: Statuszeile „{status.strip()[:70]}“")
            # zurück in die Lobby für die nächste Spielart
            await host.evaluate(f"{T}.client.newRound()")
            await until(host, f"{T}.client.state.status === 'lobby'")
            for s in (2, 3):
                await host.evaluate(f"{T}.client.removeBot({s})")
            await until(host, f"{T}.client.state.members.filter(m => m.seat !== null).length === 2")

        print("== Tandem nur mit Computern (Einsetzen aus dem Vorrat) ==")
        await host.evaluate(f"{T}.client.setSettings({{variant: 'tandem'}})")
        await until(host, f"{T}.client.state.game.variant === 'tandem'")
        await guest.evaluate(f"{T}.client.stand()")
        await host.evaluate(f"{T}.client.stand()")
        await until(host, f"{T}.client.state.members.filter(m => m.seat !== null).length === 0")
        for s in range(4):
            await host.evaluate(f"{T}.client.addBot({s})")
        await until(host, f"{T}.client.state.members.filter(m => m.is_bot).length === 4")
        await host.evaluate(f"window.__drops = 0; {T}.client.onEvent(e => {{ if (e.reason === 'drop') window.__drops++; }}); 0")
        dropped = False
        for _ in range(3):                    # endet eine Partie ohne Einsetzen (schnelles Matt), nächste Runde
            await host.evaluate(f"{T}.client.start()")
            await until(host, f"{T}.client.state.status === 'playing'")
            dropped = await until(host, f"window.__drops > 0 || {T}.client.state.status === 'finished'", 150)
            dropped = await host.evaluate("window.__drops > 0")
            if dropped:
                break
            await host.evaluate(f"{T}.client.newRound()")
            await until(host, f"{T}.client.state.status === 'lobby'")
        ok(dropped, "Computer setzen geschlagene Figuren aus dem Vorrat ein")
        await asyncio.sleep(1.5)
        await host.screenshot(path=f"{OUT}/tandem_computer.png")
        ok(not errors, f"keine JS-Fehler {errors[:2]}")
        await browser.close()
    print()
    if FAILS:
        print(f"❌ {len(FAILS)} Fehler")
        sys.exit(1)
    print("✅ Schach-Spielarten im Browser ok")


asyncio.run(main())

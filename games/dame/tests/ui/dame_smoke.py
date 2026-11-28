"""Browser-Test Dame – zugleich Test der Spieltisch-App (Engine 2.3): Standard-Oberfläche, Standard-Brett und
-Steine, Statuszeile aus `say`, Markierungen aus `marks`, Hinweise (NOTE), Siegerehrung.

    podman run --rm --network=host -v "$PWD/games/dame":/work:z -w /work localhost/mono-ui-test \
        python tests/ui/dame_smoke.py http://127.0.0.1:8097 /work/tests/ui/shots
"""
import asyncio, os, random, string, sys
from playwright.async_api import async_playwright

BASE, OUT = sys.argv[1].rstrip("/"), sys.argv[2]
os.makedirs(OUT, exist_ok=True)
ROOM = "D" + "".join(random.choices(string.digits, k=5))
FAILS = []
ARGS = ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
PHONE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
T = "window.__tisch"


def ok(c, m):
    print(("  OK  " if c else "  FAIL") + " " + m)
    if not c:
        FAILS.append(m)


async def open_player(browser, name, room, **ctx):
    c = await browser.new_context(locale="de-DE", **ctx)
    p = await c.new_page()
    errs = []
    p.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    p.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    await p.goto(f"{BASE}/?room={room}&name={name}")
    await p.wait_for_function(f"{T} && {T}.client.state", timeout=15000)
    return p, errs


async def until(page, cond, sec=20):
    try:
        await page.wait_for_function(cond, timeout=sec * 1000)
        return True
    except Exception:
        return False


async def drag(page, piece, field):
    src = await page.evaluate(f"{T}.pieces.screenPos('{piece}')")
    dst = await page.evaluate(f"{T}.pieces.fieldScreenPos('{field}')")
    await page.mouse.move(src["x"], src["y"])
    await page.mouse.down()
    for i in range(1, 13):
        await page.mouse.move(src["x"] + (dst["x"] - src["x"]) * i / 12, src["y"] + (dst["y"] - src["y"]) * i / 12)
        await page.wait_for_timeout(25)
    await page.mouse.up()


async def tap(page, x, y):
    await page.touchscreen.tap(x, y)


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(args=ARGS)
        anna, ea = await open_player(browser, "Anna", ROOM, viewport={"width": 1280, "height": 800})
        ben, eb = await open_player(browser, "Ben", ROOM, **PHONE)
        await until(anna, f"{T}.client.state.members.length === 2")
        ok(await anna.evaluate("document.title") == "Dame", "Oberfläche von der Engine (Titel)")
        lobby = await anna.inner_text("#status")
        ok("Weiß vorn" in lobby, f"Lobby-Satz der Variante: „{lobby[:60]}“")
        ok(await anna.evaluate(f"{T}.board !== null && {T}.pieces.kindOf('w0') === 'disc'"), "Standard-Brett + Steine")
        await anna.click("#start-btn")
        ok(await until(anna, f"{T}.client.state.status === 'playing'"), "Partie läuft")
        st = await anna.inner_text("#status")
        ok("Du bist am Zug (Weiß)" in st, f"Statuszeile Standard: „{st}“")
        ok("Geschlagen" in st, "… mit Punkten (scores)")
        bst = await ben.inner_text("#status")
        ok("Anna" in bst and "Weiß" in bst, f"Ben sieht, wer zieht: „{bst[:60]}“")
        await anna.screenshot(path=f"{OUT}/dame_start.png")

        # Weiß c3 → d4 (ziehen)
        piece = await anna.evaluate(f"Object.entries({T}.client.state.pieces).find(([k, v]) => v.field === 'c3')[0]")
        await drag(anna, piece, "d4")
        ok(await until(anna, f"{T}.client.state.pieces['{piece}'].field === 'd4'"), f"Anna zieht {piece} c3 → d4")
        ok(await until(anna, f"{T}.marks.count === 2"), "letzter Zug markiert (2 Felder)")
        # Ben (Handy): f6 → e5 – Stein antippen, dann Ziel antippen
        await until(ben, f"{T}.client.myTurn")
        bp = await ben.evaluate(f"Object.entries({T}.client.state.pieces).find(([k, v]) => v.field === 'f6')[0]")
        targets = await ben.evaluate(f"{T}.client.legalTargets('{bp}')")
        sp = await ben.evaluate(f"{T}.pieces.screenPos('{bp}')")
        await tap(ben, sp["x"], sp["y"])
        if len(targets) > 1:
            await until(ben, f"{T}.pieces.selectedId() === '{bp}'", 5)
            dst = await ben.evaluate(f"{T}.pieces.fieldScreenPos('e5')")
            await tap(ben, dst["x"], dst["y"])
        ok(await until(ben, f"{T}.client.state.pieces['{bp}'].field !== 'f6'"), f"Ben zieht per Antippen ({targets})")
        # Weiß d4 kann jetzt schlagen? (e5 oder f5 besetzt) → Schlagzwang in der Statuszeile
        await until(anna, f"{T}.client.myTurn")
        st = await anna.inner_text("#status")
        ok("musst schlagen" in st, f"Schlagzwang angezeigt: „{st[:40]}“")
        await anna.screenshot(path=f"{OUT}/dame_zug.png")
        await ben.screenshot(path=f"{OUT}/dame_handy.png")

        # Engine 2.6: Schachuhr + Zug zurücknehmen (mit Zustimmung)
        await anna.evaluate(f"{T}.client.newRound()")
        await until(anna, f"{T}.client.state.status === 'lobby'")
        await anna.evaluate(f"{T}.client.setSettings({{clock: 5, undo: true}})")
        await until(anna, f"{T}.client.state.settings.clock === 5 && {T}.client.state.settings.undo === true")
        await anna.click("#start-btn")
        ok(await until(anna, f"{T}.client.state.status === 'playing' && !!{T}.client.state.play.clock"), "Partie mit Uhr")
        ok(await until(anna, f"{T}.clock.active && {T}.clock.remaining(0) < 300"), "Weiß' Uhr läuft")
        ok(await until(anna, "document.querySelector('#status .tt-clock')?.textContent.includes('⏱')"), "eigene Zeit in der Statuszeile")
        await until(anna, f"{T}.pieces.isResting()", 10)             # Steine sind nach dem Aufbau zurückgehüpft
        piece = await anna.evaluate(f"Object.entries({T}.client.state.pieces).find(([k, v]) => v.field === 'c3')[0]")
        await drag(anna, piece, "d4")
        ok(await until(anna, f"{T}.client.state.pieces['{piece}'].field === 'd4'"), "Zug gemacht")
        ok(await until(anna, f"{T}.client.state.play.clock.running[0] === 1"), "Uhr gedrückt: jetzt läuft Schwarz")
        await anna.screenshot(path=f"{OUT}/dame_uhr.png")
        ok(await until(anna, "document.querySelector('#acts button[data-undo]') !== null"), "Knopf „Zurücknehmen“")
        await anna.click("#acts button[data-undo]")
        ok(await until(ben, "document.querySelector('#acts button[data-undo-yes]') !== null"), "Ben wird gefragt")
        await ben.screenshot(path=f"{OUT}/dame_zuruecknehmen_handy.png")
        await ben.tap("#acts button[data-undo-yes]")
        ok(await until(anna, f"{T}.client.state.pieces['{piece}'].field === 'c3'"), "Ben stimmt zu → Stein wieder auf c3")
        ok(await until(anna, f"{T}.client.myTurn"), "Weiß ist wieder dran")

        # Engine 2.7: Reaktion am Platz + Verlauf
        await ben.tap(".talk-btn[data-open='bar']")
        await ben.tap(".talk-bar button[data-emoji='👍']")
        ok(await until(anna, "[...document.querySelectorAll('.talk-float')].some(e => e.textContent === '👍' && e.dataset.who === 'Ben')", 5),
           "Bens 👍 steigt bei Anna über seinem Platz auf")
        await anna.click(".talk-btn[data-open='log']")
        log = await anna.inner_text(".talk-log")
        ok("c3 → d4" in log and "zurück" in log, f"Verlauf: Zug und Zurücknehmen ({log[:80]!r})")
        await anna.screenshot(path=f"{OUT}/dame_verlauf.png")
        await anna.click(".talk-btn[data-open='log']")

        # Gegen den Computer bis zum Ende
        await anna.evaluate(f"{T}.client.newRound()")
        c2, ec = await open_player(browser, "Cara", ROOM + "C", viewport={"width": 1100, "height": 760})
        await c2.evaluate(f"{T}.client.stand()")
        await until(c2, f"{T}.client.state.members[0].seat === null")
        await c2.evaluate(f"{T}.client.addBot(0); {T}.client.addBot(1)")
        await until(c2, f"{T}.client.state.members.length === 3")
        await c2.click("#start-btn")
        ok(await until(c2, f"{T}.client.state.status === 'playing'"), "Computer gegen Computer läuft")
        done = await until(c2, f"{T}.client.state.status === 'finished'", 240)
        ok(done, "Partie endet")
        if done:
            over = await c2.inner_text("#gameover")
            ok(("gewinnt" in over or "Unentschieden" in over) and "Neue Partie" in over, f"Siegerehrung: „{over[:60]}“")
            await c2.screenshot(path=f"{OUT}/dame_ende.png")
        ok(not (ea + eb + ec), f"keine JS-Fehler {(ea + eb + ec)[:3]}")
        await browser.close()
    print()
    if FAILS:
        print(f"❌ {len(FAILS)} Fehler")
        sys.exit(1)
    print("✅ Dame im Browser bestanden")

asyncio.run(main())

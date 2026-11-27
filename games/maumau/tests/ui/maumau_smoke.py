"""Browser-Test Mau-Mau – zugleich Test der Karten-Bausteine (Engine 2.4): Stapel, Hände (eigene offen, fremde
verdeckt), Karte antippen = legen, Stapel antippen = ziehen, Knöpfe der Regeln (Farbe wünschen), Computer-Partie.

    podman run --rm --network=host -v "$PWD/games/maumau":/work:z -w /work localhost/mono-ui-test \
        python tests/ui/maumau_smoke.py http://127.0.0.1:8098 /work/tests/ui/shots
"""
import asyncio, os, random, string, sys
from playwright.async_api import async_playwright

BASE, OUT = sys.argv[1].rstrip("/"), sys.argv[2]
os.makedirs(OUT, exist_ok=True)
ROOM = "M" + "".join(random.choices(string.digits, k=5))
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


async def tap_piece(page, pid, touch=False):
    await until(page, f"{T}.pieces.isResting()", 10)
    p = await page.evaluate(f"{T}.pieces.screenPos('{pid}')")
    if touch:
        await page.touchscreen.tap(p["x"], p["y"])
    else:
        await page.mouse.click(p["x"], p["y"])


HAND = lambda seat: f"Object.entries({T}.client.state.pieces).filter(([k, v]) => v.field === 'hand-{seat}')"


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(args=ARGS)
        anna, ea = await open_player(browser, "Anna", ROOM, viewport={"width": 1280, "height": 800})
        ben, eb = await open_player(browser, "Ben", ROOM, **PHONE)
        await until(anna, f"{T}.client.state.members.length === 2")
        await anna.click("#start-btn")
        ok(await until(anna, f"{T}.client.state.status === 'playing'"), "Partie läuft")
        await until(anna, f"{HAND(0)}.length === 5 && {T}.pieces.isResting()", 15)
        mine = await anna.evaluate(f"{HAND(0)}.map(([k, v]) => v.show)")
        ok(len(mine) == 5 and all(mine), f"Anna sieht ihre 5 Karten ({mine})")
        theirs = await anna.evaluate(f"{HAND(1)}.map(([k, v]) => v.show || null)")
        ok(len(theirs) == 5 and not any(theirs), "Bens Karten bleiben für Anna verdeckt")
        ben_sees = await ben.evaluate(f"{HAND(0)}.map(([k, v]) => v.show || null)")
        ok(not any(ben_sees), "… und Annas für Ben")
        pile = await anna.evaluate(f"Object.values({T}.client.state.pieces).find(v => v.field === 'pile').show")
        ok(bool(pile), f"Ablage offen: {pile}")
        await anna.screenshot(path=f"{OUT}/maumau_start.png")
        await ben.screenshot(path=f"{OUT}/maumau_handy.png")

        # Anna: passende Karte antippen – oder Stapel antippen
        moves = await anna.evaluate(f"{T}.client.state.play.moves")
        play = next((m for m in moves if m["to"] == "pile"), None)
        n_before = len(mine)
        if play:
            await tap_piece(anna, play["piece"])
            ok(await until(anna, f"{T}.client.state.pieces['{play['piece']}'].field === 'pile'"), "Karte antippen = legen")
        else:
            draw = next(m for m in moves if m["to"] == "hand-0")
            await tap_piece(anna, draw["piece"])
            ok(await until(anna, f"{HAND(0)}.length === {n_before + 1}"), "Stapel antippen = ziehen")
            ok(await until(anna, "document.querySelector('#acts button') !== null"), "Knopf „Weiter“ erscheint")
            again = await anna.evaluate(f"({T}.client.state.play.moves || []).find(m => m.to === 'pile') || null")
            if again:                                   # gezogene Karte passt → legen
                await tap_piece(anna, again["piece"])
                await until(anna, f"{T}.client.state.pieces['{again['piece']}'].field === 'pile'")
            else:
                await anna.click("#acts button")
        if await until(anna, f"{T}.client.state.play.phase === 'wish'", 2):
            ok(await anna.evaluate("document.querySelectorAll('#acts button').length === 4"), "Bube: vier Farb-Knöpfe")
            await anna.click("#acts button")
        # durch: Ben ist dran – oder Anna nochmal, weil sie eine 8 gelegt hat (zu zweit setzt Ben dann aus)
        ok(await until(anna, f"{T}.client.state.play.turn === 1 || (!{T}.client.state.play.drawn && "
                             f"Object.values({T}.client.state.pieces).filter(v => v.field === 'pile')"
                             f".sort((a, b) => b.order - a.order)[0].show.endsWith('8'))", 10), "Zug ist durch")
        await until(ben, f"{T}.client.myTurn", 10)
        await ben.screenshot(path=f"{OUT}/maumau_handy_zug.png")
        st = await ben.inner_text("#status")
        ok("Du" in st or "dran" in st or "zieh" in st, f"Ben: „{st[:60]}“")

        # Freies Spiel (Engine 2.5): Hausregel an → alle dürfen alles, Doppeltipp dreht um, Stapel mischen
        R2 = ROOM + "F"
        fa, efa = await open_player(browser, "Fritz", R2, viewport={"width": 1100, "height": 760})
        fb, efb = await open_player(browser, "Greta", R2, **PHONE)
        await until(fa, f"{T}.client.state.members.length === 2")
        await fa.evaluate(f"{T}.client.setSettings({{free: true}})")
        await until(fa, f"{T}.client.state.settings.free === true")
        await fa.click("#start-btn")
        ok(await until(fb, f"{T}.client.state.play && {T}.client.state.play.free === true"), "Freies Spiel läuft")
        st = await fb.inner_text("#status")
        ok("Freies Spiel" in st, f"Statuszeile: „{st[:50]}“")
        # Greta (Handy) nimmt eine Karte aus Fritz' Hand und legt sie auf die Ablage (antippen, Ziel antippen)
        await until(fb, f"{T}.pieces.isResting()", 10)
        steal = await fb.evaluate(f"{HAND(0)}[0][0]")
        await tap_piece(fb, steal, touch=True)
        ok(await until(fb, f"{T}.pieces.selectedId() === '{steal}'", 5), "fremde Karte angehoben (freies Spiel)")
        dst = await fb.evaluate(f"{T}.pieces.fieldScreenPos('pile')")
        await fb.touchscreen.tap(dst["x"], dst["y"])
        ok(await until(fb, f"{T}.client.state.pieces['{steal}'].field === 'pile'"), "… und auf die Ablage gelegt")
        # oberste Stapelkarte doppelt antippen → offen
        top = await fb.evaluate(f"Object.entries({T}.client.state.pieces).filter(([k, v]) => v.field === 'deck').sort((a, b) => b[1].order - a[1].order)[0][0]")
        await tap_piece(fb, top, touch=True)
        await until(fb, f"{T}.pieces.selectedId() === '{top}'", 5)
        p = await fb.evaluate(f"{T}.pieces.screenPos('{top}')")
        await fb.touchscreen.tap(p["x"], p["y"])
        ok(await until(fa, f"!!{T}.client.state.pieces['{top}'].show", 10), "Doppeltipp: Karte umgedreht, alle sehen sie")
        ok(await until(fa, "[...document.querySelectorAll('#acts button')].some(b => b.textContent.includes('mischen'))"),
           "Knopf „Stapel mischen“")
        await fa.screenshot(path=f"{OUT}/maumau_frei.png")
        await fa.click("#acts button[data-lobby]")
        ok(await until(fb, f"{T}.client.state.status === 'lobby'"), "Host: zurück in die Lobby")
        ea += efa + efb

        # Computer gegen Computer (6er-Tisch: 5 Computer + Zuschauer)
        c, ec = await open_player(browser, "Cara", ROOM + "C", viewport={"width": 1100, "height": 760})
        await c.evaluate(f"{T}.client.setSettings({{variant: '6'}})")
        await until(c, f"{T}.client.state.game.seats === 6")
        await c.evaluate(f"{T}.client.stand()")
        await until(c, f"{T}.client.state.members[0].seat === null")
        await c.evaluate(f"[0,1,2,3,4].forEach(s => {T}.client.addBot(s))")
        await until(c, f"{T}.client.state.members.length === 6")
        await c.click("#start-btn")
        ok(await until(c, f"{T}.client.state.status === 'playing'"), "Fünf Computer spielen")
        await c.wait_for_timeout(2500)
        await c.screenshot(path=f"{OUT}/maumau_sechs.png")
        seen = await c.evaluate(f"Object.values({T}.client.state.pieces).filter(v => v.show && v.field.startsWith('hand')).length")
        ok(seen == 0, "Zuschauer sieht keine Handkarte")
        done = await until(c, f"{T}.client.state.status === 'finished'", 240)
        ok(done, "Partie endet")
        if done:
            over = await c.inner_text("#gameover")
            ok("gewinnt" in over, f"Siegerehrung: „{over[:50]}“")
            await c.screenshot(path=f"{OUT}/maumau_ende.png")
        ok(not (ea + eb + ec), f"keine JS-Fehler {(ea + eb + ec)[:3]}")
        await browser.close()
    print()
    if FAILS:
        print(f"❌ {len(FAILS)} Fehler")
        sys.exit(1)
    print("✅ Mau-Mau im Browser bestanden")

asyncio.run(main())

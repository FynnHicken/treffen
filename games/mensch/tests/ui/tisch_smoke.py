"""Browser-Rauchtest Spieltisch (M1): zwei Personen, Sitzplätze, Präsenz, Render-on-Demand, Screenshots.

    podman run --rm --network=host -v "$PWD/games/mensch":/work:z -w /work localhost/mono-ui-test \
        python tests/ui/tisch_smoke.py http://127.0.0.1:8095 /work/tests/ui/shots
"""
import asyncio, os, random, string, sys
from playwright.async_api import async_playwright

BASE, OUT = sys.argv[1].rstrip("/"), sys.argv[2]
os.makedirs(OUT, exist_ok=True)
ROOM = "T" + "".join(random.choices(string.digits, k=5))
FAILS = []
ARGS = ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
PHONE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)


def ok(c, m):
    print(("  OK  " if c else "  FAIL") + " " + m)
    if not c:
        FAILS.append(m)


async def open_player(browser, name, **ctx):
    c = await browser.new_context(locale="de-DE", **ctx)
    p = await c.new_page()
    errs = []
    p.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    p.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    await p.goto(f"{BASE}/?room={ROOM}&name={name}")
    await p.wait_for_function("window.__tisch && window.__tisch.client.state", timeout=15000)
    return p, errs


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=ARGS)
        anna, ea = await open_player(b, "Anna", viewport={"width": 1440, "height": 900})
        ben, eb = await open_player(b, "Ben", **PHONE)
        await anna.wait_for_timeout(800)

        members = await anna.evaluate("__tisch.client.state.members.map(m => [m.name, m.seat])")
        ok(sorted(members) == [["Anna", 0], ["Ben", 1]], f"Beide am Tisch: {members}")
        labels = await anna.evaluate("[...document.querySelectorAll('.tt-seat')].map(e => e.textContent.trim())")
        ok(any("Anna" in l and "(du)" in l for l in labels) and any("Ben" in l for l in labels), f"Namensschilder: {labels}")
        ok(sum("Platz frei" in l for l in labels) == 2, "Zwei freie Plätze angezeigt")
        host = await ben.evaluate("__tisch.client.state.host_id === __tisch.client.state.members.find(m => m.name === 'Anna').id")
        ok(host, "Anna (zuerst da) ist Host")

        # Ben bewegt den Zeiger über den Tisch → Anna sieht ihn
        await ben.mouse.move(195, 420)
        for x in range(150, 260, 10):
            await ben.mouse.move(x, 430)
            await ben.wait_for_timeout(30)
        await anna.wait_for_timeout(500)
        ok(await anna.evaluate("__tisch.presence.visibleCount") == 1, "Annas Bildschirm zeigt Bens Zeiger")
        await anna.screenshot(path=f"{OUT}/desktop-anna.png")

        # ---- M3: Würfel ----
        async def dice_done(page):
            try:
                await page.wait_for_function("__tisch.dice.isResting() && __tisch.client.state.last_roll", timeout=60000)
                return True
            except Exception:
                return False
        await anna.evaluate("__tisch.dice.throwDice(0.6)")    # in der Lobby zum Ausprobieren
        await anna.wait_for_timeout(400)
        ok(await dice_done(anna) and await dice_done(ben), "Würfel per Knopf geworfen und liegen bei beiden")
        roll = await anna.evaluate("__tisch.client.state.last_roll.values")
        ta, tb = await anna.evaluate("__tisch.dice.topValues()"), await ben.evaluate("__tisch.dice.topValues()")
        ok(ta == roll and tb == roll, f"Oben liegt die Server-Zahl {roll} (Anna {ta}, Ben {tb})")
        ia, ib = await anna.evaluate("__tisch.dice.lastRollInfo()"), await ben.evaluate("__tisch.dice.lastRollInfo()")
        ok(ia["positions"] == ib["positions"], f"Würfel liegt bei beiden gleich ({ia['positions']}), Wurf dauert {ia['seconds']:.2f} s")
        await anna.screenshot(path=f"{OUT}/desktop-anna-wurf.png")
        # Nahaufnahme von oben, im Reflex der Lampe (dort wurden die Augen früher überstrahlt)
        await anna.evaluate("""(() => { const t = __tisch.table, p = __tisch.dice.lastRollInfo().positions[0];
            t.controls.target.set(p[0], 0.2, p[2]); t.camera.position.set(p[0] + 0.15, 2.6, p[2] + 0.9);
            t.controls.update(); t.invalidate(); })()""")
        await anna.wait_for_timeout(600)
        await anna.screenshot(path=f"{OUT}/desktop-wuerfel-nah.png", clip={"x": 520, "y": 250, "width": 400, "height": 400})
        await anna.evaluate("__tisch.table.resetView(false)")
        # Becher greifen und schütteln
        await anna.wait_for_timeout(1600)    # Sperre nach dem letzten Wurf
        cup = await anna.evaluate("__tisch.dice.cupScreenPos(0)")
        seed_before = await anna.evaluate("__tisch.client.state.last_roll.throw.seed")
        await anna.mouse.move(cup["x"], cup["y"]); await anna.mouse.down()
        for i in range(24):
            await anna.mouse.move(cup["x"] + (40 if i % 2 else -40), cup["y"] + (15 if i % 3 else -15))
            await anna.wait_for_timeout(25)
            if i == 12:
                await anna.wait_for_timeout(800)
                ok(await anna.evaluate("__tisch.dice.topValues().length") == 0, "Beim Schütteln liegt der Würfel im Becher (eingesammelt)")
        await anna.mouse.up()
        await anna.wait_for_timeout(500)
        ok(await dice_done(ben), "Becher geschüttelt → gewürfelt")
        lr = await ben.evaluate("__tisch.client.state.last_roll")
        ok(lr["throw"]["seed"] != seed_before and lr["throw"]["power"] > 0.4, f"Neuer Wurf, Stärke aus dem Schütteln: {lr['throw']['power']}")
        ok(await ben.evaluate("__tisch.dice.topValues()") == lr["values"], "Auch dieser Wurf zeigt die Server-Zahl")
        await ben.screenshot(path=f"{OUT}/handy-ben-wurf.png")

        # ---- M4: Spiel mit Regeln ----
        await anna.wait_for_timeout(1600)
        bot_btn = await ben.query_selector('.tt-seat [data-act="bot"]')
        ok(bot_btn is None, "Gast sieht keinen „+ Computer“-Knopf")
        # Computer auf Rot (Platz 2): Knopf am Schild dieses Platzes
        await anna.evaluate("""[...document.querySelectorAll('.tt-seat')].find(e => e.querySelector('[data-act=bot]') && e.style.getPropertyValue('--tt-color').toLowerCase() === '#d63a2f').querySelector('[data-act=bot]').click()""")
        await anna.wait_for_timeout(600)
        ok(await ben.evaluate("__tisch.client.state.members.some(m => m.is_bot && m.seat === 2)"), "Host setzt Computer auf Rot – Ben sieht ihn")
        await anna.click("#start-btn")
        await anna.wait_for_function("__tisch.client.state.status === 'playing'", timeout=10000)
        ok(True, "Spiel gestartet")
        status = await anna.inner_text("#status")
        ok("Du bist dran" in status, f"Anna: „{status}“")
        ok(not await ben.evaluate("__tisch.client.canRoll"), "Ben darf in Annas Zug nicht würfeln")
        before = await ben.evaluate("JSON.stringify(__tisch.client.state.last_roll)")
        await ben.evaluate("__tisch.client.roll(0.5)")
        await ben.wait_for_timeout(500)
        ok(await ben.evaluate("JSON.stringify(__tisch.client.state.last_roll)") == before, "…auch nicht per Trick (Server lehnt ab)")
        for p in (anna, ben):
            await p.evaluate("window.__log = []; __tisch.client.onEvent(e => window.__log.push(e)); 0")

        async def act(page, name, want_illegal=False):
            """Ein Schritt eines Menschen: würfeln oder eine Figur ziehen (per Maus)."""
            st = await page.evaluate("({my: __tisch.client.myTurn, roll: __tisch.client.canRoll, play: __tisch.client.state.play})")
            if not st["my"]:
                return None
            if st["roll"]:
                await page.evaluate("__tisch.dice.throwDice(0.7)")
                await page.wait_for_timeout(1700)
                return "roll"
            if st["play"]["phase"] != "move":
                return None
            await page.wait_for_function("__tisch.pieces.isResting()", timeout=30000)
            mv = st["play"]["moves"][0]
            legal = [m["to"] for m in st["play"]["moves"] if m["piece"] == mv["piece"]]
            src = await page.evaluate(f"__tisch.pieces.screenPos('{mv['piece']}')")
            if want_illegal:
                wrong = "t25" if "t25" not in legal else "t26"
                dst = await page.evaluate(f"__tisch.pieces.fieldScreenPos('{wrong}')")
                await drag(page, src, dst)
                await page.wait_for_timeout(1200)
                ok(await page.evaluate(f"__tisch.client.state.pieces['{mv['piece']}'].field") != wrong, f"{name}: Zug auf falsches Feld abgelehnt")
                await page.wait_for_function("__tisch.pieces.isResting()", timeout=30000)
                src = await page.evaluate(f"__tisch.pieces.screenPos('{mv['piece']}')")
            if len(legal) == 1 and not want_illegal:
                await page.mouse.click(src["x"], src["y"])          # Antippen genügt
                how = "antippen"
            else:
                dst = await page.evaluate(f"__tisch.pieces.fieldScreenPos('{mv['to']}')")
                await drag(page, src, dst)
                how = "ziehen"
            await page.wait_for_timeout(900)
            field = await page.evaluate(f"__tisch.client.state.pieces['{mv['piece']}'].field")
            ok(field == mv["to"], f"{name} zieht {mv['piece']} → {mv['to']} ({how})")
            return "move"

        async def drag(page, src, dst):
            await page.mouse.move(src["x"], src["y"]); await page.mouse.down()
            for i in range(1, 13):
                await page.mouse.move(src["x"] + (dst["x"] - src["x"]) * i / 12, src["y"] + (dst["y"] - src["y"]) * i / 12)
                await page.wait_for_timeout(25)
            await page.mouse.up()

        moved = {"Anna": 0, "Ben": 0}
        illegal_done = False
        for step in range(120):
            for page, name in ((anna, "Anna"), (ben, "Ben")):
                r = await act(page, name, want_illegal=(not illegal_done and name == "Anna"))
                if r == "move":
                    moved[name] += 1
                    if name == "Anna":
                        illegal_done = True
            bot_moved = await anna.evaluate("window.__log.some(e => e.type === 'PIECE_MOVED' && e.by === 'bot_2')")
            if moved["Anna"] and moved["Ben"] and bot_moved:
                break
            await anna.wait_for_timeout(400)
        ok(moved["Anna"] >= 1 and moved["Ben"] >= 1, f"Beide Menschen haben gezogen ({moved})")
        ok(bot_moved, "Der Computer hat selbst gewürfelt und gezogen")
        seqs = await ben.evaluate("window.__log.length")
        ok(seqs > 5, f"Ben hat alle Ereignisse mitbekommen ({seqs})")
        await anna.screenshot(path=f"{OUT}/desktop-anna-spiel.png")
        await ben.screenshot(path=f"{OUT}/handy-ben-spiel.png")

        # Ben setzt sich auf einen anderen freien Platz (Klick auf Schild)
        await ben.evaluate("__tisch.client.sit(3)")
        await anna.wait_for_timeout(600)
        ok(await anna.evaluate("__tisch.client.state.members.find(m => m.name === 'Ben').seat") == 1, "Im laufenden Spiel kein Platzwechsel")

        # Render-on-Demand: im Leerlauf keine neuen Frames (warten, bis ein Mensch dran ist – dann ruht der Tisch)
        await anna.wait_for_function("[0, 1].includes(__tisch.client.state.play.turn) && __tisch.dice.isResting() && __tisch.pieces.isResting()", timeout=60000)
        await anna.wait_for_timeout(3500)   # Zeiger blendet aus, Kamera steht
        f1 = await anna.evaluate("__tisch.table.framesRendered")
        await anna.wait_for_timeout(2000)
        f2 = await anna.evaluate("__tisch.table.framesRendered")
        ok(f2 - f1 == 0, f"Leerlauf zeichnet nicht ({f2 - f1} Frames in 2 s)")

        # Ben trennt sich → Anna sieht „getrennt“, Platz bleibt reserviert
        await ben.context.close()
        await anna.wait_for_timeout(800)
        off = await anna.evaluate("__tisch.client.state.members.find(m => m.name === 'Ben')")
        ok(off and off["connected"] is False and off["seat"] == 1, "Ben getrennt, Platz bleibt (Computer vertritt ihn)")
        await anna.screenshot(path=f"{OUT}/desktop-anna-ben-weg.png")

        ok(not ea and not eb, f"Keine JS-Fehler {(ea + eb)[:3]}")
        await b.close()
    print("\n" + ("❌ %d Fehler" % len(FAILS) if FAILS else "✅ Spieltisch-Rauchtest bestanden"))
    sys.exit(1 if FAILS else 0)

asyncio.run(main())

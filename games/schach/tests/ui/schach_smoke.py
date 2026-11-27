"""Browser-Test Schach am Spieltisch: zwei Personen (Desktop + Handy), ziehen per Maus, Handy per Antippen,
Schlagen in die Ablage, abgelehnter Zug gleitet zurück, Partie gegen den Computer, Render-on-Demand, Screenshots.

    podman run --rm --network=host -v "$PWD/games/schach":/work:z -w /work localhost/mono-ui-test \
        python tests/ui/schach_smoke.py http://127.0.0.1:8096 /work/tests/ui/shots
"""
import asyncio, os, random, string, sys
from playwright.async_api import async_playwright

BASE, OUT = sys.argv[1].rstrip("/"), sys.argv[2]
os.makedirs(OUT, exist_ok=True)
ROOM = "S" + "".join(random.choices(string.digits, k=5))
FAILS = []
ARGS = ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
PHONE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)


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
    await p.wait_for_function("window.__tisch && window.__tisch.client.state", timeout=15000)
    return p, errs


async def rest(page):
    await page.wait_for_function("__tisch.pieces.isResting() || __tisch.pieces.selectedId()", timeout=30000)


async def drag(page, piece, field):
    src = await page.evaluate(f"__tisch.pieces.screenPos('{piece}')")
    dst = await page.evaluate(f"__tisch.pieces.fieldScreenPos('{field}')")
    await page.mouse.move(src["x"], src["y"])
    await page.mouse.down()
    for i in range(1, 13):
        await page.mouse.move(src["x"] + (dst["x"] - src["x"]) * i / 12, src["y"] + (dst["y"] - src["y"]) * i / 12)
        await page.wait_for_timeout(25)
    await page.mouse.up()


async def field_of(page, piece):
    return await page.evaluate(f"__tisch.client.state.pieces['{piece}'].field")


async def wait_field(page, piece, field, timeout=15000):
    try:
        await page.wait_for_function(f"__tisch.client.state.pieces['{piece}'].field === '{field}'", timeout=timeout)
    except Exception:
        pass
    return await field_of(page, piece) == field


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=ARGS)
        print("== Zu zweit (Desktop + Handy) ==")
        anna, ea = await open_player(b, "Anna", ROOM, viewport={"width": 1440, "height": 900})
        ben, eb = await open_player(b, "Ben", ROOM, **PHONE)
        await anna.wait_for_timeout(800)
        members = await anna.evaluate("__tisch.client.state.members.map(m => [m.name, m.seat])")
        ok(sorted(members) == [["Anna", 0], ["Ben", 1]], f"Weiß = Anna, Schwarz = Ben: {members}")
        versions = await anna.evaluate("__tisch.client.versions")
        ok(versions.get("client") == versions.get("server") and versions.get("game"), f"Versionen sichtbar: {versions}")
        ok("Spieltisch" in (await anna.text_content("#versions") or ""), "Versionszeile auf dem Bildschirm")

        await anna.click("#start-btn")
        await anna.wait_for_function("__tisch.client.state.status === 'playing'", timeout=10000)
        ok(True, "Partie gestartet")
        await anna.wait_for_timeout(1200)
        await anna.screenshot(path=f"{OUT}/schach-desktop-start.png")
        await ben.screenshot(path=f"{OUT}/schach-handy-start.png")

        # Falscher Zug gleitet zurück
        await drag(anna, "w-P-e2", "e5")
        await anna.wait_for_timeout(1200)
        await rest(anna)
        ok(await field_of(anna, "w-P-e2") == "e2", "e2–e5 abgelehnt, Bauer steht wieder auf e2")

        # Desktop: Ziehen mit der Maus
        await drag(anna, "w-P-e2", "e4")
        ok(await wait_field(anna, "w-P-e2", "e4"), "Anna zieht e2–e4 (Maus)")
        await ben.wait_for_function("__tisch.client.myTurn", timeout=10000)

        # Handy: antippen, dann Ziel antippen (Bauer hat zwei Ziele → bleibt ausgewählt)
        await ben.wait_for_function("__tisch.pieces.isResting()", timeout=20000)
        src = await ben.evaluate("__tisch.pieces.screenPos('b-P-d7')")
        await ben.touchscreen.tap(src["x"], src["y"])
        await ben.wait_for_timeout(500)
        ok(await ben.evaluate("__tisch.pieces.selectedId()") == "b-P-d7", "Handy: angetippter Bauer bleibt angehoben (2 Ziele)")
        await ben.screenshot(path=f"{OUT}/schach-handy-auswahl.png")
        f1 = await ben.evaluate("__tisch.table.framesRendered")
        await ben.wait_for_timeout(1000)
        f2 = await ben.evaluate("__tisch.table.framesRendered")
        ok(f2 - f1 <= 2, f"Ausgewählte Figur schwebt ohne Dauer-Rendern ({f2 - f1} Bilder in 1 s)")
        dst = await ben.evaluate("__tisch.pieces.fieldScreenPos('d5')")
        await ben.touchscreen.tap(dst["x"], dst["y"])
        ok(await wait_field(ben, "b-P-d7", "d5"), "Handy: Ziel d5 angetippt → Bauer zieht")

        # Schlagen: Figur wandert in die Ablage rechts von Weiß
        await anna.wait_for_function("__tisch.client.myTurn && __tisch.pieces.isResting()", timeout=20000)
        await drag(anna, "w-P-e2", "d5")
        ok(await wait_field(anna, "b-P-d7", "x-b-0"), "e4×d5: schwarzer Bauer liegt in der Ablage")
        await anna.wait_for_timeout(1500)
        await anna.screenshot(path=f"{OUT}/schach-desktop-geschlagen.png")

        f1 = await anna.evaluate("__tisch.table.framesRendered")
        await anna.wait_for_timeout(1500)
        f2 = await anna.evaluate("__tisch.table.framesRendered")
        ok(f2 - f1 <= 2, f"Im Leerlauf wird nicht gezeichnet ({f2 - f1} Bilder in 1,5 s)")

        print("== Gegen den Computer ==")
        room2 = ROOM + "B"
        cara, ec = await open_player(b, "Cara", room2, **PHONE)
        await cara.evaluate("__tisch.client.addBot(1)")
        await cara.wait_for_function("__tisch.client.state.members.some(m => m.is_bot)", timeout=10000)
        await cara.click("#start-btn")
        await cara.wait_for_function("__tisch.client.state.status === 'playing'", timeout=10000)
        await cara.wait_for_function("__tisch.pieces.isResting()", timeout=20000)
        src = await cara.evaluate("__tisch.pieces.screenPos('w-N-g1')")
        await cara.touchscreen.tap(src["x"], src["y"])
        await cara.wait_for_timeout(400)
        dst = await cara.evaluate("__tisch.pieces.fieldScreenPos('f3')")
        await cara.touchscreen.tap(dst["x"], dst["y"])
        ok(await wait_field(cara, "w-N-g1", "f3"), "Cara zieht den Springer g1–f3 (antippen)")
        await cara.wait_for_function("__tisch.client.myTurn", timeout=20000)
        last = await cara.evaluate("__tisch.client.state.play.last")
        ok(last and last["from"][1] in "78", f"Der Computer hat geantwortet ({last})")
        await cara.wait_for_timeout(1200)
        await cara.screenshot(path=f"{OUT}/schach-handy-computer.png")

        errs = [e for e in ea + eb + ec if "WebGL" not in e and "GPU" not in e]
        ok(not errs, f"Keine JS-Fehler ({errs[:3]})")
        await b.close()
    print()
    if FAILS:
        print(f"❌ {len(FAILS)} Fehler")
        sys.exit(1)
    print("✅ Schach im Browser bestanden")


asyncio.run(main())

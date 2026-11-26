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

        # ---- M2: Figuren ----
        await anna.wait_for_function("__tisch.pieces.isResting()", timeout=5000)
        n = await anna.evaluate("Object.keys(__tisch.client.state.pieces).length")
        ok(n == 16, f"16 Figuren auf dem Brett ({n})")
        start = await anna.evaluate("__tisch.pieces.screenPos('p-yellow-0')")
        target = await anna.evaluate("__tisch.pieces.fieldScreenPos('t0')")
        await anna.mouse.move(start["x"], start["y"])
        await anna.mouse.down()
        steps = 14
        for i in range(1, steps + 1):
            await anna.mouse.move(start["x"] + (target["x"] - start["x"]) * i / steps,
                                  start["y"] + (target["y"] - start["y"]) * i / steps)
            await anna.wait_for_timeout(35)
        await ben.wait_for_timeout(300)
        ok(await ben.evaluate("__tisch.pieces.modeOf('p-yellow-0')") == "held", "Ben sieht Annas Figur in der Luft (wird gehalten)")
        await anna.screenshot(path=f"{OUT}/desktop-anna-zieht.png")
        await anna.mouse.up()
        await anna.wait_for_timeout(900)
        f_anna = await anna.evaluate("__tisch.client.state.pieces['p-yellow-0'].field")
        f_ben = await ben.evaluate("__tisch.client.state.pieces['p-yellow-0'].field")
        ok(f_anna == "t0" and f_ben == "t0", f"Figur auf Startfeld A (Anna: {f_anna}, Ben: {f_ben})")
        async def resting(page):
            try:
                await page.wait_for_function("__tisch.pieces.isResting()", timeout=5000)
                return True
            except Exception:
                return False
        ok(await resting(ben), "Bei Ben steht die Figur wieder ruhig")
        # Ben (Grün) versucht Annas gelbe Figur zu greifen → geht nicht, Kamera dreht stattdessen
        bp = await ben.evaluate("__tisch.pieces.screenPos('p-yellow-1')")
        await ben.mouse.move(bp["x"], bp["y"]); await ben.mouse.down(); await ben.mouse.move(bp["x"] + 60, bp["y"]); await ben.mouse.up()
        await anna.wait_for_timeout(500)
        ok(await anna.evaluate("__tisch.client.state.pieces['p-yellow-1'].held_by") is None, "Fremde Figur nicht greifbar")
        # Auf besetztes Feld ziehen → zurück
        p1 = await anna.evaluate("__tisch.pieces.screenPos('p-yellow-1')")
        t0 = await anna.evaluate("__tisch.pieces.fieldScreenPos('t0')")
        await anna.mouse.move(p1["x"], p1["y"]); await anna.mouse.down()
        for i in range(1, 11):
            await anna.mouse.move(p1["x"] + (t0["x"] - p1["x"]) * i / 10, p1["y"] + (t0["y"] - p1["y"]) * i / 10)
            await anna.wait_for_timeout(30)
        await anna.mouse.up()
        await anna.wait_for_timeout(1000)
        ok(await anna.evaluate("__tisch.client.state.pieces['p-yellow-1'].field") == "h-yellow-1", "Auf besetztes Feld nicht möglich – Figur bleibt im Häuschen")
        ok(await resting(anna), "…und ist zurückgeglitten")
        await anna.screenshot(path=f"{OUT}/desktop-anna-brett.png")

        # Ben setzt sich auf einen anderen freien Platz (Klick auf Schild)
        await ben.evaluate("__tisch.client.sit(2)")
        await anna.wait_for_timeout(600)
        ok(await anna.evaluate("__tisch.client.state.members.find(m => m.name === 'Ben').seat") == 2, "Platzwechsel kommt an")
        await ben.wait_for_timeout(900)   # Kamerafahrt zum neuen Platz
        await ben.screenshot(path=f"{OUT}/handy-ben.png")

        # Render-on-Demand: im Leerlauf keine neuen Frames
        await anna.wait_for_timeout(3500)   # Zeiger blendet aus, Kamera steht
        f1 = await anna.evaluate("__tisch.table.framesRendered")
        await anna.wait_for_timeout(2000)
        f2 = await anna.evaluate("__tisch.table.framesRendered")
        ok(f2 - f1 == 0, f"Leerlauf zeichnet nicht ({f2 - f1} Frames in 2 s)")

        # Ben trennt sich → Anna sieht „getrennt“, Platz bleibt reserviert
        await ben.context.close()
        await anna.wait_for_timeout(800)
        off = await anna.evaluate("__tisch.client.state.members.find(m => m.name === 'Ben')")
        ok(off and off["connected"] is False and off["seat"] == 2, "Ben getrennt, Platz reserviert")
        await anna.screenshot(path=f"{OUT}/desktop-anna-ben-weg.png")

        ok(not ea and not eb, f"Keine JS-Fehler {(ea + eb)[:3]}")
        await b.close()
    print("\n" + ("❌ %d Fehler" % len(FAILS) if FAILS else "✅ Spieltisch-Rauchtest bestanden"))
    sys.exit(1 if FAILS else 0)

asyncio.run(main())

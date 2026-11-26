"""Titelbild für die Hub-Karte (party-hub/assets/cover_mensch.jpg) aus dem echten 3D-Tisch erzeugen.

    podman run --rm --network=host -v "$PWD/games/mensch":/work:z -w /work localhost/mono-ui-test \
        python tests/ui/make_cover.py http://127.0.0.1:8095 /work/tests/ui/shots
    cp games/mensch/tests/ui/shots/cover_mensch.jpg party-hub/assets/
"""
import asyncio, random, sys
from playwright.async_api import async_playwright
BASE, OUT = sys.argv[1], sys.argv[2]
ARGS = ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=ARGS)
        p = await (await b.new_context(viewport={"width": 1200, "height": 896}, locale="de-DE")).new_page()
        await p.goto(f"{BASE}/?room=COVER{random.randint(100,999)}&name=Anna")
        await p.wait_for_function("window.__tisch && __tisch.client.state")
        await p.wait_for_timeout(800)
        await p.click(".tt-settings-btn")
        await p.wait_for_timeout(300)
        await p.screenshot(path=f"{OUT}/hausregeln.png")
        await p.click(".tt-settings-close")
        for s in (1, 2, 3):
            await p.evaluate(f"__tisch.client.addBot({s})")
            await p.wait_for_timeout(300)
        await p.click("#start-btn")
        # Ich spiele per Knopf/Antippen mit, damit alle Farben unterwegs sind
        for _ in range(90):
            st = await p.evaluate("({roll: __tisch.client.canRoll, mv: __tisch.client.myTurn && __tisch.client.state.play.phase === 'move' ? __tisch.client.state.play.moves[0] : null})")
            if st["roll"]:
                await p.evaluate("__tisch.dice.throwDice(0.6)")
            elif st["mv"]:
                await p.evaluate(f"__tisch.client.grab('{st['mv']['piece']}'); __tisch.client.drop('{st['mv']['piece']}', '{st['mv']['to']}')")
            await p.wait_for_timeout(1000)
        # Moment abpassen, in dem ich würfeln soll – dann ruht der Tisch
        await p.wait_for_function("__tisch.client.canRoll && __tisch.dice.isResting() && __tisch.pieces.isResting()", timeout=90000)
        await p.add_style_tag(content="header, .top-center, .hint, .roll-btn, .toast, .tt-presence-label { display: none !important; }")
        await p.evaluate("""(() => { const t = __tisch.table; t.camera.position.set(0, 11.2, 12.6); t.controls.target.set(0, -0.6, 0.4); t.controls.update(); t.invalidate(); })()""")
        await p.wait_for_timeout(1200)
        await p.screenshot(path=f"{OUT}/cover_mensch.jpg", type="jpeg", quality=86)
        await b.close()
asyncio.run(main())

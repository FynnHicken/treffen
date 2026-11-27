"""Titelbild für die Hub-Karte (party-hub/assets/cover_schach.jpg) aus dem echten 3D-Tisch erzeugen.

    podman run --rm --network=host -v "$PWD/games/schach":/work:z -w /work localhost/mono-ui-test \
        python tests/ui/make_cover.py http://127.0.0.1:8096 /work/tests/ui/shots
    cp games/schach/tests/ui/shots/cover_schach.jpg party-hub/assets/
"""
import asyncio, random, sys
from playwright.async_api import async_playwright
BASE, OUT = sys.argv[1], sys.argv[2]
ARGS = ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
# Eine ruhige Eröffnung (Italienisch), damit mittig etwas los ist
OPENING = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "c2c3", "g8f6", "d2d4", "e5d4", "e1g1"]


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=ARGS)
        ctx = lambda: b.new_context(viewport={"width": 1200, "height": 896}, locale="de-DE")
        room = f"COVER{random.randint(100, 999)}"
        w = await (await ctx()).new_page()
        await w.goto(f"{BASE}/?room={room}&name=Anna")
        await w.wait_for_function("window.__tisch && __tisch.client.state")
        bl = await (await ctx()).new_page()
        await bl.goto(f"{BASE}/?room={room}&name=Ben")
        await bl.wait_for_function("window.__tisch && __tisch.client.state")
        await w.wait_for_timeout(600)
        await w.click("#start-btn")
        await w.wait_for_function("__tisch.client.state.status === 'playing'")
        for i, mv in enumerate(OPENING):
            p = w if i % 2 == 0 else bl
            frm, to = mv[:2], mv[2:]
            await p.evaluate(f"""(() => {{ const s = __tisch.client.state; const id = Object.keys(s.pieces).find(k => s.pieces[k].field === '{frm}');
                __tisch.client.grab(id); __tisch.client.drop(id, '{to}'); }})()""")
            await p.wait_for_timeout(700)
        await w.wait_for_function("__tisch.pieces.isResting()", timeout=30000)
        await w.add_style_tag(content="header, .top-center, .hint, .versions, .toast, .tt-presence-label { display: none !important; }")
        await w.evaluate("""(() => { const t = __tisch.table; t.camera.position.set(2.2, 8.6, 9.4); t.controls.target.set(0, -0.2, 0.6); t.controls.update(); t.invalidate(); })()""")
        await w.wait_for_timeout(1200)
        await w.screenshot(path=f"{OUT}/cover_schach.jpg", type="jpeg", quality=86)
        await b.close()
asyncio.run(main())

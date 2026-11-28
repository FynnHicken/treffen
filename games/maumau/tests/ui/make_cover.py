"""Titelbild für die Hub-Karte (party-hub/assets/cover_maumau.jpg) aus dem echten 3D-Tisch erzeugen.

    podman run --rm --network=host -v "$PWD/games/maumau":/work:z -w /work localhost/mono-ui-test \
        python tests/ui/make_cover.py http://127.0.0.1:8098 /work/tests/ui/shots
    cp games/maumau/tests/ui/shots/cover_maumau.jpg party-hub/assets/
"""
import asyncio, random, sys
from playwright.async_api import async_playwright
BASE, OUT = sys.argv[1], sys.argv[2]
ARGS = ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
T = "window.__tisch"


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=ARGS)
        p = await (await b.new_context(viewport={"width": 1200, "height": 896}, locale="de-DE")).new_page()
        await p.goto(f"{BASE}/?room=COVER{random.randint(100, 999)}&name=Anna")
        await p.wait_for_function(f"{T} && {T}.client.state && {T}.client.me")
        await p.evaluate(f"[1,2,3].forEach(s => {T}.client.addBot(s))")
        await p.wait_for_function(f"{T}.client.state.members.filter(m => m.seat !== null).length === 4", timeout=5000)
        await p.wait_for_timeout(600)
        await p.click("#start-btn")
        await p.wait_for_function(f"{T}.client.state.status === 'playing'")
        # ein paar Züge, damit auf der Ablage etwas liegt: eigene passende Karte legen, sonst ziehen
        for _ in range(4):
            await p.wait_for_function(f"{T}.client.myTurn && {T}.pieces.isResting()", timeout=30000)
            await p.evaluate(f"""(() => {{ const m = {T}.client.state.play.moves || [];
                const mv = m.find(x => x.to === 'pile') || m.find(x => x.to.startsWith('hand'));
                const btn = document.querySelector('#acts button');
                if (mv && (mv.to === 'pile' || !btn)) {{ {T}.client.grab(mv.piece); {T}.client.drop(mv.piece, mv.to); }}
                else if (btn) btn.click(); }})()""")
            await p.wait_for_timeout(1500)
        await p.wait_for_function(f"{T}.client.myTurn && {T}.pieces.isResting()", timeout=30000)
        await p.add_style_tag(content="header, .top-center, .hint, .versions, .toast, .tt-presence-label, .talk, .tt-acts { display: none !important; }")
        await p.wait_for_timeout(1200)
        await p.screenshot(path=f"{OUT}/cover_maumau.jpg", type="jpeg", quality=86)
        await b.close()
asyncio.run(main())

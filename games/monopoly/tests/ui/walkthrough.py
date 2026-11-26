"""UI-Durchlauf mit Playwright: Screenshots in Handy- und Desktopgröße.

    podman run --rm --network=host -v "$PWD":/work:z -w /work \
        mcr.microsoft.com/playwright/python:v1.49.1-noble \
        python tests/ui/walkthrough.py http://127.0.0.1:8090 /work/tests/ui/shots

Klickt sich durch: Startseite → Raum erstellen → Lobby (2 Bots) → Spiel → Würfeln → Besitz/Handel.
Sammelt außerdem Konsolenfehler und Elemente, die über den Bildschirmrand ragen.
"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

BASE, OUT = [a for a in sys.argv[1:] if not a.startswith("--")][:2]
os.makedirs(OUT, exist_ok=True)

DEVICES = {
    "handy": dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                  user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"),
    "handy-quer": dict(viewport={"width": 844, "height": 390}, device_scale_factor=2, is_mobile=True, has_touch=True),
    "desktop": dict(viewport={"width": 1440, "height": 900}),
}

OVERFLOW_JS = """() => {
  const W = innerWidth, out = [];
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if (r.right > W + 2 || r.left < -2) out.push((el.id ? '#' + el.id : el.className.toString().split(' ')[0] || el.tagName) + ` [${Math.round(r.left)}..${Math.round(r.right)}]`);
  }
  return [...new Set(out)].slice(0, 15);
}"""
SMALL_TAP_JS = """() => {
  const out = [];
  for (const el of document.querySelectorAll('button, .btn-action, .btn-icon, .token-choice, .color-dot-pick, a')) {
    const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
    if (r.width < 36 || r.height < 36) out.push((el.id || el.textContent.trim().slice(0, 18) || el.className) + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return [...new Set(out)].slice(0, 25);
}"""

async def shot(page, name, report):
    await page.wait_for_timeout(700)
    await page.screenshot(path=f"{OUT}/{name}.png")
    report[name] = {"overflow": await page.evaluate(OVERFLOW_JS), "small_taps": await page.evaluate(SMALL_TAP_JS)}

SETTLE_JS = """() => {
  const g = window.MonopolyGame, st = (g.getState && g.getState()) || {};
  const pa = st.pending_action || {};
  const mine = st.current_player && st.players && g.getState && st.current_player.id === (st.players.find(p => p.name === 'Testi') || {}).id;
  if (mine && pa.type === 'TAX_CHOICE') g.payIncomeTax('flat');
  if (mine && pa.type === 'CARD_DRAWN' && g.confirmCard) g.confirmCard();
  if (mine && pa.type === 'BUY_OR_AUCTION' && pa.square) g.buyProperty(pa.square.index);
  const open = [...document.querySelectorAll('.modal-overlay.open')].filter(m => m.id !== 'modal-lobby');
  open.forEach(m => g.closeModal && g.closeModal(m.id));
  const blocking = mine && ['TAX_CHOICE', 'CARD_DRAWN', 'DRAW_CARD', 'MOVE_TOKEN', 'BUY_OR_AUCTION'].includes(pa.type);
  return !blocking && open.length === 0;
}"""

async def settle(page, timeout_s=15):
    """Pflicht-Entscheidungen des eigenen Zugs erledigen und Fenster schließen, bis nichts mehr im Weg ist.
    (Karten/Steuer erscheinen erst nach der Animation – deshalb mehrfach prüfen.)"""
    calm = 0
    for _ in range(int(timeout_s / 0.5)):
        calm = calm + 1 if await page.evaluate(SETTLE_JS) else 0
        if calm >= 3:          # 1,5 s lang ruhig
            return
        await page.wait_for_timeout(500)


async def run(pw, dev_name, opts):
    browser = await pw.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
    ctx = await browser.new_context(**opts, locale="de-DE")
    page = await ctx.new_page()
    errors, report = [], {}
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    await page.goto(BASE + "/", wait_until="networkidle")
    await shot(page, f"{dev_name}-1-start", report)
    await page.fill("#input-welcome-name", "Testi")
    await page.evaluate("window.MonopolyGame.createNewRoom()")
    await page.wait_for_selector("#btn-add-bot", state="visible", timeout=10000)
    await page.click("#btn-add-bot"); await page.wait_for_timeout(300); await page.click("#btn-add-bot")
    await shot(page, f"{dev_name}-2-lobby", report)
    await page.click("#btn-start-game")
    await page.wait_for_timeout(2500)
    await shot(page, f"{dev_name}-3-spiel", report)
    # bis wir dran sind, dann würfeln
    for _ in range(60):
        if await page.evaluate("!document.getElementById('btn-roll').disabled"): break
        await page.wait_for_timeout(1000)
    await page.click("#btn-roll"); await page.wait_for_timeout(5000)
    await shot(page, f"{dev_name}-4-nach-wurf", report)
    await settle(page)
    await page.click("#btn-portfolio"); await shot(page, f"{dev_name}-5-besitz", report)
    await page.evaluate("window.MonopolyGame.closeModal('modal-portfolio')")
    await settle(page)
    await page.click("#btn-trade"); await shot(page, f"{dev_name}-6-handel", report)
    await page.evaluate("window.MonopolyGame.closeModal('modal-trade')")
    await settle(page)
    await page.click("#btn-toggle-logs"); await shot(page, f"{dev_name}-7-protokoll", report)
    report["console_errors"] = errors[:20]
    await browser.close()
    return report

async def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    which = args[2].split(",") if len(args) > 2 else list(DEVICES)
    async with async_playwright() as pw:
        result = {}
        for name in which:
            try:
                result[name] = await run(pw, name, DEVICES[name])
            except Exception as e:
                result[name] = {"abbruch": repr(e)[:2000]}
        json.dump(result, open(f"{OUT}/report.json", "w"), ensure_ascii=False, indent=1)
        print(json.dumps(result, ensure_ascii=False, indent=1))
        # --check (CI): Abbruch oder Konsolenfehler → Exit-Code 1
        if "--check" in sys.argv:
            bad = {k: v.get("abbruch") or v.get("console_errors") for k, v in result.items()
                   if v.get("abbruch") or v.get("console_errors")}
            if bad:
                print("❌ UI-Durchlauf fehlgeschlagen:", json.dumps(bad, ensure_ascii=False))
                sys.exit(1)
            print("✅ UI-Durchlauf ohne Fehler")

asyncio.run(main())

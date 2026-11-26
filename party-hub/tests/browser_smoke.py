"""Browser-Rauchtest für den Hub: zwei Personen betreten einen Raum, Host-Einstellungen, Abstimmung.

Braucht laufenden Hub (Nginx + party-server), z. B. per ./start.sh, dann:
    podman run --rm --network=host -v "$PWD/party-hub/tests":/t:ro,z localhost/mono-ui-test \
        python /t/browser_smoke.py http://127.0.0.1:8000
(Image siehe games/monopoly/tests/ui/Containerfile)
"""
import asyncio, random, string, sys
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip("/")
ROOM = "SMOKE" + "".join(random.choices(string.digits, k=4))  # frischer Raum pro Lauf
FAILS = []


def ok(c, m):
    print(("  OK  " if c else "  FAIL") + " " + m)
    if not c:
        FAILS.append(m)


async def enter(browser, name):
    ctx = await browser.new_context(viewport={"width": 1280, "height": 860})
    page = await ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(f"{BASE}/?room={ROOM}")
    await page.fill("#welcomeNicknameInput", name)
    await page.click("#btnWelcomeDirectJoin")
    await page.wait_for_timeout(1200)
    return page, errors


async def visible(page, sel):
    return await page.locator(sel).is_visible()


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        host, host_err = await enter(b, "Lukas")
        guest, guest_err = await enter(b, "Fynn")
        await host.wait_for_timeout(800)

        ok(await visible(host, "#hubSettingsBtn"), "Host sieht ⚙️ Raum-Einstellungen")
        ok(not await visible(guest, "#hubSettingsBtn"), "Gast sieht keine Raum-Einstellungen")
        ok(await visible(host, "#toggleVoteBtn"), "Host sieht Abstimmungs-Knopf")
        ok(not await visible(guest, "#toggleVoteBtn"), "Gast sieht Abstimmungs-Knopf nicht (Standard: nur Host)")

        # Host startet Abstimmung → Gast sieht Banner, stimmt ab → Host sieht die Stimme
        await host.click("#toggleVoteBtn")
        await guest.wait_for_timeout(800)
        ok(await visible(guest, "#voteBanner"), "Abstimmung des Hosts kommt beim Gast an")
        await guest.locator('[data-game-id="monopoly"] .vote-card-btn').click()
        await host.wait_for_timeout(800)
        count = await host.locator("#vote-monopoly .vote-count").inner_text()
        ok(count.strip() == "1", f"Stimme des Gasts kommt beim Host an (Monopoly: {count})")
        await host.click("#closeVoteBtn")
        await guest.wait_for_timeout(800)
        ok(not await visible(guest, "#voteBanner"), "Beenden durch Host kommt beim Gast an")

        # Host erlaubt allen, Abstimmungen zu starten
        await host.click("#hubSettingsBtn")
        ok(await visible(host, "#hubSettingsModal"), "Einstellungsfenster öffnet sich")
        await host.check('input[data-hub-setting="anyoneCanVote"]')
        await host.click("#hubSettingsModal .btn-primary-launch")
        await guest.wait_for_timeout(800)
        ok(await visible(guest, "#toggleVoteBtn"), "Nach Freigabe sieht der Gast den Abstimmungs-Knopf")
        await guest.click("#toggleVoteBtn")
        await host.wait_for_timeout(800)
        ok(await visible(host, "#voteBanner"), "Gast kann jetzt eine Abstimmung starten")

        ok(not host_err and not guest_err, f"Keine JS-Fehler ({(host_err + guest_err)[:2]})")
        await b.close()
    print("\n" + ("❌ %d Fehler" % len(FAILS) if FAILS else "✅ Hub-Rauchtest bestanden"))
    sys.exit(1 if FAILS else 0)

asyncio.run(main())

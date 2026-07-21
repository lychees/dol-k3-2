"""Test duplicate ship purchases + per-ship refit."""
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8734/index.html"
passed, failed = [], []

def check(name, cond):
    (passed if cond else failed).append(name)
    print(("OK  " if cond else "FAIL"), name)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    page.goto(URL)
    page.wait_for_timeout(2500)
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_timeout(2500)
    page.click("#start-overlay .go")
    page.wait_for_timeout(500)

    page.evaluate("window.UW.P.gold = 500000; window.UW.save()")
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1200)
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'dry_dock'))")
    page.wait_for_timeout(200)
    page.click("#building-actions button:has-text('Buy a new ship')")
    page.wait_for_timeout(500)

    # --- fleet section exists with current Balsa ---
    check("fleet section shown", "Your fleet" in page.inner_text("#shipyard-table"))
    # --- buy 2 more Balsas (duplicates allowed) ---
    page.click("#shipyard-table tr:has-text('Balsa') button:has-text('buy')")
    page.wait_for_timeout(300)
    page.click("#shipyard-table tr:has-text('Balsa') button:has-text('buy')")
    page.wait_for_timeout(300)
    n_balsa = page.evaluate("window.UW.P.fleet.filter(f => f.ship === 'Balsa').length")
    check(f"3 Balsas in fleet ({n_balsa})", n_balsa == 3)
    page.screenshot(path="tests/screenshots/dock_fleet.png")

    # --- refit the flagship: guns +1, hull +1, cargo +1, speed +1 ---
    g0 = page.evaluate("window.UW.P.gold")
    # click first 'refit' button (flagship row)
    page.click("#shipyard-table table:first-of-type tr:nth-child(2) button:has-text('refit')")
    page.wait_for_timeout(400)
    check("refit view shown", "Refit — Balsa" in page.inner_text("#shipyard-table"))
    guns0 = page.evaluate("(() => { const UW = window.UW; return null; })()") if False else None
    fg0 = page.evaluate("window.UW.P.fleet[0].hull")
    # fleet guns before: 3 x 10 = 30
    check("fleet guns base = 30", page.evaluate("window.UW.P.fleet.reduce((a,f) => a + (f.mods ? 10 * (1 + 0.2 * (f.mods.guns||0)) : 10), 0)") == 30)
    page.click("#shipyard-table tr:has-text('guns') button:has-text('upgrade')")
    page.wait_for_timeout(300)
    check("guns mod lv1", page.evaluate("window.UW.P.fleet[0].mods.guns") == 1)
    check("flagship guns 10 -> 12", "12" in page.inner_text("#shipyard-table tr:has-text('guns')"))
    page.click("#shipyard-table tr:has-text('hull (max)') button:has-text('upgrade')")
    page.wait_for_timeout(300)
    h1 = page.evaluate("window.UW.P.fleet[0].hull")
    check(f"hull mod adds current hp ({fg0} -> {h1})", h1 == fg0 + 12)  # 60*0.2=12
    page.click("#shipyard-table tr:has-text('cargo') button:has-text('upgrade')")
    page.wait_for_timeout(300)
    page.click("#shipyard-table tr:has-text('speed') button:has-text('upgrade')")
    page.wait_for_timeout(300)
    cost = 4 * 240   # Balsa 1200 * 0.2
    check("4 refits cost 960g", page.evaluate("window.UW.P.gold") == g0 - cost)
    page.screenshot(path="tests/screenshots/dock_refit.png")
    # back to shipyard
    page.click("#shipyard-table button:has-text('back to shipyard')")
    page.wait_for_timeout(300)
    check("mods shown in fleet row", "guns+1" in page.inner_text("#shipyard-table"))
    # max level: upgrade guns 2 more times -> lv3, then disabled
    page.click("#shipyard-table table:first-of-type tr:nth-child(2) button:has-text('refit')")
    page.wait_for_timeout(300)
    page.click("#shipyard-table tr:has-text('guns') button:has-text('upgrade')")
    page.wait_for_timeout(200)
    page.click("#shipyard-table tr:has-text('guns') button:has-text('upgrade')")
    page.wait_for_timeout(200)
    dis = page.evaluate("""Array.from(document.querySelectorAll('#shipyard-table tr'))
      .find(tr => tr.textContent.trim().startsWith('guns'))
      .querySelector('button').disabled""")
    check("guns mod maxed at lv3", page.evaluate("window.UW.P.fleet[0].mods.guns") == 3 and dis)
    page.click("#shipyard-table button:has-text('back to shipyard')")
    page.wait_for_timeout(300)

    # --- sell one duplicate Balsa ---
    n0 = page.evaluate("window.UW.P.fleet.length")
    page.click("#shipyard-table table:first-of-type tr:nth-child(3) button:has-text('sell')")
    page.wait_for_timeout(300)
    check("sold a duplicate Balsa", page.evaluate("window.UW.P.fleet.length") == n0 - 1
          and page.evaluate("window.UW.P.fleet.filter(f => f.ship === 'Balsa').length") == 2)

    # --- refit effects: fleet speed uses modded stats ---
    # flagship Balsa speed 9.0 + 0.3 = 9.3; fleet speed = min over fleet
    sp = page.evaluate("window.UW.P.fleet.map(f => f.mods ? f.mods.speed : 0)")
    check("speed mod applied", sp[0] == 1)

    print("ERRORS:", errors if errors else "none")
    print(f"\n{len(passed)} passed, {len(failed)} failed", failed if failed else "")
    browser.close()

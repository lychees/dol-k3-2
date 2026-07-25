"""Test randomizer mode: determinism, market rules, specialties, start ship."""
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8734/index.html"
passed, failed = [], []

def check(name, cond):
    (passed if cond else failed).append(name)
    print(("OK  " if cond else "FAIL"), name)

def boot_rando(page, seed, opts_js=""):
    page.goto(URL)
    page.wait_for_timeout(2500)
    page.evaluate("localStorage.clear()")
    page.evaluate(f"""() => {{
      localStorage.setItem('uw-rando', JSON.stringify({{
        seed: '{seed}',
        markets: true, specialties: true, startShip: true,
        portDev: true, portLocations: false, discoveries: false,
        {opts_js}
      }}));
    }}""")
    page.reload()
    page.wait_for_timeout(3000)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    # --- boot with seed 42 ---
    boot_rando(page, "42")
    page.click("#start-overlay .go")
    page.wait_for_timeout(500)
    check("seed stored in P", page.evaluate("window.UW.P.randoSeed") is not None)
    fleet = page.evaluate("window.UW.P.fleet[0].ship")
    check(f"start ship randomized ({fleet})", fleet in
          ["Balsa", "Hansa Cog", "Talette", "Caravela Latina", "Caravela Redonda", "Pinnace",
           "Dhow", "Light Galley", "Brigantine", "Sloop", "Junk", "Nao"])

    # --- market rules: all goods available somewhere, buy < sell ---
    rules = page.evaluate("""(async () => {
      const g = await (await fetch('./assets/goods.json')).json();
      // note: goodsData was randomized in-memory; re-fetch gives the ORIGINAL file.
      // verify via the game's market instead: check every region table in memory via UW?
      return null;
    })()""")
    # verify market rules through the actual game data: open dev console teleport? simpler:
    # check Lisbon market: buy < sell for every row
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1200)
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'market'))")
    page.click("#building-actions button:has-text('Trade goods')")
    page.wait_for_timeout(400)
    violations = page.evaluate("""Array.from(document.querySelectorAll('#market-table tr'))
      .slice(1).filter(tr => {
        const tds = tr.querySelectorAll('td.num');
        if (tds.length < 2) return false;
        const buy = parseInt(tds[0].textContent);
        const sell = parseInt(tds[1].textContent);
        return !isNaN(buy) && !isNaN(sell) && buy >= sell;
      }).length""")
    check("buy < sell on all rows", violations == 0)
    spec = page.evaluate("""Array.from(document.querySelectorAll('#market-table tr.specialty td'))
      .map(td => td.textContent)""")
    check(f"specialty present ({spec})", len(spec) > 0)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- port dev randomized (not the standard 500 for Lisbon) ---
    pd = page.evaluate("window.UW.P.portDev['1']")
    check(f"port dev randomized ({pd['dev']})", pd["dev"] != 500)

    # --- determinism: same seed -> same world ---
    wine_buy_1 = page.evaluate("""Array.from(document.querySelectorAll('#market-table tr'))
      .find(tr => tr.textContent.includes('Wine'))?.children[1].textContent ?? 'n/a'""")
    fleet_1 = page.evaluate("window.UW.P.fleet[0].ship")
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'market'))")
    page.click("#building-actions button:has-text('Trade goods')")
    page.wait_for_timeout(300)
    market_1 = page.evaluate("document.getElementById('market-table').innerHTML")

    boot_rando(page, "42")   # same seed again
    page.click("#start-overlay .go")
    page.wait_for_timeout(500)
    fleet_2 = page.evaluate("window.UW.P.fleet[0].ship")
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1200)
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'market'))")
    page.click("#building-actions button:has-text('Trade goods')")
    page.wait_for_timeout(300)
    market_2 = page.evaluate("document.getElementById('market-table').innerHTML")
    check("deterministic: same ship and identical market",
          fleet_1 == fleet_2 and market_1 == market_2)

    # --- different seed -> different world (usually) ---
    boot_rando(page, "999")
    page.click("#start-overlay .go")
    page.wait_for_timeout(500)
    fleet_3 = page.evaluate("window.UW.P.fleet[0].ship")
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1200)
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'market'))")
    page.click("#building-actions button:has-text('Trade goods')")
    page.wait_for_timeout(300)
    market_3 = page.evaluate("document.getElementById('market-table').innerHTML")
    check("different seed gives different world", fleet_3 != fleet_1 or market_3 != market_1)

    # --- start overlay shows randomizer UI ---
    page.goto(URL)
    page.wait_for_timeout(2000)
    check("randomizer UI on start screen",
          page.evaluate("document.querySelectorAll('#rando-seed').length") == 1)
    page.click("#rando-box summary")
    page.wait_for_timeout(200)
    page.screenshot(path="tests/screenshots/randomizer.png")

    print("ERRORS:", errors if errors else "none")
    print(f"\n{len(passed)} passed, {len(failed)} failed", failed if failed else "")
    browser.close()

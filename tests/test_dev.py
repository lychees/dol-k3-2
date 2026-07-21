"""Test dev mode, port minimap completeness, market filtering."""
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

    # --- dev mode: gold ---
    page.keyboard.press("`")
    page.wait_for_timeout(300)
    check("dev panel opens", page.is_visible("#dev-panel"))
    page.click("#dev-gold-1m")
    check("+1M gold", page.evaluate("window.UW.P.gold") == 1001000)
    page.fill("#dev-gold", "777")
    page.click("#dev-gold-set")
    check("set gold 777", page.evaluate("window.UW.P.gold") == 777)

    # --- dev mode: ship speed ---
    page.fill("#dev-speed", "30")
    page.click("#dev-speed-set")
    check("speed override set", page.evaluate("window.UW.P.devSpeed") == 30)
    page.keyboard.press("`")   # close panel
    page.wait_for_timeout(300)
    check("dev panel closed", not page.is_visible("#dev-panel"))

    # measure actual speed at sea
    page.evaluate("window.UW.teleport(700, 400)")
    page.wait_for_timeout(300)
    x0 = page.evaluate("window.UW.shipPos.x")
    page.keyboard.down("a")
    page.wait_for_timeout(2000)
    page.keyboard.up("a")
    x1 = page.evaluate("window.UW.shipPos.x")
    dist = x0 - x1
    check(f"ship fast with devSpeed=30 ({dist:.0f} tiles in 2s, expect ~60)", dist > 45)
    page.keyboard.press("`")
    page.click("#dev-speed-reset")
    check("speed override reset", page.evaluate("window.UW.P.devSpeed") is None)
    page.keyboard.press("`")

    # typing inside dev input should not trigger hotkeys
    page.keyboard.press("`")
    page.click("#dev-gold")
    page.fill("#dev-gold", "")
    page.keyboard.type("500")
    page.click("#dev-gold-set")
    check("typed gold in input (no hotkey leak)", page.evaluate("window.UW.P.gold") == 500)
    # dev panel must close even while the input still has focus
    page.keyboard.press("`")
    page.wait_for_timeout(200)
    check("dev panel closes with input focused", not page.is_visible("#dev-panel"))

    # --- market filtering: Lisbon sells 8 goods + 1 specialty ---
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1200)
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'market'))")
    page.wait_for_timeout(300)
    page.click("#building-actions button:has-text('Trade goods')")
    page.wait_for_timeout(400)
    n_rows = page.evaluate("document.querySelectorAll('#market-table tr').length - 1")
    n_dash = page.evaluate("Array.from(document.querySelectorAll('#market-table td.num')).filter(td => td.textContent === '—').length")
    check(f"market shows only sellable rows ({n_rows} rows, {n_dash} dashes)", n_rows == 9 and n_dash == 0)
    page.keyboard.press("Escape")   # close market panel first
    page.wait_for_timeout(300)
    # goods the player holds but are not sold here should appear (sell side)
    page.evaluate("window.UW.P.cargo = {'Clove': 5}")
    page.click("#building-actions button:has-text('Trade goods')")
    page.wait_for_timeout(300)
    check("held-but-not-local good appears for selling",
          page.is_visible("#market-table tr:has-text('Clove')"))
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- port minimap: full port visible (Lisbon city spans all rows) ---
    page.screenshot(path="tests/screenshots/dev_minimap_lisbon.png")
    # check the minimap canvas has content in its bottom rows (was cut off before)
    fill = page.evaluate("""() => {
      const c = document.getElementById('minimap');
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let nonEmpty = 0;
      for (let y = 100; y < c.height; y++)       // bottom band
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          if (!(d[i] < 10 && d[i+1] < 15 && d[i+2] < 25)) nonEmpty++;  // not background
        }
      return nonEmpty;
    }""")
    check(f"minimap bottom rows have content ({fill} px)", fill >= 4500)

    # Istanbul (city in the south half)
    page.evaluate("window.UW.enterPort(3)")
    page.wait_for_timeout(1200)
    page.screenshot(path="tests/screenshots/dev_minimap_istanbul.png")

    print("ERRORS:", errors if errors else "none")
    print(f"\n{len(passed)} passed, {len(failed)} failed", failed if failed else "")
    browser.close()

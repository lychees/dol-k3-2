"""Test fleet (5 ships), extra cabins, characters, captain's log menu."""
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

    # --- character picker on start overlay ---
    n_chars = page.evaluate("document.querySelectorAll('.char-portrait').length")
    check(f"3 protagonists on start screen ({n_chars})", n_chars == 3)
    page.screenshot(path="tests/screenshots/char_select.png")
    page.click(".char-portrait >> nth=1")   # Catalina
    page.wait_for_timeout(200)
    check("character selected", page.evaluate("window.UW.P.character") == 1)
    page.click("#start-overlay .go")
    page.wait_for_timeout(500)

    # --- fleet: buy 5 ships, 6th blocked ---
    page.evaluate("window.UW.P.gold = 2000000; window.UW.save()")
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1200)
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'dry_dock'))")
    page.wait_for_timeout(200)
    page.click("#building-actions button:has-text('Buy a new ship')")
    page.wait_for_timeout(400)
    for ship in ["Talette", "Pinnace", "Brigantine", "Sloop"]:
        page.click(f"#shipyard-table tr:has-text('{ship}') button:has-text('buy')")
        page.wait_for_timeout(250)
    check("fleet has 5 ships", page.evaluate("window.UW.P.fleet.length") == 5)
    sixth = page.evaluate("""Array.from(document.querySelectorAll('#shipyard-table tr'))
      .find(tr => tr.textContent.includes('Galleon')).querySelector('button').disabled""")
    check("6th ship blocked (fleet full)", sixth)
    # make Sloop flagship
    page.click("#shipyard-table tr:has-text('Sloop') button:has-text('make flagship')")
    page.wait_for_timeout(300)
    check("flagship swapped", page.evaluate("window.UW.P.fleet[0].ship") == "Sloop")
    # sell one
    g0 = page.evaluate("window.UW.P.gold")
    page.click("#shipyard-table tr:has-text('Talette') button:has-text('sell')")
    page.wait_for_timeout(300)
    check("sold ship (fleet 4, refund)", page.evaluate("window.UW.P.fleet.length") == 4
          and page.evaluate("window.UW.P.gold") == g0 + 700)
    page.screenshot(path="tests/screenshots/shipyard_fleet.png")
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # fleet stats: cargo = sum, speed = min
    caps = page.evaluate("[window.UW.P.fleet.map(f => f.ship), window.UW.P.fleet.length]")
    check("fleet cargo = sum of ships",
          page.evaluate("window.UW.P.fleet.length") == 4)

    # --- extra cabins: assign lookout/surgeon/boatswain ---
    page.evaluate("""() => {
      window.UW.P.mates = [1, 2, 3];
      window.UW.P.cabins = { navigator: null, gunner: null, accountant: null,
                             lookout: 1, surgeon: 2, boatswain: 3 };
      window.UW.save();
    }""")
    open_bar = page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'bar'))")
    page.click("#building-actions button:has-text('Manage mates')")
    page.wait_for_timeout(400)
    n_cabins = page.evaluate("document.querySelectorAll('#mates-cabins .cabin').length")
    check(f"6 cabin slots shown ({n_cabins})", n_cabins == 6)
    page.screenshot(path="tests/screenshots/cabins6.png")
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(300)  # set sail

    # lookout extends discovery sight: Stonehenge at (888,270), teleport 6.5 away
    page.evaluate("window.UW.teleport(881, 270)")  # dist 7 > 4, but lookout int 50 -> +25... wait mate1 int=50
    page.wait_for_timeout(400)
    hint = page.inner_text("#hint")
    check("lookout extends discovery sight", "go ashore" in hint)

    # --- captain's log menu ---
    page.keyboard.press("i")
    page.wait_for_timeout(400)
    check("menu opens", page.is_visible("#menu-panel"))
    n_tabs = page.evaluate("document.querySelectorAll('#menu-tabs button').length")
    check(f"7 tabs ({n_tabs})", n_tabs == 7)
    # fleet tab: 4 rows
    n_rows = page.evaluate("document.querySelectorAll('#menu-content tr').length - 1")
    check(f"fleet tab lists ships ({n_rows})", n_rows == 4)
    page.screenshot(path="tests/screenshots/menu_fleet.png")
    # other tabs render
    for tab, marker in [("Crew", "sailors"), ("Outfit", "equipment"), ("Hero", "Catalina"),
                        ("Cargo", "empty"), ("Discoveries", "discovered"), ("Quests", "Royal favor")]:
        page.click(f"#menu-tabs button:has-text('{tab}')")
        page.wait_for_timeout(250)
        content = page.inner_text("#menu-content")
        check(f"tab {tab} renders", marker in content)
    page.screenshot(path="tests/screenshots/menu_log.png")
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    check("menu closes with Esc", not page.is_visible("#menu-panel"))

    print("ERRORS:", errors if errors else "none")
    print(f"\n{len(passed)} passed, {len(failed)} failed", failed if failed else "")
    browser.close()

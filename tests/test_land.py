"""Test land expeditions + DQ-style battles."""
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
    page.evaluate("window.UW.setNoAutoSpawn(true)")

    # --- land on the coast at Lisbon (port tile 840,358 is land) ---
    page.evaluate("window.UW.teleport(839, 358)")
    page.wait_for_timeout(300)
    page.keyboard.press("l")
    page.wait_for_timeout(500)
    check("landed ashore", page.evaluate("window.UW.getScene2()") == "land")
    page.screenshot(path="tests/screenshots/land_mode.png")

    # --- walk on land (east, into Iberia) ---
    p0 = page.evaluate("[window.UW.P.hero.lv, window.UW.P.hero.hp]")
    # walk east
    page.keyboard.down("d"); page.wait_for_timeout(2000); page.keyboard.up("d")
    pos1 = page.evaluate("[window.UW.shipPos.x, window.UW.shipPos.z]")
    check("ship stays while exploring", pos1[0] == 839)
    hud = page.inner_text("#hud-top")
    check("land HUD shows hero", "lv 1" in hud and "on foot" in hud)

    # --- cannot walk into water ---
    page.keyboard.down("a"); page.wait_for_timeout(2500); page.keyboard.up("a")
    # --- land battle (forced) ---
    page.evaluate("window.UW.startLandBattle()")
    page.wait_for_timeout(500)
    check("land battle starts", page.is_visible("#land-battle"))
    b = page.evaluate("window.UW.getLandBattle()")
    check(f"enemy appeared ({b})", b and b.get("name"))
    page.screenshot(path="tests/screenshots/land_battle.png")
    # fight to the end
    for i in range(30):
        b = page.evaluate("window.UW.getLandBattle()")
        if b is None:
            break
        page.click("#lb-attack")
        page.wait_for_timeout(250)
    check("battle won (panel closed)", page.evaluate("window.UW.getLandBattle()") is None)
    check("got exp", page.evaluate("window.UW.P.hero.exp") > 0 or page.evaluate("window.UW.P.hero.lv") > 1)

    # --- buy hero equipment at item shop ---
    page.evaluate("window.UW.P.gold = 30000; window.UW.save()")
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1200)
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'item_shop'))")
    page.wait_for_timeout(300)
    page.click("#building-actions button:has-text('Cutlass')")
    page.wait_for_timeout(300)
    check("bought cutlass", page.evaluate("window.UW.P.hero.weapon") == 1)
    page.click("#building-actions button:has-text('Leather armor')")
    page.wait_for_timeout(300)
    check("bought leather armor", page.evaluate("window.UW.P.hero.armor") == 1)
    page.click("#building-actions button:has-text('Balm')")
    page.wait_for_timeout(300)
    check("bought balm", page.evaluate("window.UW.P.hero.balms") == 1)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- inn heals hero ---
    page.evaluate("window.UW.P.hero.hp = 5; window.UW.save()")
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'inn'))")
    page.wait_for_timeout(300)
    page.click("#building-actions button:has-text('Rest until morning')")
    page.wait_for_timeout(300)
    check("inn heals hero hp", page.evaluate("window.UW.P.hero.hp") == 28)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(300)  # set sail

    # --- discovery by walking to a site (Stonehenge at 888,270) ---
    page.evaluate("window.UW.teleport(886, 271)")
    page.wait_for_timeout(300)
    page.keyboard.press("l")
    page.wait_for_timeout(400)
    sc = page.evaluate("window.UW.getScene2()")
    if sc != "land":
        # try from the other side
        page.evaluate("window.UW.teleport(890, 271)")
        page.wait_for_timeout(300)
        page.keyboard.press("l")
        page.wait_for_timeout(400)
    check("landed near Stonehenge", page.evaluate("window.UW.getScene2()") == "land")
    # walk toward (888,270) — discovery auto-triggers within 1.5 tiles
    page.keyboard.down("d"); page.wait_for_timeout(1200); page.keyboard.up("d")
    page.keyboard.down("w"); page.wait_for_timeout(600); page.keyboard.up("w")
    page.wait_for_timeout(400)
    check("discovery found by walking to it", 48 in page.evaluate("window.UW.getDiscovered()"))
    page.screenshot(path="tests/screenshots/land_discovery.png")

    print("ERRORS:", errors if errors else "none")
    print(f"\n{len(passed)} passed, {len(failed)} failed", failed if failed else "")
    browser.close()

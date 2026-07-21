"""Test port entry, walking, buildings, set sail, and village discovery."""
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8734/index.html"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    page.goto(URL)
    page.wait_for_timeout(2500)
    page.click("#start-overlay .go")
    page.wait_for_timeout(500)

    # --- 1. sail east to Lisbon, then enter via E key ---
    page.keyboard.down("d")
    page.wait_for_timeout(1500)
    page.keyboard.up("d")
    page.wait_for_timeout(400)
    print("hint at start:", page.inner_text("#hint"))
    page.keyboard.press("e")
    page.wait_for_timeout(1500)
    print("scene:", page.evaluate("window.UW.getScene()"), "port:", page.evaluate("window.UW.getPortId()"))
    print("buildings:", page.evaluate("JSON.stringify(window.UW.getBuildings())"))
    page.screenshot(path="port_lisbon.png")

    # --- 2. walk north through the streets ---
    page.keyboard.down("w")
    page.wait_for_timeout(2500)
    page.keyboard.up("w")
    page.wait_for_timeout(300)
    page.screenshot(path="port_walk.png")
    pos = page.evaluate("[window.UW.personPos.x, window.UW.personPos.z]")
    print("person pos after walking:", pos)

    # --- 3. walk onto a building and enter it ---
    blds = page.evaluate("window.UW.getBuildings()")
    inn = next(b for b in blds if b["name"] == "inn")
    page.evaluate(f"window.UW.walkTo({inn['x'] + 0.5}, {inn['y'] + 0.5})")
    page.wait_for_timeout(400)
    print("hint on building:", page.inner_text("#hint"))
    page.keyboard.press("e")
    page.wait_for_timeout(500)
    print("in building:", page.evaluate("window.UW.getInBuilding()?.name"))
    page.screenshot(path="port_building.png")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    print("after esc, in building:", page.evaluate("window.UW.getInBuilding()"))

    # --- 4. set sail ---
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    print("scene after set sail:", page.evaluate("window.UW.getScene()"))

    # --- 5. village discovery: teleport near Stonehenge (888,270) ---
    page.evaluate("window.UW.teleport(885, 270)")
    page.wait_for_timeout(600)
    print("shipPos after teleport:", page.evaluate("[window.UW.shipPos.x, window.UW.shipPos.z]"))
    print("hint near village:", page.inner_text("#hint"))
    page.keyboard.press("g")
    page.wait_for_timeout(500)
    print("discovered:", page.evaluate("window.UW.getDiscovered()"))
    page.screenshot(path="village_discovery.png")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # --- 6. night in port ---
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1200)
    page.evaluate("window.UW.setTime(0.85 * 180)")
    page.wait_for_timeout(500)
    page.screenshot(path="port_night.png")

    print("ERRORS:", errors if errors else "none")
    browser.close()
print("ALL CHECKS DONE")

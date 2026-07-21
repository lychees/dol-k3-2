"""Verify texture fix + building access by walking (no teleport)."""
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
    page.click("#start-overlay")
    page.wait_for_timeout(500)

    # world map look after sRGB fix
    page.screenshot(path="fix_sea.png")

    # enter Lisbon
    page.keyboard.down("d")
    page.wait_for_timeout(1500)
    page.keyboard.up("d")
    page.wait_for_timeout(300)
    page.keyboard.press("e")
    page.wait_for_timeout(1500)
    page.screenshot(path="fix_port.png")
    print("hint at spawn:", page.inner_text("#hint"))

    # walk to the inn at (36,46) from spawn (~54.5,68): go west then north
    page.keyboard.down("a"); page.wait_for_timeout(3200); page.keyboard.up("a")
    page.keyboard.down("w"); page.wait_for_timeout(3800); page.keyboard.up("w")
    page.wait_for_timeout(300)
    pos = page.evaluate("[window.UW.personPos.x.toFixed(1), window.UW.personPos.z.toFixed(1)]")
    print("pos near inn (36,46):", pos, "| hint:", page.inner_text("#hint"))
    page.screenshot(path="fix_port_inn.png")

    # enter whatever building is near (should be inn or job_house)
    page.keyboard.press("e")
    page.wait_for_timeout(500)
    print("in building:", page.evaluate("window.UW.getInBuilding()?.name"))
    page.screenshot(path="fix_building.png")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # top-down close view for texture comparison
    page.evaluate("window.UW.walkTo(54.5, 67.5)")
    page.evaluate("window.UW.topDown(13)")
    page.wait_for_timeout(400)
    page.screenshot(path="fix_topdown.png")
    page.evaluate("window.UW.topDown(0)")

    print("ERRORS:", errors if errors else "none")
    browser.close()
print("DONE")

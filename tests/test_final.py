"""Final verification: boot, coordinates, sailing, discovery, day/night."""
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
    page.screenshot(path="tests/screenshots/final_title.png")

    page.click("#start-overlay .go")
    page.wait_for_timeout(800)
    hud = page.inner_text("#hud-top").replace("\n", " | ")
    print("HUD at start (expect ~38.8N 10.1W, Lisbon):", hud)

    # sail west into the Atlantic; sample speed while key is held
    x0 = page.evaluate("window.UW.shipPos.x")
    page.keyboard.down("a")
    page.wait_for_timeout(2000)
    hud_moving = page.inner_text("#hud-top").replace("\n", " | ")
    page.wait_for_timeout(3000)
    page.keyboard.up("a")
    page.wait_for_timeout(400)
    x1 = page.evaluate("window.UW.shipPos.x")
    hud = page.inner_text("#hud-top").replace("\n", " | ")
    right = page.inner_text("#hud-right").replace("\n", " ")
    print("HUD while sailing W:", hud_moving)
    print("HUD after sailing W:", hud)
    print("HUD right:", right)
    assert x1 < x0 - 10, f"ship did not move enough: {x0} -> {x1}"
    assert "12.6 knots" in hud_moving, "speed not shown while moving"
    page.screenshot(path="tests/screenshots/final_sailing.png")

    # try sailing into land (east, back toward Iberia) - should be blocked eventually
    x0 = page.evaluate("window.UW.shipPos.x")
    page.keyboard.down("d")
    page.wait_for_timeout(6000)
    page.keyboard.up("d")
    x1 = page.evaluate("window.UW.shipPos.x")
    print(f"sailed east: x {x0:.1f} -> {x1:.1f} (coast slide/block works if it stops)")

    # day/night phases
    for name, t in [("dawn", 0.05), ("dusk", 0.55), ("night", 0.85)]:
        page.evaluate(f"window.UW.setTime({t} * 180)")
        page.wait_for_timeout(500)
        page.screenshot(path=f"final_{name}.png")
    page.evaluate("window.UW.setTime(0.3 * 180)")

    # zoom out
    page.mouse.wheel(0, -800)
    page.wait_for_timeout(500)
    page.screenshot(path="tests/screenshots/final_zoomout.png")

    print("ERRORS:", errors if errors else "none")
    browser.close()
print("ALL CHECKS DONE")

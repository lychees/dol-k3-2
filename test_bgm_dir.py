"""Verify direction sprites, regional BGM, discovery sfx."""
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8734/index.html"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 800, "height": 600})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    page.goto(URL)
    page.wait_for_timeout(2500)
    page.click("#start-overlay")
    page.wait_for_timeout(500)
    print("start music:", page.evaluate("window.UW.getMusic()"))

    # --- ship directions (zoom in close) ---
    page.evaluate("window.UW.teleport(700, 400)")   # open Atlantic
    page.evaluate("window.UW.setZoom(12)")
    page.wait_for_timeout(300)
    for key, name in [("w", "north"), ("d", "east"), ("s", "south"), ("a", "west")]:
        page.keyboard.down(key)
        page.wait_for_timeout(700)
        page.screenshot(path=f"dir_ship_{name}.png")
        page.keyboard.up(key)
        page.wait_for_timeout(200)

    # --- port music mapping ---
    for pid, expect in [(1, "Lisbon.mp3"), (3, "Middle Eastern Town.mp3"),
                        (99, "Japan Town.mp3"), (28, "Northern Europe Town.mp3"),
                        (43, "South America Town.mp3"), (120, "Oceania Town.mp3"),
                        (105, "port.ogg")]:
        page.evaluate(f"window.UW.enterPort({pid})")
        page.wait_for_timeout(1000)
        cur = page.evaluate("window.UW.getMusic()")
        ok = expect in cur
        print(f"port {pid}: {'OK' if ok else 'FAIL'} -> {cur.split('/')[-1]} (expect {expect})")

    # --- person directions in port ---
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1000)
    page.evaluate("window.UW.walkTo(54.5, 69.5)")  # open plaza
    page.evaluate("window.UW.setZoom(10)")
    page.wait_for_timeout(300)
    for key, name in [("w", "north"), ("d", "east"), ("s", "south"), ("a", "west")]:
        page.keyboard.down(key)
        page.wait_for_timeout(600)
        page.screenshot(path=f"dir_person_{name}.png")
        page.keyboard.up(key)
        page.wait_for_timeout(200)

    # --- set sail music (from Lisbon -> Mediterranean) ---
    page.evaluate("window.UW.setZoom(20)")
    print("scene before esc:", page.evaluate("window.UW.getScene()"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)
    print("scene after esc:", page.evaluate("window.UW.getScene()"))
    print("set sail music:", page.evaluate("window.UW.getMusic()"),
          "| sfx:", page.evaluate("window.UW.getSfx()"))

    # --- discovery sfx ---
    page.evaluate("window.UW.teleport(885, 270)")
    page.wait_for_timeout(400)
    page.keyboard.press("g")
    page.wait_for_timeout(500)
    print("discovery sfx:", page.evaluate("window.UW.getSfx()"))

    print("ERRORS:", errors if errors else "none")
    browser.close()
print("DONE")

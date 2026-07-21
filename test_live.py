import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 800})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto("https://lychees.github.io/dol-k3-2/game/"); pg.wait_for_timeout(5000)
    pg.evaluate("localStorage.clear()"); pg.reload(); pg.wait_for_timeout(5000)
    print("main.js marker (render line):")
    src = pg.evaluate("fetch('./main.js').then(r => r.text())")
    print("  port?seaScene line present:", "scene === 'port' ? portScene : seaScene" in src)
    print("  old line present:", "scene === 'sea' ? seaScene : portScene" in src)

    # user path: start, sail a bit east toward Lisbon coast, land
    pg.click("#start-overlay .go"); pg.wait_for_timeout(500)
    pg.evaluate("window.UW.setNoAutoSpawn(true)")
    pg.keyboard.down("d"); pg.wait_for_timeout(1200); pg.keyboard.up("d")
    pg.wait_for_timeout(400)
    print("pos:", pg.evaluate("[Math.round(window.UW.shipPos.x), Math.round(window.UW.shipPos.z)]"))
    pg.keyboard.press("l"); pg.wait_for_timeout(600)
    print("scene after L:", pg.evaluate("window.UW.getScene2()"))
    pg.screenshot(path="live_land1.png")
    # walk on land
    pg.keyboard.down("d"); pg.wait_for_timeout(2000); pg.keyboard.up("d")
    pg.screenshot(path="live_land2.png")
    # re-board
    pg.keyboard.down("a"); pg.wait_for_timeout(2000); pg.keyboard.up("a")
    pg.wait_for_timeout(300)
    pg.keyboard.press("l"); pg.wait_for_timeout(400)
    print("scene after re-board:", pg.evaluate("window.UW.getScene2()"))
    pg.screenshot(path="live_land3.png")
    print("ERRORS:", errs if errs else "none")
    b.close()

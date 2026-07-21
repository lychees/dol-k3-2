"""Test crew/hull dual health + boarding melee."""
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

    page.evaluate("window.UW.P.fleet = [{ship: 'Galleon', hull: 1000}]; window.UW.P.crew = 60; window.UW.save()")
    page.evaluate("window.UW.teleport(700, 400)")
    page.wait_for_timeout(300)

    # --- enemy has crew (dual health) ---
    page.evaluate("window.UW.spawnPirate(702, 400, 'Nao')")
    b = None
    for _ in range(60):
        page.wait_for_timeout(500)
        b = page.evaluate("window.UW.getBattle()")
        if b is not None:
            break
    check("battle started", b is not None)
    ec = page.evaluate("window.UW.getEnemyCrew()")
    check(f"enemy has crew pool ({ec})", ec and ec >= 20)
    check("HUD shows crew", "crew" in page.inner_text("#battle-enemy-label")
          and "crew" in page.inner_text("#battle-my-label"))

    # --- player volley causes enemy crew casualties ---
    page.keyboard.press("Space")
    page.wait_for_timeout(2500)
    ec2 = page.evaluate("window.UW.getEnemyCrew()")
    check(f"cannon volley hurt enemy crew ({ec} -> {ec2})", ec2 < ec)

    # --- enemy volleys cause player crew casualties ---
    c0 = page.evaluate("window.UW.P.crew")
    for _ in range(40):
        page.wait_for_timeout(500)
        if page.evaluate("window.UW.P.crew") < c0:
            break
    check("enemy volley hurt player crew", page.evaluate("window.UW.P.crew") < c0)

    # --- boarding: cripple enemy crew, then board and capture ---
    page.evaluate("window.UW.hurtEnemyCrew(500)")   # enemy crew ~0... but melee needs >0
    page.evaluate("window.UW.P.crew = 60; window.UW.save()")
    page.evaluate("window.UW.hurtEnemyCrew(-30)")   # heal enemy crew a bit for the melee
    ec3 = page.evaluate("window.UW.getEnemyCrew()")
    fleet0 = page.evaluate("window.UW.P.fleet.length")
    fame0 = page.evaluate("window.UW.P.fame")
    # ensure adjacency then press B
    page.evaluate("window.UW.teleport(window.UW.getBattle().ex + 1, window.UW.getBattle().ez)")
    page.wait_for_timeout(300)
    page.keyboard.press("b")
    page.wait_for_timeout(800)
    print("battle after B:", page.evaluate("window.UW.getBattle()"))
    print("fleet after B:", page.evaluate("JSON.stringify(window.UW.P.fleet)"))
    check("boarding melee won (battle over)", page.evaluate("window.UW.getBattle()") is None)
    check("enemy ship captured into fleet",
          page.evaluate("window.UW.P.fleet.length") == fleet0 + 1)
    check("captured ship is the Nao", page.evaluate("window.UW.P.fleet.some(f => f.ship === 'Nao')"))
    check("capture fame +5", page.evaluate("window.UW.P.fame") == fame0 + 5)
    page.screenshot(path="boarding_win.png")

    # --- enemy crew 0 by cannon => capture as well ---
    page.evaluate("window.UW.teleport(700, 400)")
    page.wait_for_timeout(300)
    page.evaluate("window.UW.spawnPirate(702, 400, 'Balsa')")
    for _ in range(60):
        page.wait_for_timeout(500)
        if page.evaluate("window.UW.getBattle()") is not None:
            break
    page.evaluate("window.UW.hurtEnemyCrew(100)")
    print("enemy crew before volley:", page.evaluate("window.UW.getEnemyCrew()"))
    page.keyboard.press("Space")   # one volley: crew casualty pushes to 0 -> capture
    page.wait_for_timeout(2500)
    print("battle:", page.evaluate("window.UW.getBattle()"))
    print("fleet:", page.evaluate("JSON.stringify(window.UW.P.fleet)"))
    print("enemy crew after:", page.evaluate("window.UW.getEnemyCrew()"))
    check("cannon crew-wipe captures too",
          page.evaluate("window.UW.P.fleet.some(f => f.ship === 'Balsa')"))

    print("ERRORS:", errors if errors else "none")
    print(f"\n{len(passed)} passed, {len(failed)} failed", failed if failed else "")
    browser.close()

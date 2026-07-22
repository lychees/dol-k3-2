"""Test dev console: tabs, encyclopedias, teleport."""
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

    page.keyboard.press("`")
    page.wait_for_timeout(400)
    n_tabs = page.evaluate("document.querySelectorAll('#dev-tabs button').length")
    check(f"5 dev tabs ({n_tabs})", n_tabs == 5)

    # cheats still works
    check("cheats tab default", page.is_visible("#dev-cheats"))
    page.click("#dev-gold-1m")
    check("gold cheat", page.evaluate("window.UW.P.gold") == 1001000)

    # monsters encyclopedia
    page.click("#dev-tabs button:has-text('Monsters')")
    page.wait_for_timeout(300)
    n = page.evaluate("document.querySelectorAll('#dev-content .mate-card').length")
    check(f"8 monsters ({n})", n == 8)
    check("monster has canvas art", page.evaluate("document.querySelectorAll('#dev-content canvas.disc-thumb').length") == 8)
    page.screenshot(path="tests/screenshots/dev_monsters.png")

    # mates encyclopedia
    page.click("#dev-tabs button:has-text('Mates')")
    page.wait_for_timeout(300)
    n = page.evaluate("document.querySelectorAll('#dev-content .mate-card').length")
    check(f"50 mates ({n})", n == 50)
    txt = page.inner_text("#dev-content")
    check("mate shows home port", "Seville" in txt)
    page.screenshot(path="tests/screenshots/dev_mates.png")

    # discoveries encyclopedia
    page.click("#dev-tabs button:has-text('Discoveries')")
    page.wait_for_timeout(300)
    n = page.evaluate("document.querySelectorAll('#dev-content .mate-card').length")
    check(f"110 discoveries ({n})", n == 110)
    check("discovery shows coords", "°" in page.inner_text("#dev-content"))

    # teleport
    page.click("#dev-tabs button:has-text('Teleport')")
    page.wait_for_timeout(300)
    n = page.evaluate("document.querySelectorAll('#dev-tp-port option').length")
    check(f"130 ports in teleport list ({n})", n == 130)
    # find Istanbul (id 3) and teleport
    page.select_option("#dev-tp-port", "3")
    page.click("#dev-tp-go")
    page.wait_for_timeout(500)
    pos = page.evaluate("[Math.round(window.UW.shipPos.x), Math.round(window.UW.shipPos.z)]")
    ist = page.evaluate("window.UW.P && [880, 300]")  # istanbul coords from ports.json
    import json
    ports = json.load(open('game/assets/ports.json'))
    ist_p = next(x for x in ports if x['id'] == 3)
    d = ((pos[0] - ist_p['x']) ** 2 + (pos[1] - ist_p['y']) ** 2) ** 0.5
    check(f"teleported near Istanbul (dist {d:.1f})", d < 12)
    check("dev panel closed after teleport", not page.is_visible("#dev-panel"))
    check("still at sea", page.evaluate("window.UW.getScene()") == "sea")
    page.screenshot(path="tests/screenshots/dev_teleport.png")

    print("ERRORS:", errors if errors else "none")
    print(f"\n{len(passed)} passed, {len(failed)} failed", failed if failed else "")
    browser.close()

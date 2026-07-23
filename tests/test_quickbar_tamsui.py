"""Test port quick bar + Tamsui port."""
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

    # --- quick bar in Lisbon ---
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1500)
    n_btns = page.evaluate("document.querySelectorAll('#port-quickbar button').length")
    check(f"quickbar has 11 buttons ({n_btns})", n_btns == 11)
    check("quickbar visible", page.is_visible("#port-quickbar"))
    # click Market -> market building opens
    page.click("#port-quickbar button:has-text('Market')")
    page.wait_for_timeout(400)
    check("Market opens via quickbar", page.evaluate("window.UW.getInBuilding()?.name") == "market")
    check("quickbar hidden while in building", not page.is_visible("#port-quickbar"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check("quickbar back after leaving", page.is_visible("#port-quickbar"))
    # click Church
    page.click("#port-quickbar button:has-text('Church')")
    page.wait_for_timeout(300)
    check("Church opens via quickbar", page.evaluate("window.UW.getInBuilding()?.name") == "church")
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)

    # --- Tamsui exists on the map ---
    check("HUD ports count 131", "131" in page.inner_text("#hud-right"))
    page.screenshot(path="tests/screenshots/quickbar.png")

    # --- enter Tamsui ---
    page.keyboard.press("Escape")  # set sail
    page.wait_for_timeout(300)
    page.evaluate("window.UW.enterPort(131)")
    page.wait_for_timeout(1500)
    check("entered Tamsui", page.evaluate("window.UW.getScene()") == "port"
          and page.evaluate("window.UW.getPortId()") == 131)
    print("   banner:", page.inner_text("#banner"))
    n_bld = page.evaluate("window.UW.getBuildings().length")
    check(f"Tamsui has 10 buildings ({n_bld})", n_bld == 10)
    check("Tamsui music is China Town", "China Town" in page.evaluate("window.UW.getMusic()"))
    check("Tamsui quickbar built", page.evaluate("document.querySelectorAll('#port-quickbar button').length") == 10)
    page.screenshot(path="tests/screenshots/tamsui.png")

    # --- Tamsui buildings work: open market via quickbar ---
    page.click("#port-quickbar button:has-text('Market')")
    page.wait_for_timeout(300)
    check("Tamsui market opens", page.evaluate("window.UW.getInBuilding()?.name") == "market")
    page.click("#building-actions button:has-text('Trade goods')")
    page.wait_for_timeout(400)
    rows = page.evaluate("document.querySelectorAll('#market-table tr').length - 1")
    check(f"Tamsui market has goods ({rows} rows)", rows > 0)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    # set sail from Tamsui: sea music = East Asia Sea
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    check("East Asia Sea on set sail", "East Asia Sea" in page.evaluate("window.UW.getMusic()"))

    print("ERRORS:", errors if errors else "none")
    print(f"\n{len(passed)} passed, {len(failed)} failed", failed if failed else "")
    browser.close()

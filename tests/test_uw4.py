"""Test UW4 cabins (per-ship, assignment, refit) + UW3 land terrain."""
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

    # --- UW4: ships get default cabins by size ---
    page.evaluate("window.UW.P.gold = 500000; window.UW.save()")
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1200)
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'dry_dock'))")
    page.wait_for_timeout(200)
    page.click("#building-actions button:has-text('Buy a new ship')")
    page.wait_for_timeout(400)
    page.evaluate("""() => {
      const tr = Array.from(document.querySelectorAll('#shipyard-table table')[1].querySelectorAll('tr'))
        .find(tr => tr.children[1].textContent.trim() === 'Galleon');
      tr.querySelector('button').click();
    }""")
    page.wait_for_timeout(300)
    balsa_cabins = page.evaluate("window.UW.P.fleet[0].cabins")
    galleon_cabins = page.evaluate("window.UW.P.fleet[1].cabins")
    check(f"Balsa has 2 cabins ({balsa_cabins})", len(balsa_cabins) == 2)
    check(f"Galleon has 5 cabins ({galleon_cabins})", len(galleon_cabins) == 5)

    # --- cabin refit: change a cabin type ---
    page.click("#shipyard-table table:first-of-type tr:nth-child(3) button:has-text('refit')")
    page.wait_for_timeout(400)
    check("cabin refit section", "Cabins" in page.inner_text("#shipyard-table"))
    g0 = page.evaluate("window.UW.P.gold")
    page.evaluate("""() => {
      const sel = document.querySelectorAll('#shipyard-table table')[1]
        .querySelectorAll('tr')[1].querySelector('select');
      sel.value = 'chapel';
    }""")
    page.click("#shipyard-table table:nth-of-type(2) tr:nth-child(2) button:has-text('refit 500g')")
    page.wait_for_timeout(300)
    check("cabin refit to chapel", page.evaluate("window.UW.P.fleet[1].cabins[0]") == "chapel")
    check("refit cost 500g", page.evaluate("window.UW.P.gold") == g0 - 500)
    page.screenshot(path="tests/screenshots/uw4_cabinrefit.png")
    page.click("#shipyard-table button:has-text('back to shipyard')")
    page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- mate assignment via mates panel ---
    page.evaluate("window.UW.P.mates = [1, 2, 3]; window.UW.save()")
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'bar'))")
    page.wait_for_timeout(200)
    page.click("#building-actions button:has-text('Manage mates')")
    page.wait_for_timeout(400)
    check("cabins shown by ship", page.evaluate("document.querySelectorAll('#mates-cabins .cabin').length") == 7)
    n_selects = page.evaluate("document.querySelectorAll('#mates-table select').length")
    check(f"3 mate dropdowns ({n_selects})", n_selects == 3)
    # assign mate 1 (John) to Balsa's navigation cabin
    page.evaluate("""() => {
      const sel = document.querySelector('#mates-table select');
      sel.value = '0:1';   // Balsa slot 1 = navigation
      sel.dispatchEvent(new Event('change'));
    }""")
    page.wait_for_timeout(300)
    check("mate assigned to 0:1", page.evaluate("window.UW.P.shipCabins['1']") == "0:1")
    page.screenshot(path="tests/screenshots/uw4_assign.png")
    # unassign mate 1 (dropdown to ''), then assign mate 3 to the freed cabin
    page.evaluate("""() => {
      const sel = document.querySelectorAll('#mates-table select')[0];
      sel.value = '';
      sel.dispatchEvent(new Event('change'));
    }""")
    page.wait_for_timeout(300)
    check("mate 1 unassigned", page.evaluate("window.UW.P.shipCabins['1'] ?? null") is None)
    page.evaluate("""() => {
      const sel = document.querySelectorAll('#mates-table select')[2];
      sel.value = '0:1';
      sel.dispatchEvent(new Event('change'));
    }""")
    page.wait_for_timeout(300)
    check("cabin re-assigned to mate 3", page.evaluate("window.UW.P.shipCabins['3']") == "0:1"
          and page.evaluate("window.UW.P.shipCabins['1'] ?? null") is None)

    # --- UW3: land terrain + provisions drain ---
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(300)  # set sail
    page.evaluate("window.UW.teleport(839, 358)")
    page.wait_for_timeout(300)
    page.keyboard.press("l")
    page.wait_for_timeout(400)
    check("landed", page.evaluate("window.UW.getScene2()") == "land")
    hud = page.inner_text("#hud-top")
    check("land HUD shows terrain+food", "plains" in hud and "food" in hud)
    # advance a day on land: provisions drain
    prov0 = page.evaluate("window.UW.P.provisions")
    page.evaluate("window.UW.setTime(179.5)")  # near day end
    page.wait_for_timeout(1000)  # day wraps
    prov1 = page.evaluate("window.UW.P.provisions")
    check(f"land provisions drain ({prov0} -> {prov1})", prov1 < prov0)
    # snow terrain at high latitude
    page.evaluate("window.UW.setTime(90)")
    page.evaluate("window.UW.landTo(900, 100)")  # high latitude -> snow
    page.wait_for_timeout(400)
    check("snow terrain shown", "snow" in page.inner_text("#hud-top"))
    # desert band
    page.evaluate("window.UW.landTo(900, 500)")
    page.wait_for_timeout(400)
    check("desert terrain shown", "desert" in page.inner_text("#hud-top"))

    print("ERRORS:", errors if errors else "none")
    print(f"\n{len(passed)} passed, {len(failed)} failed", failed if failed else "")
    browser.close()

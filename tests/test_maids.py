"""Test ship crew/tacking columns + bar maids."""
from playwright.sync_api import sync_playwright
import json

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

    # --- shipyard shows crew + tacking ---
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1200)
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'dry_dock'))")
    page.wait_for_timeout(200)
    page.click("#building-actions button:has-text('Buy a new ship')")
    page.wait_for_timeout(400)
    header = page.inner_text("#shipyard-table tr:first-child")
    check("shipyard has crew column", "crew" in header)
    check("shipyard has tack column", "tack" in header)
    sloop_row = page.inner_text("#shipyard-table tr:has-text('Sloop')")
    check("Sloop shows crew 5-60", "5-60" in sloop_row)
    check("Sloop shows tacking", str(json.load(open("game/assets/ships.json"))["Sloop"]["tacking"]) in sloop_row)
    page.screenshot(path="tests/screenshots/shipyard_crew.png")
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- bar maid (Lisbon has maid 16 per hash_ports_meta_data) ---
    meta = json.load(open('game/assets/port_meta.json'))
    maid_id = meta['1'].get('maid')
    check(f"Lisbon has a maid ({maid_id})", maid_id is not None)
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'bar'))")
    page.wait_for_timeout(300)
    has_btn = page.evaluate("Array.from(document.querySelectorAll('#building-actions button')).some(b => b.textContent.includes('waitress'))")
    check("waitress button in bar", has_btn)
    page.click("#building-actions button:has-text('waitress')")
    page.wait_for_timeout(300)
    txt = page.inner_text("#building-text")
    maids = json.load(open('game/assets/maids.json'))
    check(f"maid greets by name ({maids[str(maid_id)]['name']})",
          maids[str(maid_id)]['name'] in txt and "How are you" in txt)
    # submenu persists (Ask for info / Tell story / Buy a drink)
    check("maid submenu persists",
          page.evaluate("Array.from(document.querySelectorAll('#building-actions button')).some(b => b.textContent.includes('Ask for info'))"))
    # ask for info -> trade tip
    page.click("#building-actions button:has-text('Ask for info')")
    page.wait_for_timeout(300)
    txt = page.inner_text("#building-text")
    check("maid gives trade tip", "price" in txt or "personal" in txt)
    print("   info:", txt[:120])
    # buy a drink -> discovery coords
    page.click("#building-actions button:has-text('waitress')")
    page.wait_for_timeout(200)
    page.evaluate("window.UW.P.gold = 1000; window.UW.save()")
    page.click("#building-actions button:has-text('Buy her a drink')")
    page.wait_for_timeout(300)
    txt = page.inner_text("#building-text")
    check("drink -> discovery coords", "°" in txt or "sweet" in txt)
    print("   drink:", txt[:140])
    page.screenshot(path="tests/screenshots/maid_dialog.png")

    # --- port without maid: no waitress button ---
    # find a port id without maid in meta
    no_maid = next(int(k) for k in meta if 'maid' not in meta[k] and int(k) <= 101)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(300)
    page.evaluate(f"window.UW.enterPort({no_maid})")
    page.wait_for_timeout(1200)
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'bar'))")
    page.wait_for_timeout(300)
    has_btn = page.evaluate("Array.from(document.querySelectorAll('#building-actions button')).some(b => b.textContent.includes('waitress'))")
    check(f"no waitress in port {no_maid}", not has_btn)

    print("ERRORS:", errors if errors else "none")
    print(f"\n{len(passed)} passed, {len(failed)} failed", failed if failed else "")
    browser.close()

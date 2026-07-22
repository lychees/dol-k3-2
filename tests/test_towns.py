"""Test land towns, ruins, new discoveries."""
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
    page.evaluate("window.UW.setNoAutoSpawn(true)")

    # --- villages.json now has 110 entries ---
    n_vil = page.evaluate("window.UW.getDiscovered().length")
    check("villages count in HUD (110)", "110" in page.inner_text("#hud-right"))

    # --- teleport near Madrid (873,348), land and enter town ---
    towns = json.load(open('game/assets/towns.json'))
    mad = next(t for t in towns if t['name'] == 'Madrid')
    page.evaluate("window.UW.teleport(839, 358)")  # coast near Lisbon
    page.wait_for_timeout(300)
    page.keyboard.press("l")
    page.wait_for_timeout(400)
    check("landed", page.evaluate("window.UW.getScene2()") == "land")
    # walk toward Madrid (east)
    page.evaluate(f"window.UW.teleport({mad['x']}, {mad['z']})") if False else None
    # teleport ship near Madrid's coast then land: Madrid is inland; just walk there via debug: set landPos via reboard trick
    # simpler: use UW debug to put us near the town: reboard at ship won't move us; walk via keys would take long.
    # Use a direct landPos set through reboard: not exposed; instead land near Madrid via teleporting ship to nearest coast is complex.
    # For testability: check hint logic by walking — but faster: evaluate nearestTown after forcing landPos via shipPos+landOn
    # We'll walk east for a while won't reach (Madrid ~35 tiles). Use debug: temporarily move ship? landPos follows ship only at landOn.
    # Alternative: re-land near Madrid: teleport ship to a coast near Madrid is impossible (inland).
    # So: directly test the town panel via UW.openTown with the town object.
    page.evaluate(f"window.UW.openTown({{id: {mad['id']}, name: 'Madrid', x: {mad['x']}, z: {mad['z']}}})")
    page.wait_for_timeout(300)
    check("town panel opens", page.is_visible("#town-panel"))
    check("town name", page.inner_text("#town-name") == "Madrid")
    page.screenshot(path="tests/screenshots/town_panel.png")
    # rest heals
    page.evaluate("window.UW.P.hero.hp = 5; window.UW.save()")
    page.click("#town-actions button:has-text('Rest at the inn')")
    page.wait_for_timeout(300)
    check("town rest heals hero", page.evaluate("window.UW.P.hero.hp") == 28)
    # rumors give coords
    page.click("#town-actions button:has-text('Hear rumors')")
    page.wait_for_timeout(300)
    check("town rumor coords", "°" in page.inner_text("#town-text"))
    page.click("#town-actions button:has-text('Leave')")
    page.wait_for_timeout(200)
    check("town closes", not page.is_visible("#town-panel"))

    # --- ruin run ---
    ruins = json.load(open('game/assets/ruins.json'))
    r0 = ruins[0]
    page.evaluate(f"window.UW.startRuin({{id: {r0['id']}, name: '{r0['name']}', x: {r0['x']}, z: {r0['z']}, desc: 'test'}})")
    page.wait_for_timeout(300)
    check("ruin panel opens", page.is_visible("#ruin-panel"))
    check("ruin name", page.inner_text("#ruin-name") == r0['name'])
    g0 = page.evaluate("window.UW.P.gold")
    # click through all stages + sanctum
    for i in range(10):
        if page.evaluate("window.UW.getRuinRun()") is None and page.evaluate("window.UW.getLandBattle()") is None:
            break
        if page.evaluate("window.UW.getLandBattle()") is not None:
            # win the battle
            for j in range(30):
                if page.evaluate("window.UW.getLandBattle()") is None:
                    break
                page.click("#lb-attack")
                page.wait_for_timeout(200)
            page.wait_for_timeout(2000)   # battle end callback
        else:
            page.click("#ruin-continue")
            page.wait_for_timeout(300)
    check("ruin run completed", page.evaluate("window.UW.getRuinRun()") is None)
    gained = page.evaluate("window.UW.P.gold") - g0
    check(f"ruin gave treasure (+{gained}g)", gained > 0)
    check("ruin cooldown set", page.evaluate("window.UW.P.ruinCd && Object.keys(window.UW.P.ruinCd).length > 0"))
    page.screenshot(path="tests/screenshots/ruin_run.png")

    # --- new discovery: Mount Fuji (id 99) is discoverable by foot ---
    fuji = json.load(open('game/assets/villages.json'))
    fuji_v = next(v for v in fuji if v['name'] == 'Mount Fuji')
    check("Mount Fuji in villages.json", fuji_v is not None)
    # walk to it via land mode: land near it (teleport ship to coast then L; Fuji is inland far from coast...
    # instead verify data + encyclopedia rendering in dev console
    page.keyboard.press("`")
    page.wait_for_timeout(300)
    page.click("#dev-tabs button:has-text('Discoveries')")
    page.wait_for_timeout(300)
    n = page.evaluate("document.querySelectorAll('#dev-content .mate-card').length")
    check(f"110 discoveries in encyclopedia ({n})", n == 110)
    check("Mount Fuji shown", "Mount Fuji" in page.inner_text("#dev-content"))
    page.screenshot(path="tests/screenshots/dev_discoveries_new.png")

    print("ERRORS:", errors if errors else "none")
    print(f"\n{len(passed)} passed, {len(failed)} failed", failed if failed else "")
    browser.close()

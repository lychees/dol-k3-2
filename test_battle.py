"""Test goods icons/profit, shipyard, naval battle."""
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
    page.click("#start-overlay")
    page.wait_for_timeout(500)

    # --- market: icons + profit coloring ---
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1200)
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'market'))")
    page.wait_for_timeout(200)
    page.click("#building-actions button:has-text('Trade goods')")
    page.wait_for_timeout(400)
    n_icons = page.evaluate("document.querySelectorAll('#market-table img.good-icon').length")
    check(f"goods have icons ({n_icons})", n_icons == 9)
    # buy 10 wine at 36 -> sell price 20 shows red loss
    page.click("#market-table tr:has-text('Wine') button:has-text('+10')")
    page.wait_for_timeout(300)
    wine_cell = page.inner_text("#market-table tr:has-text('Wine') td.num:nth-child(4)")
    has_neg = page.evaluate("""Array.from(document.querySelectorAll('#market-table tr'))
      .some(tr => tr.textContent.includes('Wine') && tr.querySelector('.neg') !== null)""")
    check(f"sell price shows loss in red ({wine_cell.strip()})", has_neg)
    # sell all -> loss message in red
    page.click("#market-table tr:has-text('Wine') button:has-text('all')")
    page.wait_for_timeout(300)
    info = page.inner_html("#market-info")
    check("sale message shows loss in red", "loss" in info and "neg" in info)
    # buy Rock Salt at 38 (specialty)... sell price is higher? check profit path via a profit sale
    page.click("#market-table tr:has-text('Rock Salt') button:has-text('+1')")
    page.wait_for_timeout(300)
    page.click("#market-table tr:has-text('Rock Salt') button:has-text('-1')")
    page.wait_for_timeout(300)
    info = page.inner_html("#market-info")
    check("profit/loss message on sale", ("pos" in info or "neg" in info))
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.screenshot(path="goods_icons.png")

    # --- shipyard: 22 ships, buy Balsa->upgrade ---
    page.evaluate("window.UW.P.gold = 50000; window.UW.save()")
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'dry_dock'))")
    page.wait_for_timeout(200)
    page.click("#building-actions button:has-text('Buy a new ship')")
    page.wait_for_timeout(400)
    n_ships = page.evaluate("document.querySelectorAll('#shipyard-table tr').length - 1")
    check(f"shipyard lists 22 ships ({n_ships})", n_ships == 22)
    page.screenshot(path="shipyard.png")
    # buy Sloop (16000)
    page.click("#shipyard-table tr:has-text('Sloop') button:has-text('buy')")
    page.wait_for_timeout(300)
    check("bought Sloop", page.evaluate("window.UW.P.ship") == "Sloop"
          and page.evaluate("window.UW.P.gold") == 50000 - 16000
          and page.evaluate("window.UW.P.hull") == 100)
    own_disabled = page.evaluate("""Array.from(document.querySelectorAll('#shipyard-table tr'))
      .find(tr => tr.textContent.includes('Sloop')).querySelector('button').disabled""")
    check("owned ship button disabled", own_disabled)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- battle: spawn pirate, engage, fire, sink ---
    page.keyboard.press("Escape"); page.wait_for_timeout(300)  # set sail
    page.evaluate("window.UW.teleport(700, 400)")
    page.wait_for_timeout(300)
    page.evaluate("window.UW.spawnPirate(702, 400, 'Balsa')")
    page.wait_for_timeout(2500)   # pirate chases and engages (dist 2 < 3)
    b = page.evaluate("window.UW.getBattle()")
    check("battle started on contact", b is not None and b.get("name") == "Balsa")
    check("battle HUD visible", page.is_visible("#battle-hud"))
    page.screenshot(path="battle_start.png")
    # fire until sunk, steering toward the pirate each volley
    g0 = page.evaluate("window.UW.P.gold")
    f0 = page.evaluate("window.UW.P.fame")
    held = None
    for i in range(15):
        page.keyboard.press("Space")
        page.wait_for_timeout(1200)
        b = page.evaluate("window.UW.getBattle()")
        if b is None:
            break
        # steer toward the enemy to keep it in range
        dx = b["ex"] - page.evaluate("window.UW.shipPos.x")
        want = "d" if dx > 0.5 else "a" if dx < -0.5 else None
        if want != held:
            if held: page.keyboard.up(held)
            held = want
            if held: page.keyboard.down(held)
        page.wait_for_timeout(900)
    if held: page.keyboard.up(held)
    check("enemy sunk (battle over)", page.evaluate("window.UW.getBattle()") is None)
    loot = page.evaluate("window.UW.P.gold") - g0
    check(f"loot gained (+{loot}g)", loot > 0)
    check("fame +3", page.evaluate("window.UW.P.fame") == f0 + 3)
    check("battle HUD hidden", not page.is_visible("#battle-hud"))

    # enemy fire hurts player: teleport back, spawn another pirate, let it shoot
    page.evaluate("window.UW.teleport(700, 400)")
    page.evaluate("window.UW.P.hull = 100; window.UW.save()")
    page.wait_for_timeout(300)
    page.evaluate("window.UW.spawnPirate(702, 400, 'Nao')")
    page.wait_for_timeout(1000)
    page.evaluate("window.UW.getBattle()")
    page.wait_for_timeout(6000)   # enemy approaches & fires (Nao guns 40 -> 10 dmg)
    h = page.evaluate("window.UW.P.hull")
    check(f"enemy cannon hit player (hull {h})", h < 100)
    page.screenshot(path="battle_fight.png")

    print("ERRORS:", errors if errors else "none")
    print(f"\n{len(passed)} passed, {len(failed)} failed", failed if failed else "")
    browser.close()

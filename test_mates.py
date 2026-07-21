"""Test crew/mates/cabins/outfit/ship images."""
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

    def open_bld(name):
        page.evaluate(f"""() => {{
          const b = window.UW.getBuildings().find(x => x.name === '{name}');
          window.UW.openBuilding(b);
        }}""")
        page.wait_for_timeout(300)

    # --- bar: hire sailors ---
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1200)
    page.evaluate("window.UW.P.gold = 100000; window.UW.save()")
    open_bld("bar")
    page.click("#building-actions button:has-text('Hire sailors')")
    page.wait_for_timeout(300)
    check("hired 10 sailors (5->15)", page.evaluate("window.UW.P.crew") == 15
          and page.evaluate("window.UW.P.gold") == 99000)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- bar: meet & hire mate (Lisbon id=1 odd -> none; Seville id=2 -> mate John) ---
    open_bld("bar")
    has_meet = page.evaluate("Array.from(document.querySelectorAll('#building-actions button')).some(b => b.textContent.includes('Meet'))")
    check("no mate in odd-id Lisbon", not has_meet)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(300)  # set sail

    page.evaluate("window.UW.enterPort(2)")   # Seville
    page.wait_for_timeout(1200)
    open_bld("bar")
    page.click("#building-actions button:has-text('Meet')")
    page.wait_for_timeout(300)
    txt = page.inner_text("#building-text")
    check("mate card shown (John)", "John" in txt and "navigation" in txt)
    page.screenshot(path="mate_card.png")
    page.click("#building-actions button:has-text('Hire John')")
    page.wait_for_timeout(300)
    check("mate hired", page.evaluate("window.UW.P.mates.length") == 1)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- mates panel: assign cabin ---
    open_bld("bar")
    page.click("#building-actions button:has-text('Manage mates')")
    page.wait_for_timeout(400)
    check("mates panel open", page.is_visible("#mates-panel"))
    check("mate card with portrait", page.is_visible("#mates-panel .mate-card img"))
    page.screenshot(path="mates_panel.png")
    # John: navigation 0 -> give him navigation via assign anyway (gunnery 0 too; use mate 3 later)
    page.click("#mates-panel .mate-card button:has-text('Nav')")
    page.wait_for_timeout(300)
    check("mate assigned as navigator", page.evaluate("window.UW.P.cabins.navigator") == 1)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- ship images in shipyard ---
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'dry_dock'))")
    page.wait_for_timeout(200)
    page.click("#building-actions button:has-text('Buy a new ship')")
    page.wait_for_timeout(400)
    n_imgs = page.evaluate("document.querySelectorAll('#shipyard-table img.ship-img').length")
    loaded = page.evaluate("""Array.from(document.querySelectorAll('#shipyard-table img.ship-img'))
      .filter(i => i.complete && i.naturalWidth > 0).length""")
    check(f"ship images shown & loaded ({loaded}/{n_imgs})", n_imgs == 22 and loaded == 22)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- outfit: buy armor + sails tier ---
    page.click("#building-actions button:has-text('Outfit ship')")
    page.wait_for_timeout(400)
    check("outfit panel open", page.is_visible("#outfit-panel"))
    page.screenshot(path="outfit_panel.png")
    page.click("#outfit-table tr:has-text('Armor Plating') button:has-text('buy')")
    page.wait_for_timeout(300)
    check("armor bought", page.evaluate("window.UW.P.equipment.armor") == True)
    # sails tiers: tier2 locked before tier1
    locked = page.evaluate("""Array.from(document.querySelectorAll('#outfit-table tr'))
      .find(tr => tr.textContent.includes('Skysails')).querySelector('button').disabled""")
    check("sails tier2 locked before tier1", locked)
    page.click("#outfit-table tr:has-text('Studding Sails') button:has-text('buy')")
    page.wait_for_timeout(300)
    check("sails tier1 bought", page.evaluate("window.UW.P.equipment.sails") == 1)
    unlocked = page.evaluate("""Array.from(document.querySelectorAll('#outfit-table tr'))
      .find(tr => tr.textContent.includes('Skysails')).querySelector('button').disabled""")
    check("sails tier2 unlocked after tier1", not unlocked)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- speed with sails (5% faster): measure ---
    page.keyboard.press("Escape"); page.wait_for_timeout(300)  # set sail
    page.evaluate("window.UW.teleport(700, 400)")
    page.wait_for_timeout(300)
    x0 = page.evaluate("window.UW.shipPos.x")
    page.keyboard.down("a"); page.wait_for_timeout(2000); page.keyboard.up("a")
    dist = x0 - page.evaluate("window.UW.shipPos.x")
    # Balsa speed 9.0 * 1.05 = 9.45 -> ~18.9 in 2s
    check(f"sails speed bonus applied ({dist:.1f} tiles in 2s, expect ~19)", 17 < dist < 21)

    # --- armor reduces battle damage (deterministic via debug hook) ---
    page.evaluate("window.UW.P.fleet[0].hull = 100; window.UW.save()")
    hit = page.evaluate("window.UW.debugHit(10)")
    check(f"armor reduces 10 dmg to {hit} (expect 7.5)", abs(hit - 7.5) < 0.01)
    page.evaluate("window.UW.P.equipment.armor = false")
    hit = page.evaluate("window.UW.debugHit(10)")
    check(f"without armor full 10 dmg ({hit})", hit == 10)
    page.evaluate("window.UW.P.equipment.armor = true; window.UW.save()")
    page.evaluate("window.UW.spawnPirate(702, 400, 'Nao')")
    page.screenshot(path="battle_armor.png")

    print("ERRORS:", errors if errors else "none")
    print(f"\n{len(passed)} passed, {len(failed)} failed", failed if failed else "")
    browser.close()

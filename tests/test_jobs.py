"""Test teleport double-click + job house quest types."""
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

    # --- teleport double-click ---
    page.keyboard.press("`")
    page.wait_for_timeout(300)
    page.click("#dev-tabs button:has-text('Teleport')")
    page.wait_for_timeout(300)
    page.fill("#dev-tp-filter", "sev")
    page.wait_for_timeout(200)
    page.dblclick("#dev-tp-port option:has-text('Seville')")
    page.wait_for_timeout(500)
    pos = page.evaluate("[Math.round(window.UW.shipPos.x), Math.round(window.UW.shipPos.z)]")
    import json, math
    sev = next(x for x in json.load(open('game/assets/ports.json')) if x['name'] == 'Seville')
    d = math.hypot(pos[0] - sev['x'], pos[1] - sev['y'])
    check(f"double-click teleports to Seville (dist {d:.1f})", d < 12)

    # --- cargo request ---
    page.evaluate("window.UW.P.gold = 100000; window.UW.save()")
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1200)
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'job_house'))")
    page.wait_for_timeout(200)
    labels = page.evaluate("Array.from(document.querySelectorAll('#building-actions button')).map(b => b.textContent)")
    check("3 quest types offered", any('delivery' in l for l in labels)
          and any('cargo request' in l for l in labels) and any('bounty' in l for l in labels))
    page.click("#building-actions button:has-text('cargo request')")
    page.wait_for_timeout(300)
    q = page.evaluate("window.UW.P.jobQuest")
    check(f"cargo quest accepted ({q})", q and q["type"] == "cargo" and q["qty"] >= 5 and q["reward"] > 0)
    # fulfill: give the goods via debug, then hand over
    page.evaluate(f"window.UW.P.cargo = {{'{q['good']}': {q['qty']}}}; window.UW.save()")
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'job_house'))")
    page.wait_for_timeout(200)
    g0 = page.evaluate("window.UW.P.gold")
    page.click("#building-actions button:has-text('Hand over')")
    page.wait_for_timeout(300)
    check(f"cargo quest reward +{q['reward']}g", page.evaluate("window.UW.P.gold") == g0 + q["reward"]
          and page.evaluate("window.UW.P.jobQuest") is None)
    check("goods consumed", q["good"] not in page.evaluate("window.UW.P.cargo"))
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- delivery (existing still works) ---
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'job_house'))")
    page.click("#building-actions button:has-text('delivery job')")
    page.wait_for_timeout(300)
    q = page.evaluate("window.UW.P.jobQuest")
    check("delivery quest uses jobQuest now", q and q["type"] == "delivery")
    page.evaluate("window.UW.P.jobQuest = null; window.UW.save()")
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- bounty hunt ---
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'job_house'))")
    page.click("#building-actions button:has-text('bounty hunt')")
    page.wait_for_timeout(300)
    q = page.evaluate("window.UW.P.jobQuest")
    check(f"bounty quest accepted ({q['name']} {q['ship']})",
          q and q["type"] == "bounty" and q["reward"] >= 500 and not q["done"])
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(300)  # set sail
    # sail near the bounty area -> pirate spawns with bountyName
    page.evaluate(f"window.UW.teleport({q['x']}, {q['z']})")
    page.wait_for_timeout(1500)
    has_bounty = page.evaluate("window.UW.getPirates()") >= 1
    check("bounty pirate spawned near quest area", has_bounty)
    b = None
    for _ in range(40):
        page.wait_for_timeout(500)
        b = page.evaluate("window.UW.getBattle()")
        if b is not None:
            break
    check("bounty pirate engages", b is not None)
    # sink it -> bounty done
    page.evaluate("window.UW.hurtEnemy(500)")
    page.evaluate("window.UW.hurtEnemyCrew(500)")
    page.keyboard.press("Space")
    page.wait_for_timeout(2500)
    check("bounty marked done after sink/capture",
          page.evaluate("window.UW.P.jobQuest.done") == True)
    # collect at any job house
    g0 = page.evaluate("window.UW.P.gold")
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1200)
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'job_house'))")
    page.wait_for_timeout(200)
    page.click("#building-actions button:has-text('Collect the bounty')")
    page.wait_for_timeout(300)
    check(f"bounty collected +{q['reward']}g, fame +5",
          page.evaluate("window.UW.P.gold") == g0 + q["reward"]
          and page.evaluate("window.UW.P.jobQuest") is None)
    page.screenshot(path="tests/screenshots/job_bounty.png")

    print("ERRORS:", errors if errors else "none")
    print(f"\n{len(passed)} passed, {len(failed)} failed", failed if failed else "")
    browser.close()

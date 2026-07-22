"""Test blackjack in the bar + old-save cabin migration."""
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

    # --- blackjack ---
    page.evaluate("window.UW.P.gold = 1000; window.UW.save()")
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1200)
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'bar'))")
    page.wait_for_timeout(200)
    has_btn = page.evaluate("Array.from(document.querySelectorAll('#building-actions button')).some(b => b.textContent.includes('blackjack'))")
    check("blackjack button in bar", has_btn)
    page.click("#building-actions button:has-text('blackjack')")
    page.wait_for_timeout(300)
    check("blackjack panel opens", page.is_visible("#blackjack-panel"))
    check("bet options shown", page.evaluate("document.querySelectorAll('#bj-actions button').length") == 4)

    # bet 100
    page.click("#bj-actions button:has-text('Bet 100g')")
    page.wait_for_timeout(300)
    st = page.evaluate("window.UW.getBj()")
    g = page.evaluate("window.UW.P.gold")
    check("bet deducted (1000-100=900)", g == 900)
    check(f"hand dealt (player total {st['player']})", st["player"] > 1)
    # dealer hole card hidden
    check("hole card hidden", page.evaluate("document.querySelectorAll('#bj-dealer .bj-card.back').length") == 1 or st["state"] == "done")
    page.screenshot(path="tests/screenshots/blackjack.png")

    # play to completion: stand immediately (or hit if low)
    for i in range(10):
        st = page.evaluate("window.UW.getBj()")
        if st is None or st["state"] != "player":
            break
        if st["player"] < 17:
            page.click("#bj-actions button:has-text('Hit')")
        else:
            page.click("#bj-actions button:has-text('Stand')")
        page.wait_for_timeout(300)
    st = page.evaluate("window.UW.getBj()")
    check("hand settled", st["state"] == "done")
    print("   result:", st["msg"])
    gold_after = page.evaluate("window.UW.P.gold")
    check("settlement is consistent", gold_after in (900, 1000, 1100, 1150) or st["msg"] in
          ("Bust! You lose.", "Dealer wins."))
    # next hand button
    page.click("#bj-actions button:has-text('Next hand')")
    page.wait_for_timeout(300)
    check("next hand -> bet state", page.evaluate("window.UW.getBj()['state']") == "bet")
    # esc closes
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check("esc closes blackjack", not page.is_visible("#blackjack-panel"))

    # --- old save migration (the reported TDZ error) ---
    page.evaluate("""() => {
      localStorage.setItem('uw-save-v1', JSON.stringify({
        gold: 1000, fame: 5, fleet: [{ship: 'Balsa', hull: 60}],
        cabins: { navigator: 1, gunner: 2, lookout: 3 }, mates: [1, 2, 3],
        character: 0,
      }));
    }""")
    page.reload()
    page.wait_for_timeout(2500)
    check("old save loads without TDZ error", page.evaluate("typeof window.UW") == "object")
    mig = page.evaluate("window.UW.P.shipCabins")
    check(f"migrated cabins distinct slots ({mig})",
          len(set(mig.values())) == len(mig.values()))
    check("navigation cabin preserved",
          "navigation" in page.evaluate("JSON.stringify(window.UW.P.fleet[0].cabins)"))

    print("ERRORS:", errors if errors else "none")
    print(f"\n{len(passed)} passed, {len(failed)} failed", failed if failed else "")
    browser.close()

"""Test Texas Hold'em in the bar."""
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

    # --- hand evaluator unit checks (via UW.evalHand) ---
    # cards: id = suit*13 + rank (suit 0-3, rank 1-13)
    def C(s, r): return s * 13 + r
    royal = [C(0, 13), C(0, 12), C(0, 11), C(0, 10), C(0, 1), C(1, 5), C(2, 3)]
    r = page.evaluate(f"window.UW.evalHand({royal})")
    check(f"straight flush detected (cat {r[0]})", r[0] == 8)
    quads = [C(0, 9), C(1, 9), C(2, 9), C(3, 9), C(0, 2), C(1, 4), C(2, 6)]
    r = page.evaluate(f"window.UW.evalHand({quads})")
    check(f"four of a kind (cat {r[0]})", r[0] == 7)
    fh = [C(0, 5), C(1, 5), C(2, 5), C(0, 8), C(1, 8), C(2, 11), C(3, 1)]
    r = page.evaluate(f"window.UW.evalHand({fh})")
    check(f"full house (cat {r[0]})", r[0] == 6)
    wheel = [C(0, 1), C(1, 2), C(2, 3), C(3, 4), C(0, 5), C(1, 9), C(2, 11)]
    r = page.evaluate(f"window.UW.evalHand({wheel})")
    check(f"wheel straight A-5 (cat {r[0]}, high {r[1]})", r[0] == 4 and r[1] == 5)
    flush = [C(2, 1), C(2, 3), C(2, 5), C(2, 7), C(2, 9), C(0, 11), C(1, 13)]
    r = page.evaluate(f"window.UW.evalHand({flush})")
    check(f"flush (cat {r[0]})", r[0] == 5)
    tp = [C(0, 7), C(1, 7), C(2, 11), C(3, 11), C(0, 1), C(1, 3), C(2, 6)]
    r = page.evaluate(f"window.UW.evalHand({tp})")
    check(f"two pair (cat {r[0]})", r[0] == 2)
    # compare: quads beats full house
    c = page.evaluate(f"window.UW.cmpHands(window.UW.evalHand({quads}), window.UW.evalHand({fh}))")
    check("quads > full house", c > 0)

    # --- game flow ---
    page.evaluate("window.UW.P.gold = 1000; window.UW.save()")
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1200)
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'bar'))")
    page.wait_for_timeout(200)
    has_btn = page.evaluate("Array.from(document.querySelectorAll('#building-actions button')).some(b => b.textContent.includes('Hold'))")
    check("poker button in bar", has_btn)
    page.click("#building-actions button:has-text('Hold')")
    page.wait_for_timeout(300)
    check("poker panel opens", page.is_visible("#poker-panel"))
    st = page.evaluate("window.UW.getPk()")
    check(f"blinds posted (pot {st['pot']}, toCall {st['toCall']})", st["pot"] == 30 and st["toCall"] == 10)
    check("player blind deducted (1000-10)", page.evaluate("window.UW.P.gold") == 990)
    check("dealer cards hidden", page.evaluate("document.querySelectorAll('#pk-dealer .bj-card.back').length") == 2)

    # call the blind -> flop
    page.click("#pk-actions button:has-text('Call')")
    page.wait_for_timeout(300)
    st = page.evaluate("window.UW.getPk()")
    check(f"flop dealt ({st['board']} cards, stage {st['stage']})", st["board"] == 3 and st["stage"] == "flop")
    check("call paid (990-10)", page.evaluate("window.UW.P.gold") == 980)
    check("pot is 40", st["pot"] == 40)
    page.screenshot(path="tests/screenshots/poker_flop.png")

    # raise on flop -> AI calls or folds
    page.click("#pk-actions button:has-text('Raise')")
    page.wait_for_timeout(300)
    st = page.evaluate("window.UW.getPk()")
    check(f"after raise stage advances ({st['stage']})", st["stage"] in ("turn",) and st["pot"] >= 40 or st["state"] == "done")
    if st["state"] != "done":
        # check through turn and river
        page.click("#pk-actions button:has-text('Check')")
        page.wait_for_timeout(300)
        page.click("#pk-actions button:has-text('Check')")
        page.wait_for_timeout(300)
        st = page.evaluate("window.UW.getPk()")
    check("hand settled at showdown", st["state"] == "done")
    print("   result:", st["msg"])
    check("dealer cards revealed", page.evaluate("document.querySelectorAll('#pk-dealer .bj-card.back').length") == 0)
    page.screenshot(path="tests/screenshots/poker_showdown.png")

    # next hand + fold path
    page.click("#pk-actions button:has-text('Next hand')")
    page.wait_for_timeout(300)
    st = page.evaluate("window.UW.getPk()")
    check("next hand starts", st["state"] == "act" and st["pot"] == 30)
    page.click("#pk-actions button:has-text('Fold')")
    page.wait_for_timeout(300)
    check("fold settles", page.evaluate("window.UW.getPk()['state']") == "done")
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    check("esc closes poker", not page.is_visible("#poker-panel"))

    print("ERRORS:", errors if errors else "none")
    print(f"\n{len(passed)} passed, {len(failed)} failed", failed if failed else "")
    browser.close()

"""Smoke test: boot, land expedition to Seville, re-board, harbor building, newDay."""
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8734/index.html"
passed, failed = [], []

def check(name, cond):
    (passed if cond else failed).append(name)
    print(("OK  " if cond else "FAIL"), name)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    page.goto(URL)
    page.wait_for_timeout(2000)
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_timeout(2000)
    page.click("#start-overlay .go")
    page.wait_for_timeout(500)
    check("game started at sea", page.evaluate("window.UW.getScene()") == "sea")

    # --- land expedition: sail near Seville, go ashore, walk in on foot ---
    page.evaluate("window.UW.setNoAutoSpawn(true)")
    page.evaluate("window.UW.teleport(839, 358)")
    page.wait_for_timeout(200)
    page.keyboard.press("l")
    page.wait_for_timeout(400)
    check("gone ashore (land scene)", page.evaluate("window.UW.getScene()") == "land")

    page.evaluate("window.UW.landTo(860, 371)")
    page.wait_for_timeout(200)
    page.keyboard.press("e")
    page.wait_for_timeout(800)
    check("entered Seville on foot (portId==2)",
          page.evaluate("window.UW.getPortId()") == 2 and
          page.evaluate("window.UW.getScene()") == "port")

    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check("escaped back to land", page.evaluate("window.UW.getScene()") == "land")

    # --- re-board the ship ---
    page.evaluate("window.UW.landTo(window.UW.shipPos.x, window.UW.shipPos.z)")
    page.wait_for_timeout(200)
    page.keyboard.press("l")
    page.wait_for_timeout(400)
    check("re-boarded (sea scene)", page.evaluate("window.UW.getScene()") == "sea")

    # --- newDay: days increment, provisions drop at sea ---
    st0 = page.evaluate("({d: window.UW.P.days, pr: window.UW.P.provisions})")
    page.evaluate("window.UW.newDay()")
    st1 = page.evaluate("({d: window.UW.P.days, pr: window.UW.P.provisions})")
    check("newDay: days +1", st1["d"] == st0["d"] + 1)
    check("newDay: provisions dropped", st1["pr"] < st0["pr"])

    # --- enter Lisbon, open the harbor building, buttons render ---
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1200)
    page.evaluate("""() => {
      const b = window.UW.getBuildings().find(x => x.name === 'harbor');
      window.UW.openBuilding(b);
    }""")
    page.wait_for_timeout(400)
    check("harbor building panel open", page.is_visible("#building-panel"))
    n_btns = page.evaluate("document.querySelectorAll('#building-actions button').length")
    check("harbor building buttons render", n_btns > 0)
    print("    harbor buttons:", n_btns)

    check("no page errors", not errors)
    if errors:
        print("    errors:", errors[:5])

    browser.close()

print(f"\n{'PASS' if not failed else 'FAIL'}: {len(passed)} passed, {len(failed)} failed")
if failed:
    print("failed:", failed)
    raise SystemExit(1)

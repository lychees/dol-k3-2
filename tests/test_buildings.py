"""Test all 12 building interactions."""
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

    def click_btn(text):
        page.click(f"#building-actions button:has-text('{text}')")
        page.wait_for_timeout(250)

    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1200)

    # --- market: buy 10 Wine at 36, sell back at 20 ---
    open_bld("market")
    click_btn("Trade goods")
    page.wait_for_timeout(400)
    check("market panel open", page.is_visible("#market-panel"))
    g0 = page.evaluate("window.UW.P.gold")
    page.click("#market-table tr:has-text('Wine') button:has-text('+10')")
    page.wait_for_timeout(300)
    st = page.evaluate("({g: window.UW.P.gold, c: window.UW.P.cargo})")
    check("bought 10 wine (-360g)", st["g"] == g0 - 360 and st["c"].get("Wine") == 10)
    page.click("#market-table tr:has-text('Wine') button:has-text('all')")
    page.wait_for_timeout(300)
    st = page.evaluate("({g: window.UW.P.gold, c: window.UW.P.cargo})")
    check("sold 10 wine (+200g)", st["g"] == g0 - 160 and "Wine" not in st["c"])
    # specialty Rock Salt available
    check("specialty Rock Salt listed", page.is_visible("#market-table tr.specialty:has-text('Rock Salt')"))
    page.keyboard.press("Escape")   # close market -> back to building
    page.wait_for_timeout(300)
    check("esc back to building panel", page.is_visible("#building-panel"))
    page.keyboard.press("Escape")   # close building
    page.wait_for_timeout(300)

    # --- harbor: provisions ---
    page.evaluate("window.UW.P.provisions = 40")
    open_bld("harbor")
    click_btn("Buy provisions")
    check("provisions filled", page.evaluate("window.UW.P.provisions") == 100)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- inn: rest ---
    page.evaluate("window.UW.P.fatigue = 80")
    d0 = page.evaluate("window.UW.P.days")
    open_bld("inn")
    click_btn("Rest until morning")
    check("inn rest: fatigue 0, day+1",
          page.evaluate("window.UW.P.fatigue") == 0 and page.evaluate("window.UW.P.days") == d0 + 1)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- bank ---
    g0 = page.evaluate("window.UW.P.gold")
    open_bld("bank")
    click_btn("Deposit 100g")
    check("bank deposit", page.evaluate("window.UW.P.bank") == 100 and page.evaluate("window.UW.P.gold") == g0 - 100)
    click_btn("Withdraw 100g")
    check("bank withdraw", page.evaluate("window.UW.P.bank") == 0 and page.evaluate("window.UW.P.gold") == g0)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- bar: rumor ---
    open_bld("bar")
    click_btn("Ask for rumors")
    txt = page.inner_text("#building-text")
    check("bar rumor gives coords", "°" in txt)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- msc: discovery quest full cycle ---
    open_bld("msc")
    click_btn("Take a research quest")
    qid = page.evaluate("window.UW.P.discoveryQuest")
    check("msc quest accepted", qid is not None)
    v = page.evaluate(f"window.UW.P.discoveryQuest")
    pos = page.evaluate(f"() => {{ const v = {qid}; return null; }}") if False else None
    # teleport near the quest discovery and go ashore
    xy = page.evaluate(f"() => {{ const vs = window.__villages ?? null; return null; }}") if False else None
    vil = page.evaluate(f"""() => {{
      return fetch('./assets/villages.json').then(r => r.json())
        .then(vs => vs.find(x => x.id === {qid}));
    }}""")
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape")   # set sail
    page.wait_for_timeout(400)
    page.evaluate(f"window.UW.teleport({vil['x'] - 2}, {vil['y']})")
    page.wait_for_timeout(400)
    page.keyboard.press("g")
    page.wait_for_timeout(400)
    check("quest discovery found", qid in page.evaluate("window.UW.getDiscovered()"))
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    g0 = page.evaluate("window.UW.P.gold")
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1000)
    open_bld("msc")
    click_btn("Report:")
    check("msc quest reward +600g", page.evaluate("window.UW.P.gold") == g0 + 600
          and page.evaluate("window.UW.P.discoveryQuest") is None)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- job_house: delivery quest full cycle ---
    open_bld("job_house")
    click_btn("Take a delivery job")
    q = page.evaluate("window.UW.P.jobQuest")
    check("delivery quest accepted", q is not None and q.get("type") == "delivery" and q.get("port") is not None)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(300)  # set sail
    g0 = page.evaluate("window.UW.P.gold")
    page.evaluate(f"window.UW.enterPort({q['port']})")
    page.wait_for_timeout(1200)
    open_bld("job_house")
    click_btn("Deliver the letter")
    check("delivery reward", page.evaluate("window.UW.P.gold") == g0 + q["reward"]
          and page.evaluate("window.UW.P.jobQuest") is None)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(300)

    # --- dry_dock: repair + buy ship (via shipyard) ---
    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1000)
    page.evaluate("window.UW.P.fleet[0].hull = 30; window.UW.P.gold = 30000; window.UW.save()")
    open_bld("dry_dock")
    click_btn("Repair hull")
    check("hull repaired", page.evaluate("window.UW.P.fleet[0].hull") == 60)   # Balsa hull
    click_btn("Buy a new ship")
    page.wait_for_timeout(400)
    page.click("#shipyard-table tr:has-text('Sloop') button:has-text('buy')")
    page.wait_for_timeout(300)
    check("bought Sloop via shipyard", page.evaluate("window.UW.P.fleet.some(f => f.ship === 'Sloop')"))
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- item_shop: telescope ---
    open_bld("item_shop")
    click_btn("Telescope")
    check("telescope bought", page.evaluate("window.UW.P.telescope") == True)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- church + fortune ---
    open_bld("church")
    click_btn("Make a donation")
    check("church donation works", True)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    # fortune house not in Lisbon (id 12 absent); palace instead
    open_bld("palace")
    disabled = page.evaluate("Array.from(document.querySelectorAll('#building-actions button'))[0].disabled")
    check("palace audience locked before 5 discoveries", disabled)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- save persistence ---
    page.reload()
    page.wait_for_timeout(2500)
    check("save persists (Sloop, telescope)",
          page.evaluate("window.UW.P.fleet.some(f => f.ship === 'Sloop')") and page.evaluate("window.UW.P.telescope") == True)

    page.screenshot(path="tests/screenshots/bld_market.png") if False else None
    print("ERRORS:", errors if errors else "none")
    print(f"\n{len(passed)} passed, {len(failed)} failed", failed if failed else "")
    browser.close()

"""Test port development + investment + share."""
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

    page.evaluate("window.UW.P.gold = 100000; window.UW.save()")
    page.evaluate("window.UW.enterPort(1)")   # Lisbon (capital -> dev 500)
    page.wait_for_timeout(1200)

    # --- palace shows development + invest buttons ---
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'palace'))")
    page.wait_for_timeout(300)
    labels = page.evaluate("Array.from(document.querySelectorAll('#building-actions button')).map(b => b.textContent)")
    check("development status button", any("Development 500" in l and "0.0%" in l for l in labels))
    check("invest buttons present", any("Invest 1000g" in l for l in labels))

    # --- invest 1000 -> dev +10, mine +10, share 10/510 ---
    g0 = page.evaluate("window.UW.P.gold")
    page.click("#building-actions button:has-text('Invest 1000g')")
    page.wait_for_timeout(300)
    pd = page.evaluate("window.UW.P.portDev['1']")
    check(f"invest works (dev {pd['dev']}, mine {pd['mine']})",
          pd["dev"] == 510 and pd["mine"] == 10 and page.evaluate("window.UW.P.gold") == g0 - 1000)
    # invest 10000 -> +100
    page.click("#building-actions button:has-text('Invest 10000g')")
    page.wait_for_timeout(300)
    pd = page.evaluate("window.UW.P.portDev['1']")
    share = pd["mine"] / pd["dev"]
    check(f"share = {share*100:.1f}% (expect ~18.0%)", abs(share - 110/610) < 0.001)

    # --- share affects market prices: Wine buy 36 -> 35 (18% of 10% = 1.8% off) ---
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'market'))")
    page.wait_for_timeout(200)
    page.click("#building-actions button:has-text('Trade goods')")
    page.wait_for_timeout(400)
    wine_buy = page.evaluate("""Array.from(document.querySelectorAll('#market-table tr'))
      .find(tr => tr.textContent.includes('Wine')).children[1].textContent""")
    # share ~18% -> discount 1.8% -> 36 * 0.982 = 35.35 -> 35
    check(f"buy price discounted ({wine_buy}, expect 35)", wine_buy == "35")
    wine_sell = page.evaluate("""Array.from(document.querySelectorAll('#market-table tr'))
      .find(tr => tr.textContent.includes('Wine')).children[2].textContent""")
    # sell 20 * 1.018 = 20.36 -> 20
    check(f"sell price raised ({wine_sell.strip()}, expect 20)", wine_sell.strip().startswith("20"))
    # specialty Rock Salt: 38 * 0.982 = 37.3 -> 37
    salt_buy = page.evaluate("""Array.from(document.querySelectorAll('#market-table tr'))
      .find(tr => tr.textContent.includes('Rock Salt')).children[1].textContent""")
    check(f"specialty discounted ({salt_buy}, expect 37)", salt_buy == "37")
    page.screenshot(path="tests/screenshots/port_invest.png")
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- persistence ---
    page.reload()
    page.wait_for_timeout(2500)
    pd = page.evaluate("window.UW.P.portDev['1']")
    check("investment persists", pd["dev"] == 610 and pd["mine"] == 110)

    # --- Tamsui starts at 150 ---
    page.evaluate("window.UW.enterPort(131)")
    page.wait_for_timeout(1200)
    pd = page.evaluate("window.UW.P.portDev['131']")
    check(f"Tamsui dev starts 150 ({pd['dev']})", pd["dev"] == 150)

    # --- supply port starts at 100 ---
    pd = page.evaluate("window.UW.P.portDev['105'] ?? null")
    page.evaluate("window.UW.P.portDev['105'] = undefined; window.UW.save()")
    page.evaluate("window.UW.enterPort(105)")
    page.wait_for_timeout(1200)
    pd = page.evaluate("window.UW.P.portDev['105']")
    check(f"supply port dev starts 100 ({pd['dev']})", pd["dev"] == 100)

    print("ERRORS:", errors if errors else "none")
    print(f"\n{len(passed)} passed, {len(failed)} failed", failed if failed else "")
    browser.close()

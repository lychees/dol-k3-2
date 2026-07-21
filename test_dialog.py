"""Test NPC dialogs in port."""
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

    page.evaluate("window.UW.enterPort(1)")
    page.wait_for_timeout(1500)

    # --- walk to the agent (market at 41,59; npc stands at 41.5,60.5) ---
    page.evaluate("window.UW.walkTo(43.5, 60.5)")
    page.wait_for_timeout(400)
    hint = page.inner_text("#hint")
    check(f"hint shows talk ({hint})", "talk to agent" in hint)

    page.keyboard.press("e")
    page.wait_for_timeout(400)
    check("dialog opens", page.is_visible("#dialog-panel"))
    txt = page.inner_text("#dialog-text")
    check(f"agent gives trade tip", "Rock Salt" in txt and "specialty" in txt)
    print("   agent says:", txt[:120])
    page.screenshot(path="npc_dialog_agent.png")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check("dialog closes with Esc", not page.is_visible("#dialog-panel"))

    # --- dog at the bar (54,34 -> npc at 54.5,35.5) ---
    page.evaluate("window.UW.walkTo(56.5, 35.5)")
    page.wait_for_timeout(400)
    page.keyboard.press("e")
    page.wait_for_timeout(300)
    check("dog dialog", "Woof" in page.inner_text("#dialog-text"))
    page.keyboard.press("e")   # E also closes
    page.wait_for_timeout(300)
    check("dialog closes with E", not page.is_visible("#dialog-panel"))

    # --- old man at the inn (36,46 -> 36.5,47.5) ---
    page.evaluate("window.UW.walkTo(38.5, 47.5)")
    page.wait_for_timeout(400)
    page.keyboard.press("e")
    page.wait_for_timeout(300)
    txt = page.inner_text("#dialog-text")
    check("old man speaks", "Cherish" in txt)
    print("   old man says:", txt[:140])
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.screenshot(path="npc_dialog_oldman.png")

    # --- guard at the palace (48,7 -> 48.5,8.5) ---
    page.evaluate("window.UW.walkTo(50.5, 8.5)")
    page.wait_for_timeout(400)
    page.keyboard.press("e")
    page.wait_for_timeout(300)
    check("guard dialog", len(page.inner_text("#dialog-text")) > 0)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # --- wanderer (man/woman): find one via debug pos and walk there ---
    d = page.evaluate("window.UW.getNpcDebug()")
    w = d["w"][0]
    page.evaluate(f"window.UW.walkTo({w['x']}, {w['z']})")
    page.wait_for_timeout(400)
    hint = page.inner_text("#hint")
    page.keyboard.press("e")
    page.wait_for_timeout(300)
    open_w = page.is_visible("#dialog-panel")
    check(f"talk to wanderer (hint: {hint})", open_w and len(page.inner_text("#dialog-text")) > 0)
    print("   wanderer says:", page.inner_text("#dialog-text")[:120])
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    print("ERRORS:", errors if errors else "none")
    print(f"\n{len(passed)} passed, {len(failed)} failed", failed if failed else "")
    browser.close()

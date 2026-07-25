import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

JS = """
(() => {
  let mounts = 0, river = null;
  const M = [53,54,55,56,61,62];
  for (let z = 0; z < 1080; z += 4) {
    for (let x = 0; x < 2160; x += 4) {
      if (M.includes(window.UW.mapProbe(x, z).tile)) mounts++;
    }
  }
  // a river channel: sailable water with at most 2 sailable neighbors
  outer: for (let z = 100; z < 1000; z += 2) {
    for (let x = 100; x < 2060; x += 2) {
      const p = window.UW.mapProbe(x, z);
      if (!p.sailable) continue;
      const n = [[1,0],[-1,0],[0,1],[0,-1]]
        .filter(([dx, dz]) => window.UW.mapProbe(x + dx, z + dz).sailable).length;
      if (n > 0 && n <= 2) { river = [x, z]; break outer; }
    }
  }
  return { mounts, river };
})()
"""

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1280, "height": 800})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8734/index.html"); pg.wait_for_timeout(2000)
    pg.evaluate("localStorage.clear()")
    pg.evaluate("""() => { localStorage.setItem('uw-rando', JSON.stringify({
      seed: '42', markets: true, specialties: true, startShip: true,
      portDev: true, portLocations: true, discoveries: true, mapStructure: true })); }""")
    pg.reload(); pg.wait_for_timeout(4000)
    pg.click("#start-overlay .go"); pg.wait_for_timeout(500)
    res = pg.evaluate(JS)
    print("mountain samples:", res["mounts"], "| river at:", res["river"])
    assert res["mounts"] >= 8, "no mountains"
    assert res["river"], "no river found"
    x, z = res["river"]
    pg.evaluate(f"window.UW.teleport({x}, {z})"); pg.wait_for_timeout(400)
    pg.evaluate("window.UW.setZoom(20)"); pg.wait_for_timeout(300)
    pg.screenshot(path="tests/screenshots/river.png")
    pg.evaluate("window.UW.setZoom(60)"); pg.wait_for_timeout(300)
    pg.screenshot(path="tests/screenshots/mountains.png")
    print("ERRORS:", errs if errs else "none")
    b.close()

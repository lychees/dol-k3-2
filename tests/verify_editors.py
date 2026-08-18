# verify_editors.py — 冒烟测试：在真实浏览器中打开每个编辑器页面，
# 收集 JS 错误、检查关键 DOM、截图到 verify_shots/。
import subprocess, time, os, sys, socket
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'game')
PORT = 8760
BASE = f'http://127.0.0.1:{PORT}/editor/'
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'verify_shots')
os.makedirs(SHOTS, exist_ok=True)

def wait_port(port, timeout=15):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            socket.create_connection(('127.0.0.1', port), 0.5).close()
            return True
        except OSError:
            time.sleep(0.3)
    return False

server = subprocess.Popen(
    [sys.executable, '-m', 'http.server', str(PORT)],
    cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

errors = []
failures = []

try:
    assert wait_port(PORT), 'http.server 未能启动'
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={'width': 1500, 'height': 900})
        page.on('pageerror', lambda e: errors.append(f'[{page.url}] pageerror: {e}'))
        page.on('console', lambda m: errors.append(f'[{page.url}] console.{m.type}: {m.text}')
                  if m.type == 'error' else None)

        def shot(name):
            page.screenshot(path=os.path.join(SHOTS, name + '.png'))

        def check(name, cond, detail=''):
            if not cond:
                failures.append(f'{name}: {detail}')
                print(f'  FAIL {name}: {detail}')
            else:
                print(f'  ok   {name}')

        # 1. hub
        page.goto(BASE + 'index.html'); page.wait_for_timeout(500)
        check('hub cards', page.locator('.hub-card').count() == 13,
              f"cards={page.locator('.hub-card').count()}")
        shot('01_hub')

        # 2. map editor
        page.goto(BASE + 'map.html'); page.wait_for_timeout(4000)
        check('map h1', '世界地图' in (page.locator('h1').first.text_content() or ''))
        check('map canvas', page.locator('canvas').count() >= 2,
              f"canvases={page.locator('canvas').count()}")
        shot('02_map')

        # 3. portmap editor
        page.goto(BASE + 'portmap.html'); page.wait_for_timeout(3000)
        opts = page.locator('select option').all_text_contents()
        check('portmap select', len(opts) >= 100, f'options={len(opts)}')
        shot('03_portmap')

        # 4. ships editor
        page.goto(BASE + 'ships.html'); page.wait_for_timeout(1500)
        check('ships list 22', page.locator('#list .item').count() == 22,
              f"items={page.locator('#list .item').count()}")
        page.locator('#list .item').first.click(); page.wait_for_timeout(300)
        check('ships form', page.locator('#editor').is_visible())
        shot('04_ships')

        # 5. mates editor
        page.goto(BASE + 'mates.html'); page.wait_for_timeout(2000)
        check('mates list 50', page.locator('#list .item').count() == 50,
              f"items={page.locator('#list .item').count()}")
        page.locator('#list .item').first.click(); page.wait_for_timeout(300)
        check('mates form visible', page.locator('#editor').is_visible())
        shot('05_mates')
        page.locator('#tab-maids').click(); page.wait_for_timeout(500)
        check('maids list 28', page.locator('#list .item').count() == 28,
              f"items={page.locator('#list .item').count()}")
        page.locator('#list .item').first.click(); page.wait_for_timeout(300)
        shot('05b_maids')
        # 原创角色 tab
        page.locator('#tab-extra').click(); page.wait_for_timeout(500)
        check('extra list 4', page.locator('#list .item').count() == 4,
              f"items={page.locator('#list .item').count()}")
        page.locator('#list .item').first.click(); page.wait_for_timeout(800)
        ok = page.evaluate("() => { const i = document.getElementById('portrait-custom-img');"
                           " return i && i.complete && i.naturalWidth > 0; }")
        check('extra custom portrait loads', ok)
        check('waifu picker 5', page.locator('#waifu-picker img').count() == 5,
              f"imgs={page.locator('#waifu-picker img').count()}")
        shot('05c_extra')

        # 6. goods editor
        page.goto(BASE + 'goods.html'); page.wait_for_timeout(1500)
        check('goods regions 13', page.locator('#region-select option').count() == 13,
              f"options={page.locator('#region-select option').count()}")
        check('goods rows 46', page.locator('#goods-table tbody tr').count() == 46,
              f"rows={page.locator('#goods-table tbody tr').count()}")
        page.locator('#tab-specialties').click(); page.wait_for_timeout(300)
        n = page.locator('#spec-table tbody tr').count()
        check('goods specialties >60', n > 60, f'rows={n}')
        shot('06_goods')

        # 7. ports editor
        page.goto(BASE + 'ports.html'); page.wait_for_timeout(4000)
        n = page.locator('.ed-list .item, #list .item, .item').count()
        check('ports list >=130', n >= 130, f'items={n}')
        shot('07_ports')

        # 8. world editor
        page.goto(BASE + 'world.html'); page.wait_for_timeout(4000)
        n = page.locator('.ed-list .item, #list .item, .item').count()
        check('world villages >=98', n >= 98, f'items={n}')
        page.locator('.ed-list .item, #list .item, .item').first.click()
        page.wait_for_timeout(500)
        shot('08_world')

        # 9. assets browser
        page.goto(BASE + 'assets.html'); page.wait_for_timeout(1500)
        shot('09_assets')

        # 10. story editor
        page.goto(BASE + 'story.html'); page.wait_for_timeout(2000)
        n = page.locator('.step-card, .step, #steps > *').count()
        check('story steps 5', n == 5, f'steps={n}')
        shot('10_story')
        # 切到 Isabella（6 步）
        tabs = page.locator('.tabs button, #tabs button')
        tabs.nth(6).click(); page.wait_for_timeout(500)
        n = page.locator('.step-card, .step, #steps > *').count()
        check('story isabella steps 6', n == 6, f'steps={n}')
        shot('10b_story_isabella')

        # 11. rando viewer
        page.goto(BASE + 'rando.html'); page.wait_for_timeout(12000)
        check('rando canvas', page.locator('canvas').count() >= 1)
        shot('11_rando')

        # 12. ships image preview
        page.goto(BASE + 'ships.html'); page.wait_for_timeout(1500)
        page.locator('#list .item').first.click(); page.wait_for_timeout(800)
        ok = page.evaluate("() => { const i = document.getElementById('ship-img'); return i && i.complete && i.naturalWidth === 128; }")
        check('ships image 128x96', ok)
        shot('12_ships_img')

        # 13. hero editor（养成）
        page.goto(BASE + 'hero.html'); page.wait_for_timeout(2000)
        check('hero list 7', page.locator('#hero-list .hero-item').count() == 7,
              f"items={page.locator('#hero-list .hero-item').count()}")
        page.locator('#hero-list .hero-item').first.click(); page.wait_for_timeout(500)
        shot('13_hero')
        # 怪物 tab：8 只
        page.locator('#tab-monsters').click(); page.wait_for_timeout(600)
        n = page.locator('#mon-list .item').count()
        check('hero monsters 8', n == 8, f'items={n}')
        page.locator('#mon-list .item').first.click(); page.wait_for_timeout(500)
        shot('13b_hero_monsters')

        browser.close()
finally:
    server.terminate()

print()
if errors:
    print('=== JS 错误 ===')
    for e in errors: print(e)
else:
    print('无 JS 错误')
if failures:
    print('=== 失败项 ===')
    for f in failures: print(f)
    sys.exit(1)
print('全部检查通过')

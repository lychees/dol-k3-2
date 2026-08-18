# verify_gvo.py — 验证素材包选择 + GVO 商品图标接入
import subprocess, time, os, sys
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'game')
PORT = 8765
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], cwd=ROOT,
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
errors = []
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        page = b.new_page(viewport={'width': 1500, 'height': 900})
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

        # 1. 开始界面：素材包选择器可见
        page.goto(f'http://127.0.0.1:{PORT}/index.html')
        page.wait_for_timeout(10000)
        n = page.locator('#pack-select button').count()
        print('pack buttons:', n); assert n == 2
        page.screenshot(path='verify_shots/20_start_pack.png')

        # 2. 选 GVO 包
        page.locator('#pack-select button[data-pack="gvo"]').click()
        page.wait_for_timeout(300)
        v = page.evaluate("() => localStorage.getItem('uw-asset-pack')")
        print('localStorage pack:', v); assert v == 'gvo'

        # 3. 进入游戏 → 进 Lisbon → 打开市场
        page.locator('#start-overlay').click(position={'x': 750, 'y': 130})
        page.wait_for_timeout(3000)
        page.evaluate('() => UW.enterPort(1)')
        page.wait_for_timeout(2000)
        page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'market'))")
        page.wait_for_timeout(1500)
        page.click('text=Trade goods')
        page.wait_for_timeout(2500)
        srcs = page.evaluate("() => [...document.querySelectorAll('.good-icon')].map(i => i.src)")
        gvo = [s for s in srcs if 'dol-rev' in s]
        print(f'good icons: {len(srcs)}, gvo: {len(gvo)}')
        assert len(srcs) > 0 and len(gvo) > 0, 'GVO 图标未接入'
        # 图标真实加载成功？
        ok = page.evaluate("() => [...document.querySelectorAll('.good-icon')].filter(i => i.src.includes('dol-rev')).every(i => i.complete && i.naturalWidth > 0)")
        print('gvo icons all loaded:', ok)
        page.screenshot(path='verify_shots/21_market_gvo.png')

        # 4. 切回经典包 → 刷新 → 市场是 data: 图标
        page.evaluate("() => localStorage.setItem('uw-asset-pack', 'classic')")
        page.goto(f'http://127.0.0.1:{PORT}/index.html')
        page.wait_for_timeout(10000)
        active = page.locator('#pack-select button.active').get_attribute('data-pack')
        print('active pack after reload:', active); assert active == 'classic'
        page.locator('#start-overlay').click(position={'x': 750, 'y': 130})
        page.wait_for_timeout(3000)
        page.evaluate('() => UW.enterPort(1)')
        page.wait_for_timeout(2000)
        page.evaluate("window.UW.openBuilding(window.UW.getBuildings().find(x => x.name === 'market'))")
        page.wait_for_timeout(1500)
        page.click('text=Trade goods')
        page.wait_for_timeout(2000)
        srcs = page.evaluate("() => [...document.querySelectorAll('.good-icon')].map(i => i.src)")
        data_urls = [s for s in srcs if s.startswith('data:')]
        print(f'classic icons: {len(data_urls)}/{len(srcs)} are data URLs')
        assert len(srcs) > 0 and len(data_urls) == len(srcs)
        page.screenshot(path='verify_shots/22_market_classic.png')
        b.close()
finally:
    server.terminate()
print('JS errors:', errors if errors else '无')
print('GVO 验证通过')

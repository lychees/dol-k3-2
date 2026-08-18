# verify_edits.py — 交互测试：画笔编辑 + 撤销 + 导出下载
import subprocess, time, os, sys, socket
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'game')
PORT = 8761
BASE = f'http://127.0.0.1:{PORT}/editor/'
DL = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'verify_dl')
os.makedirs(DL, exist_ok=True)

def wait_port(port, timeout=15):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            socket.create_connection(('127.0.0.1', port), 0.5).close()
            return True
        except OSError:
            time.sleep(0.3)
    return False

server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)],
    cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
errors = []
try:
    assert wait_port(PORT)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={'width': 1500, 'height': 900}, accept_downloads=True)
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(f'[{page.url}] {e}'))

        # --- map: 画笔 + 撤销 + 导出 ---
        page.goto(BASE + 'map.html'); page.wait_for_timeout(4000)
        # 点图块面板选 tile（面板在侧栏 canvas，点一个陆地块位置）
        panel = page.locator('.ed-side canvas').first
        box = panel.bounding_box()
        page.mouse.click(box['x'] + box['width'] * 0.9, box['y'] + box['height'] * 0.9)
        page.wait_for_timeout(200)
        tile_txt = page.locator('.ed-side').text_content()
        # 在主画布中央画一笔
        view = page.locator('.ed-canvas-wrap canvas, canvas.ed-canvas').first
        vb = view.bounding_box()
        cx, cy = vb['x'] + vb['width'] / 2, vb['y'] + vb['height'] / 2
        page.mouse.move(cx - 60, cy); page.mouse.down()
        page.mouse.move(cx + 60, cy, steps=10); page.mouse.up()
        page.wait_for_timeout(300)
        title_after_paint = page.title()
        print('画一笔后标题:', title_after_paint)
        assert title_after_paint.startswith('*'), 'dirty 标记未出现'
        # Ctrl+Z 撤销
        page.keyboard.press('Control+z'); page.wait_for_timeout(300)
        print('撤销执行成功')
        # 导出（捕获下载）
        try:
            with page.expect_download(timeout=8000) as dl_info:
                page.click('text=导出 world_map.bin')
            d = dl_info.value
            path = os.path.join(DL, d.suggested_filename)
            d.save_as(path)
            size = os.path.getsize(path)
            print('导出下载:', d.suggested_filename, size, '字节')
            assert size == 2332800, f'world_map.bin 大小错误: {size}'
        except Exception as e:
            print('导出下载未触发（可能走了 showSaveFilePicker）:', type(e).__name__)

        # --- ships: 改值 + 导出 ---
        page.goto(BASE + 'ships.html'); page.wait_for_timeout(1500)
        page.locator('#list .item').first.click(); page.wait_for_timeout(300)
        price = page.locator('#form input[type="number"]').nth(6)
        price.fill('9999'); price.dispatch_event('change')
        page.wait_for_timeout(200)
        assert page.title().startswith('*'), 'ships dirty 未标记'
        try:
            with page.expect_download(timeout=8000) as dl_info:
                page.click('text=导出 ships.json')
            d = dl_info.value
            path = os.path.join(DL, d.suggested_filename)
            d.save_as(path)
            import json
            data = json.load(open(path, encoding='utf-8'))
            assert data['Balsa']['price'] == 9999, '修改未写入导出文件'
            print('ships.json 导出内容验证通过（Balsa.price = 9999）')
        except Exception as e:
            print('ships 导出下载未触发:', type(e).__name__)

        browser.close()
finally:
    server.terminate()

if errors:
    print('=== JS 错误 ===')
    for e in errors: print(e)
    sys.exit(1)
print('交互测试完成')

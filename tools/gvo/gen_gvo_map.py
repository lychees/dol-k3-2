# gen_gvo_map.py — 由映射表生成 game/assets/gvo_map.json（GVO 素材映射）
# 输入: goods_map.json / discoveries_map.json（build_maps*.py 产物）+ 游戏 villages.json
import json, sys, os
sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.join(HERE, '..', '..', 'game')          # tools/gvo/ -> repo 根下的 game/
if not os.path.isdir(GAME):                            # 兼容在 gvo_ref/ 下运行
    GAME = os.path.join(HERE, '..', 'game', 'game')

goods_map = json.load(open(os.path.join(HERE, 'goods_map.json'), encoding='utf-8'))
disc_map = json.load(open(os.path.join(HERE, 'discoveries_map.json'), encoding='utf-8'))
villages = json.load(open(os.path.join(GAME, 'assets', 'villages.json'), encoding='utf-8'))

goods = {en: v['file'] for en, v in goods_map.items() if v['status'] == 'ok'}
by_name = {en: v['id'] for en, v in disc_map.items() if v.get('id') and v.get('art')}
disc = {}
for v in villages:
    gvo_id = by_name.get(v['name'])
    if gvo_id: disc[str(v['id'])] = gvo_id

out = {'goods': goods, 'discoveries': disc}
dst = os.path.join(GAME, 'assets', 'gvo_map.json')
json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'{dst}: goods {len(goods)}, discoveries {len(disc)}')

# build_maps.py — 建立游戏（UW2 英文名）→ GVO（dol-rev 繁中数据）的映射表
# 输出: goods_map.json / ships_map.json / discoveries_map.json（含匹配状态，供人工核对）
import json, re, sys
sys.stdout.reconfigure(encoding='utf-8')

def load_js(fname, const):
    src = open(fname, encoding='utf-8').read()
    body = src[src.index('['):src.rindex(']') + 1] if const != 'FILELIST' else src[len('const FILELIST='):].rstrip().rstrip(';')
    return json.loads(body)

goods = load_js('goods.js', 'GOODS')
disc = load_js('discoveries.js', 'DISCOVERIES')
ships = load_js('ships.js', 'SHIPS')
fl = load_js('filelist.js', 'FILELIST')

# id -> 图标文件名（goods/items/skills）
id2file = {}
for key in ('goods', 'items', 'skills'):
    for f in fl.get(key, []):
        m = re.search(r'_id(\d+)_f', f)
        if m: id2file[int(m.group(1))] = (key, f)

# ---- 商品映射：UW2 英文名 -> GVO 繁中名候选 ----
GOOD_ZH = {
    'Clove': ['丁香'], 'Cinnamon': ['肉桂', '桂皮'], 'Pepper': ['胡椒'], 'Nutmeg': ['肉豆蔻', '肉荳蔻'],
    'Pimento': ['多香果', '眾香子'], 'Ginger': ['薑', '生姜'], 'Tobacco': ['菸草', '烟草'],
    'Tea': ['茶', '茶葉'], 'Coffee': ['咖啡'], 'Cacao': ['可可'], 'Sugar': ['糖', '砂糖'],
    'Cheese': ['乳酪', '乾酪', '起司'], 'Fish': ['魚', '魚類'], 'Grain': ['小麥', '穀物'],
    'Olive Oil': ['橄欖油'], 'Wine': ['葡萄酒'], 'Rock Salt': ['岩鹽', '岩盐'],
    'Silk': ['生絲', '絲綢', '蠶絲'], 'Cotton': ['棉花'], 'Wool': ['羊毛'], 'Flax': ['亞麻'],
    'Cotton Cloth': ['棉織品', '棉布'], 'Silk Cloth': ['絲織品', '絲綢布料'],
    'Wool Cloth': ['毛織品', '英格蘭花呢', '平紋薄呢'],
    'Velvet': ['天鵝絨', '天鹅绒'], 'Linen Cloth': ['麻織品', '亞麻布'],
    'Coral': ['珊瑚'], 'Amber': ['琥珀'], 'Ivory': ['象牙'], 'Pearl': ['珍珠'],
    'Tortoise Shell': ['玳瑁'], 'Gold': ['黃金', '金'], 'Silver': ['銀', '白銀'],
    'Copper Ore': ['銅礦石', '銅礦'], 'Tin Ore': ['錫礦石', '錫礦'], 'Iron Ore': ['鐵礦石', '鐵礦'],
    'Art': ['美術品', '古代美術品'], 'Carpet': ['地毯', '波斯地毯', '土耳其地毯'], 'Musk': ['麝香'],
    'Perfume': ['香水'], 'Glass Beads': ['玻璃珠', '玻璃球'],
    'Dye': ['染料'], 'Porcelain': ['瓷器'],
    'Glassware': ['玻璃工藝品', '玻璃制品'], 'Arms': ['武器', '火槍'], 'Wood': ['木材'],
}

goods_map = {}
for en, zh_list in GOOD_ZH.items():
    hit = None
    for zh in zh_list:
        for g in goods:
            if g['n'] == zh and (g.get('id') or g.get('img')):
                hit = g; break
        if hit: break
    if not hit:  # 模糊：包含关系
        for zh in zh_list:
            cands = [g for g in goods if (g.get('id') or g.get('img')) and (zh in g['n'] or g['n'] in zh)]
            if cands: hit = cands[0]; break
    if hit:
        # 图标：客户端提取图（id 命名）优先，否则维基图（中文文件名）
        f = id2file.get(hit['id']) if hit.get('id') else None
        icon = f[1] if f else hit.get('img')
        goods_map[en] = {'zh': hit['n'], 'id': hit.get('id'), 'file': icon,
                         'status': 'ok' if icon else 'no-icon'}
    else:
        goods_map[en] = {'zh': zh_list[0], 'id': None, 'file': None, 'status': 'MISSING'}

json.dump(goods_map, open('goods_map.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
ok = sum(1 for v in goods_map.values() if v['status'] == 'ok')
print(f"goods: {ok}/{len(GOOD_ZH)} ok")
for en, v in goods_map.items():
    if v['status'] != 'ok': print(' ', v['status'], en, '->', v['zh'])

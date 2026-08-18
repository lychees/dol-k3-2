# build_maps2.py — 发现物与船只映射：UW2 英文名 -> GVO 数据（dol-rev）
# 发现物图: assets/discovery/{id:04d}_a.png（大图）/ _i.png（图标）
# 船图: assets/ships/SHIP_THUMBS[i]（与 SHIPS 数组同序）
import json, sys
sys.stdout.reconfigure(encoding='utf-8')

def load_js(fname):
    src = open(fname, encoding='utf-8').read()
    return json.loads(src[src.index('['):src.rindex(']') + 1])

disc = load_js('discoveries.js')       # {id, n, c, d, i, a}
ships = load_js('ships.js')            # {cat, name, ...}
thumbs = load_js('ship_thumbs.js')     # [文件名]；注意：与 ships 并非一一对应，仅作参考

# ---------------- 发现物 ----------------
DISC_ZH = {
 'Prairie Dog': ['土撥鼠', '草原犬鼠'], 'Moai': ['霍圖‧瑪圖阿王的摩艾', '摩艾'],
 'Bison': ['美洲野牛', '野牛'], 'Blue Whale': ['藍鯨'],
 'Mexican Beaded Lizard': ['墨西哥毒蜥', '珠毒蜥'], 'Monument of the Sun': ['太陽之石', '太陽石碑'],
 'Stone Face': ['巨石人頭像', '奧爾梅克巨石头像', '石面人像'], 'Crystal Skull': ['水晶頭骨', '水晶骷髏', '被裝飾的頭蓋骨'],
 'Jade Mask': ['翡翠面具', '玉面具'], 'Popol Vuh': ['波波爾·烏', '波波爾烏'],
 "Venus' Flytrap": ['捕蠅草'], 'Giant Tortoise': ['象龜', '加拉帕戈斯象龜', '巨龜'],
 'Niagara Falls': ['尼亞加拉瀑布'], 'Mammoth': ['凍結的幼小長毛象', '猛獁象', '長毛象'],
 'Mural of Marnalico': ['瑪納利科壁畫', '博南帕克壁畫'], 'Guatavita Lake': ['瓜塔維塔湖'],
 'Stone Ball': ['石球', '哥斯達黎加石球'], 'Temple of the Sun': ['科納拉克太陽神神廟', '太陽神廟'],
 'Terracotta Figure': ['陶俑', '陶土人像'], 'Gold Frog': ['金蛙', '黃金蛙'],
 'Totem Pole': ['圖騰柱'], 'Vampire Bat': ['吸血蝠', '吸血蝙蝠'], 'Leon Penguin': ['企鵝'],
 'Passenger Pigeon': ['旅鴿'], 'Archaeopteryx': ['始祖鳥'], 'Tarantula': ['墨西哥紅膝頭毛蜘蛛', '捕鳥蛛', '狼蛛'],
 'Lake Titicaca': ['的的喀喀湖'], 'Balsa': ['輕木', '巴沙木'], 'Piranha': ['食人魚', '水虎魚'],
 'Matamata': ['枯葉龜', '瑪塔龜'], 'Cactus': ['仙人掌'], 'Anteater': ['食蟻獸', '大食蟻獸'],
 'Pororoca': ['波羅羅卡', '亞馬遜湧潮'], 'Saber-toothed Tiger': ['劍齒虎'],
 'Toucan': ['巨嘴鳥', '鵎鵼'], 'Iguana': ['鬣蜥', '美洲鬣蜥'], 'Clay Monster': ['泥人', '黏土怪'],
 'Amazon Water Lily': ['睡蓮', '王蓮', '亞馬遜王蓮'], 'Anaconda': ['森蚺', '水蚺'],
 'Giant Ground Sloth': ['大地懶'], 'Great Auk': ['大海雀'], 'Clay Mosque': ['傑內大清真寺', '黏土清真寺'],
 'Stonehenge': ['巨石陣'], 'Ant Hill': ['行軍蟻', '蟻丘', '白蟻丘'], "Diogo's Monument": ['迪奧戈紀念碑', '迪奧戈石柱'],
 'Quagga': ['斑驢'], 'Armadillo': ['犰狳'], 'Moquele Mubembe': ['魔克拉-姆邊貝', '剛果恐龍'],
 "Diaz's Monument": ['迪亞士紀念碑', '迪亞士石柱'], 'Moonbow': ['月虹'],
 'Big Zimbabwe': ['辛巴威遺跡', '大津巴布韋'], 'Rosetta Stone': ['羅塞塔石碑'],
 'Khufu Pyramid': ['胡夫金字塔', '吉薩大金字塔', '金字塔'], 'Baobab': ['猴麵包樹', '麵包樹'],
 'Nubia Pyramid': ['努比亞金字塔', '麥羅埃金字塔'], 'Victoria Falls': ['維多利亞瀑布'],
 'Pteranodon': ['無齒翼龍', '翼龍'], 'Crocodile': ['鱷魚', '尼羅鱷'],
 'Tessisat Falls': ['特西薩特瀑布'], 'Papyrus': ['紙莎草'], 'Mandrill': ['山魈'],
 'Chameleon': ['變色龍'], 'Burning Water': ['燃燒的水', '火水'], 'Dodo': ['渡渡鳥'],
 'Mohenio-Daro': ['摩亨佐·達羅', '摩亨佐達羅'], 'King Cobra': ['眼鏡王蛇', '眼鏡蛇'],
 'Aurora': ['極光爆發', '極光'], 'Inle Lake': ['茵萊湖'], 'Hornbill': ['印度大犀鳥', '犀鳥'],
 "Ayutthaya's Buddha": ['大城佛像', '臥佛'], 'Panda': ['大熊貓', '貓熊'],
 'Angkor Wat': ['吳哥遺跡', '吳哥窟'], 'Borobudur': ['婆羅浮屠'], 'Hedgehog': ['刺蝟'],
 'Pitcher Plant': ['豬籠草'], 'Kalavinka': ['迦陵頻伽'], 'Great Wall': ['萬里長城', '長城'],
 'Python': ['蟒蛇'], 'Qian Ling': ['乾陵'], 'Frilled Lizard': ['褶傘蜥', '傘蜥蜴'],
 'Kangaroo': ['袋鼠'], 'Stone Buddha': ['石佛', '大石佛'], 'Komodo Dragon': ['科穆多巨蜥', '科莫多巨蜥'],
 'Tree Snake': ['樹蛇'], 'Plant Worm': ['植物蟲', '食蟲植物'], 'Durian': ['榴槤', '榴蓮'],
 'Ayers Rock': ['艾爾斯岩', '烏魯魯'], 'Fruit Bat': ['果蝠', '狐蝠'],
 'Greater Bird of Paradise': ['大極樂鳥', '極樂鳥'], 'Toro Ruins': ['托羅遺跡', '登呂遺跡'],
 'Namahage': ['生剝鬼', '納馬哈格'], 'Kiwi': ['鷸鴕', '奇異鳥'],
 'Tasmanian Devil': ['袋獾'], 'Koala': ['無尾熊', '考拉', '樹袋熊'],
 'Indo-Pacific Cowrie': ['寶螺', '印太寶螺'], 'Moa': ['恐鳥'], 'Nasiped': ['納西佩德', '鼻行獸'],
 "Stellar's Sea Cow": ['斯特拉海牛', '大海牛'], 'Mount Fuji': ['富士山'],
 'Grand Canyon': ['大峽谷'], 'Mount Everest': ['珠穆朗瑪峰', '聖母峰'],
 'Lake Baikal': ['貝加爾湖'], 'Iguazu Falls': ['伊瓜蘇瀑布'], 'Dead Sea': ['死海'],
 'Matterhorn': ['馬特洪峰'], 'Amazon River': ['亞馬遜河'],
}

disc_map, missing = {}, []
for en, zh_list in DISC_ZH.items():
    hit = None
    for zh in zh_list:
        for d in disc:
            if d['n'] == zh and d.get('a'):
                hit = d; break
        if hit: break
    if not hit:
        for zh in zh_list:
            cands = [d for d in disc if d.get('a') and (zh in d['n'] or d['n'] in zh)]
            if cands: hit = cands[0]; break
    if not hit:  # 无大图的也接受（至少有图标）
        for zh in zh_list:
            for d in disc:
                if d['n'] == zh: hit = d; break
            if hit: break
    if hit:
        disc_map[en] = {'zh': hit['n'], 'id': hit['id'], 'art': bool(hit.get('a')), 'icon': bool(hit.get('i'))}
    else:
        disc_map[en] = {'zh': zh_list[0], 'id': None}
        missing.append(en)

json.dump(disc_map, open('discoveries_map.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
ok = sum(1 for v in disc_map.values() if v.get('id') and v.get('art'))
print(f"discoveries: {ok}/{len(DISC_ZH)} with artwork; missing: {missing}")

# ---------------- 船只 ----------------
SHIP_ZH = {
 'Balsa': ['輕木帆船', '探險用輕木帆船'], 'Hansa Cog': ['漢薩‧柯克帆船', '柯克帆船'],
 'Dhow': ['阿拉伯帆船', '小型阿拉伯帆船'], 'Buss': ['巴斯帆船', '巴斯船'],
 'Talette': ['塔列特帆船'], 'Caravela Latina': ['拉丁卡拉維爾帆船', '卡拉維爾帆船'],
 'Caravela Redonda': ['圓形卡拉維爾帆船', '小型卡拉維爾帆船'], 'Brigantine': ['雙桅橫帆船', '布里根廷帆船'],
 'Nao': ['納奧帆船', '瑙船'], 'Carrack': ['克拉克帆船'], 'Galleon': ['蓋倫帆船'],
 'Xebec': ['謝貝克帆船', '三桅小帆船'], 'Pinnace': ['平底帆船', '小帆船'],
 'Sloop': ['單桅縱帆船', '斯盧普帆船'], 'Frigate': ['巡防艦', '護衛艦'],
 'Barge': ['大型帆船', '駁船'], 'Full Rigged Ship': ['全帆裝帆船', '全裝帆船'],
 'Junk': ['戎克船', '中國帆船'], 'Light Galley': ['輕型槳帆船', '加萊排槳小型帆船'],
 'Flemish Galleon': ['佛蘭德蓋倫帆船', '佛蘭芒蓋倫帆船'],
 'Venetian Galeass': ['威尼斯加萊賽船', '加萊賽帆船'], 'La Reale': ['皇家號', '皇家帆船'],
}
ship_map, smissing = {}, []
for en, zh_list in SHIP_ZH.items():
    hit_i = None
    for zh in zh_list:
        for i, s in enumerate(ships):
            if s['name'] == zh: hit_i = i; break
        if hit_i is not None: break
    if hit_i is None:
        for zh in zh_list:
            cands = [i for i, s in enumerate(ships) if zh in s['name'] or s['name'] in zh]
            if cands: hit_i = cands[0]; break
    if hit_i is not None:
        ship_map[en] = {'zh': ships[hit_i]['name'], 'file': thumbs[hit_i]}
    else:
        ship_map[en] = {'zh': zh_list[0], 'file': None}
        smissing.append(en)
json.dump(ship_map, open('ships_map.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f"ships: {len(SHIP_ZH)-len(smissing)}/{len(SHIP_ZH)}; missing: {smissing}")

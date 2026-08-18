# gen_lang_zh.py — 生成 assets/lang_zh.json（中文语言包：商品/发现物/港口/船/怪物名）
import json, sys, os
sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)  # 数据文件（goods.js 等）与脚本同目录
GAME = os.path.join(HERE, '..', '..', 'game')           # tools/gvo/ -> repo 根下的 game/
if not os.path.isdir(GAME):                             # 兼容在独立目录运行
    GAME = os.path.join(HERE, '..', 'game', 'game')

# ---- 商品 46（简体）----
GOODS = {
 'Clove':'丁香','Cinnamon':'桂皮','Pepper':'胡椒','Nutmeg':'肉豆蔻','Pimento':'多香果',
 'Ginger':'姜','Tobacco':'烟草','Tea':'茶叶','Coffee':'咖啡','Cacao':'可可','Sugar':'糖',
 'Cheese':'乳酪','Fish':'鱼','Grain':'小麦','Olive Oil':'橄榄油','Wine':'葡萄酒','Rock Salt':'岩盐',
 'Silk':'生丝','Cotton':'棉花','Wool':'羊毛','Flax':'亚麻','Cotton Cloth':'棉织品',
 'Silk Cloth':'丝织品','Wool Cloth':'毛织品','Velvet':'天鹅绒','Linen Cloth':'麻织品',
 'Coral':'珊瑚','Amber':'琥珀','Ivory':'象牙','Pearl':'珍珠','Tortoise Shell':'玳瑁',
 'Gold':'黄金','Silver':'白银','Copper Ore':'铜矿石','Tin Ore':'锡矿石','Iron Ore':'铁矿石',
 'Art':'美术品','Carpet':'地毯','Musk':'麝香','Perfume':'香水','Glass Beads':'玻璃珠',
 'Dye':'染料','Porcelain':'瓷器','Glassware':'玻璃工艺品','Arms':'武器','Wood':'木材',
}

# ---- 发现物（简体名；说明取 GVO 匹配条目的繁中说明，未匹配保留英文）----
DISC_NAMES = {
 'Prairie Dog':'土拨鼠','Moai':'摩艾石像','Bison':'美洲野牛','Blue Whale':'蓝鲸',
 'Mexican Beaded Lizard':'墨西哥毒蜥','Monument of the Sun':'太阳之石','Stone Face':'巨石人像',
 'Crystal Skull':'水晶头骨','Jade Mask':'翡翠面具','Popol Vuh':'波波尔·乌',"Venus' Flytrap":'捕蝇草',
 'Giant Tortoise':'象龟','Niagara Falls':'尼亚加拉瀑布','Mammoth':'猛犸象',
 'Mural of Marnalico':'马尔纳利科壁画','Guatavita Lake':'瓜塔维塔湖','Stone Ball':'石球',
 'Temple of the Sun':'太阳神庙','Terracotta Figure':'陶俑','Gold Frog':'金蛙','Totem Pole':'图腾柱',
 'Vampire Bat':'吸血蝠','Leon Penguin':'莱昂企鹅','Passenger Pigeon':'旅鸽','Archaeopteryx':'始祖鸟',
 'Tarantula':'捕鸟蛛','Lake Titicaca':'的的喀喀湖','Balsa':'轻木','Piranha':'食人鱼',
 'Matamata':'枯叶龟','Cactus':'仙人掌','Anteater':'食蚁兽','Pororoca':'波罗罗卡涌潮',
 'Saber-toothed Tiger':'剑齿虎','Toucan':'巨嘴鸟','Iguana':'鬣蜥','Clay Monster':'泥人',
 'Amazon Water Lily':'亚马逊王莲','Anaconda':'森蚺','Giant Ground Sloth':'大地懒','Great Auk':'大海雀',
 'Clay Mosque':'黏土清真寺','Stonehenge':'巨石阵','Ant Hill':'蚁丘',"Diogo's Monument":'迪奥戈纪念碑',
 'Quagga':'斑驴','Armadillo':'犰狳','Moquele Mubembe':'魔克拉-姆边贝',"Diaz's Monument":'迪亚士纪念碑',
 'Moonbow':'月虹','Big Zimbabwe':'大津巴布韦','Rosetta Stone':'罗塞塔石碑','Khufu Pyramid':'胡夫金字塔',
 'Baobab':'猴面包树','Nubia Pyramid':'努比亚金字塔','Victoria Falls':'维多利亚瀑布',
 'Pteranodon':'无齿翼龙','Crocodile':'鳄鱼','Tessisat Falls':'特西萨特瀑布','Papyrus':'纸莎草',
 'Mandrill':'山魈','Chameleon':'变色龙','Burning Water':'燃烧之水','Dodo':'渡渡鸟',
 'Mohenio-Daro':'摩亨佐·达罗','King Cobra':'眼镜王蛇','Aurora':'极光','Inle Lake':'茵莱湖',
 'Hornbill':'犀鸟',"Ayutthaya's Buddha":'大城佛像','Panda':'大熊猫','Angkor Wat':'吴哥窟',
 'Borobudur':'婆罗浮屠','Hedgehog':'刺猬','Pitcher Plant':'猪笼草','Kalavinka':'迦陵频伽',
 'Great Wall':'万里长城','Python':'蟒蛇','Qian Ling':'乾陵','Frilled Lizard':'褶伞蜥',
 'Kangaroo':'袋鼠','Stone Buddha':'石佛','Komodo Dragon':'科莫多巨蜥','Tree Snake':'树蛇',
 'Plant Worm':'植物虫','Durian':'榴莲','Ayers Rock':'艾尔斯岩','Fruit Bat':'果蝠',
 'Greater Bird of Paradise':'大极乐鸟','Toro Ruins':'托罗遗迹','Namahage':'生剥鬼','Kiwi':'鹬鸵',
 'Tasmanian Devil':'袋獾','Koala':'树袋熊','Indo-Pacific Cowrie':'宝螺','Moa':'恐鸟',
 'Nasiped':'鼻行兽',"Stellar's Sea Cow":'斯特拉海牛','Mount Fuji':'富士山','Grand Canyon':'大峡谷',
 'Mount Everest':'珠穆朗玛峰','Lake Baikal':'贝加尔湖','Iguazu Falls':'伊瓜苏瀑布','Dead Sea':'死海',
 'Matterhorn':'马特洪峰','Amazon River':'亚马逊河',
}

# GVO 匹配条目的中文说明（繁中原文）
disc_map = json.load(open(os.path.join(HERE, 'discoveries_map.json'), encoding='utf-8'))
src = open(os.path.join(HERE, 'discoveries.js'), encoding='utf-8').read()
gvo_disc = json.loads(src[src.index('['):src.rindex(']') + 1])
gvo_by_id = {d['id']: d for d in gvo_disc}
discoveries = {}
for en, zh in DISC_NAMES.items():
    entry = {'n': zh}
    gvo_id = disc_map.get(en, {}).get('id')
    if gvo_id and gvo_by_id.get(gvo_id, {}).get('d'):
        entry['d'] = gvo_by_id[gvo_id]['d']   # 繁中说明
    discoveries[en] = entry

# ---- 港口 132（简体，手写）----
PORTS = {
 1:'里斯本',2:'塞维利亚',3:'伊斯坦布尔',4:'巴塞罗那',5:'阿尔及尔',6:'突尼斯',7:'瓦伦西亚',
 8:'马赛',9:'热那亚',10:'比萨',11:'那不勒斯',12:'锡拉库萨',13:'帕尔马',14:'威尼斯',15:'拉古萨',
 16:'干地亚',17:'雅典',18:'萨洛尼卡',19:'亚历山大',20:'雅法',21:'贝鲁特',22:'尼科西亚',
 23:'的黎波里',24:'卡法',25:'亚速',26:'特拉布宗',27:'休达',28:'波尔多',29:'南特',30:'伦敦',
 31:'布里斯托尔',32:'都柏林',33:'安特卫普',34:'阿姆斯特丹',35:'哥本哈根',36:'汉堡',37:'奥斯陆',
 38:'斯德哥尔摩',39:'吕贝克',40:'但泽',41:'里加',42:'卑尔根',43:'加拉加斯',44:'卡塔赫纳',
 45:'哈瓦那',46:'玛格丽塔',47:'巴拿马',48:'韦柳港',49:'圣多明各',50:'韦拉克鲁斯',51:'牙买加',
 52:'危地马拉',53:'伯南布哥',54:'里约热内卢',55:'马拉开波',56:'圣地亚哥',57:'卡宴',
 58:'马德拉',59:'圣克鲁斯',60:'圣乔治',61:'比绍',62:'罗安达',63:'阿尔金',64:'巴瑟斯特',
 65:'廷巴克图',66:'阿比让',67:'索法拉',68:'马林迪',69:'摩加迪沙',70:'蒙巴萨',71:'莫桑比克',
 72:'克利马内',73:'亚丁',74:'霍尔木兹',75:'马萨瓦',76:'开罗',77:'巴士拉',78:'麦加',
 79:'卡塔尔',80:'设拉子',81:'马斯喀特',82:'第乌',83:'科钦',84:'锡兰',85:'安汶',86:'果阿',
 87:'马六甲',88:'特尔纳特',89:'班达',90:'帝力',91:'帕塞',92:'巽他',93:'卡利卡特',94:'曼谷',
 95:'泉州',96:'澳门',97:'河内',98:'长安',99:'堺',100:'长崎',101:'赫克拉',102:'纳尔维克',
 103:'开普敦',104:'贝尔格莱德',105:'塔马塔夫',106:'迪克森',107:'旅顺',108:'勒维克',
 109:'棉兰老',110:'季克西',111:'虾夷',112:'吉朗',113:'关岛',114:'莫尔兹比',115:'科尔夫',
 116:'旺格努伊',117:'苏瓦',118:'诺姆',119:'纳阿莱胡',120:'塔希提',121:'朱诺',122:'科珀曼',
 123:'圣巴巴拉',124:'丘吉尔',125:'卡亚俄',126:'瓦尔帕莱索',127:'莫延多',128:'科德角',
 129:'蒙得维的亚',130:'福雷尔',131:'淡水',132:'法鲁',
}

# ---- 船 22（简体）----
SHIPS = {
 'Balsa':'轻木帆船','Hansa Cog':'汉萨柯克船','Dhow':'阿拉伯三角帆船','Buss':'巴斯帆船',
 'Talette':'塔列特帆船','Caravela Latina':'拉丁卡拉维尔帆船','Caravela Redonda':'圆帆卡拉维尔帆船',
 'Brigantine':'双桅横帆船','Nao':'瑙帆船','Carrack':'克拉克帆船','Galleon':'盖伦帆船',
 'Xebec':'谢贝克帆船','Pinnace':'平底小帆船','Sloop':'单桅纵帆船','Frigate':'巡防舰',
 'Barge':'大型驳船','Full Rigged Ship':'全帆装帆船','Junk':'戎克船','Light Galley':'轻型桨帆船',
 'Flemish Galleon':'佛兰德盖伦帆船','Venetian Galeass':'威尼斯加莱赛船','La Reale':'皇家号',
}

# ---- 怪物 8（简体；与发现物同名的复用）----
MONSTERS = {
 'Prairie Dog':'土拨鼠','Tree Snake':'树蛇','Python':'蟒蛇','Bison':'美洲野牛',
 'Panda':'大熊猫','Crocodile':'鳄鱼','Saber-toothed Tiger':'剑齿虎','Blue Whale':'蓝鲸',
}

out = {
 'goods': GOODS,
 'discoveries': discoveries,
 'ports': {str(k): v for k, v in PORTS.items()},
 'ships': SHIPS,
 'monsters': MONSTERS,
}
json.dump(out, open(os.path.join(GAME, 'assets', 'lang_zh.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
n_desc = sum(1 for v in discoveries.values() if 'd' in v)
print(f"lang_zh.json: goods {len(GOODS)}, discoveries {len(discoveries)} ({n_desc} 含中文说明), ports {len(PORTS)}, ships {len(SHIPS)}, monsters {len(MONSTERS)}")

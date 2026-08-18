// gvo.js — GVO（大航海时代 Online）素材包映射，数据来自 dol-rev 项目
// (https://github.com/lychees/dol-rev，经其 GitHub Pages 跨域加载，Pages 带 ACAO:*)。
// 由 gvo_ref/gen_gvo_js.py 生成，请勿手改。
const GVO_BASE = 'https://lychees.github.io/dol-rev/';

// 商品图标：UW2 商品名 -> dol-rev assets/goods/ 下的文件名（44/46 有对应图标）
const GVO_GOODS = {
 "Clove": "丁香.jpg",
 "Cinnamon": "桂皮.gif",
 "Pepper": "胡椒.jpg",
 "Nutmeg": "肉豆蔻.jpg",
 "Pimento": "多香果.jpg",
 "Ginger": "薑.jpg",
 "Tobacco": "草.jpg",
 "Tea": "馬黛茶.gif",
 "Coffee": "00138_id1600155_f0.png",
 "Cacao": "00135_id1600152_f0.png",
 "Sugar": "00099_id1600103_f0.png",
 "Cheese": "00019_id1600020_f0.png",
 "Fish": "尼羅魚.jpg",
 "Grain": "00010_id1600011_f0.png",
 "Olive Oil": "00098_id1600102_f0.png",
 "Wine": "00060_id1600061_f0.png",
 "Rock Salt": "00100_id1600104_f0.png",
 "Silk": "00258_id1600306_f0.png",
 "Cotton": "00262_id1600310_f0.png",
 "Wool": "00266_id1600314_f0.png",
 "Flax": "00253_id1600301_f0.png",
 "Cotton Cloth": "棉布料.gif",
 "Silk Cloth": "絲綢布料.gif",
 "Wool Cloth": "英格蘭花呢.gif",
 "Velvet": "天鵝絨.gif",
 "Linen Cloth": "麻.gif",
 "Coral": "00412_id1600608_f0.png",
 "Amber": "琥珀.jpg",
 "Ivory": "00415_id1600611_f0.png",
 "Pearl": "00413_id1600609_f0.png",
 "Tortoise Shell": "玳瑁.jpg",
 "Gold": "00363_id1600501_f0.png",
 "Silver": "00364_id1600502_f0.png",
 "Copper Ore": "銅礦石.gif",
 "Tin Ore": "錫礦石.gif",
 "Iron Ore": "鐵礦石.gif",
 "Art": "古代美術品.jpg",
 "Carpet": "波斯地毯.gif",
 "Musk": "麝香.jpg",
 "Glass Beads": "00449_id1600664_f0.png",
 "Porcelain": "00441_id1600656_f0.png",
 "Glassware": "00436_id1600651_f0.png",
 "Arms": "火槍.gif",
 "Wood": "00526_id1600917_f0.png"
};

// 发现物：游戏村庄 id -> GVO 发现物 id（59/110 有大图）
// 大图 assets/discovery/{id:04d}_a.png（128px），小图标 _i.png（48px）
const GVO_DISC = {"1": 1289, "2": 1317, "3": 1262, "4": 466, "6": 1320, "10": 929, "11": 937, "15": 3399, "16": 494, "17": 2061, "18": 1970, "20": 452, "24": 447, "27": 442, "28": 436, "32": 957, "33": 921, "36": 2530, "37": 2739, "39": 2246, "40": 2496, "41": 2262, "44": 2119, "45": 2156, "46": 3464, "49": 538, "50": 2526, "51": 9, "53": 1001, "56": 19, "59": 1018, "60": 428, "66": 975, "67": 1016, "68": 2130, "70": 1248, "73": 399, "74": 1807, "75": 1134, "76": 1050, "77": 512, "78": 2886, "79": 1122, "80": 1051, "81": 245, "85": 1194, "87": 1247, "88": 542, "89": 1498, "90": 3384, "91": 469, "94": 1581, "95": 1646, "96": 3708, "97": 2809, "98": 2954, "102": 1262, "103": 1970, "110": 1020};

// --- 解析 helpers ---
const gvoImgCache = {};
// 加载一张 GVO 图片（跨域，带 CORS）；失败 resolve(null)。调用方需缓存结果。
export function gvoImage(path) {
  if (gvoImgCache[path]) return gvoImgCache[path];
  const p = new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = GVO_BASE + encodeURI(path);
  });
  gvoImgCache[path] = p;
  return p;
}

// 商品的 GVO 图标 URL；无对应返回 null
export function gvoGoodIconURL(name) {
  const f = GVO_GOODS[name];
  return f ? GVO_BASE + encodeURI('assets/goods/' + f) : null;
}

// 发现物的 GVO 大图 / 小图标路径；无对应返回 null
export function gvoDiscArtPath(villageId) {
  const id = GVO_DISC[villageId];
  return id ? `assets/discovery/${String(id).padStart(4, '0')}_a.png` : null;
}
export function gvoDiscIconPath(villageId) {
  const id = GVO_DISC[villageId];
  return id ? `assets/discovery/${String(id).padStart(4, '0')}_i.png` : null;
}
export const gvoDiscHas = villageId => villageId in GVO_DISC;

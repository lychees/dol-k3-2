// gvo.js — GVO（大航海时代 Online）素材包，数据来自 dol-rev 项目
// (https://github.com/lychees/dol-rev，经其 GitHub Pages 跨域加载，Pages 带 ACAO:*)。
// 映射表在 assets/gvo_map.json（可用 editor/gvoimport.html 扩展），由 gvo_ref/ 脚本生成。
const GVO_BASE = 'https://lychees.github.io/dol-rev/';

// { goods: { UW2商品名: 图标文件名 }, discoveries: { 村庄id: GVO发现物id } }
const MAP = await fetch('./assets/gvo_map.json').then(r => r.json());
const GVO_GOODS = MAP.goods ?? {};
const GVO_DISC = MAP.discoveries ?? {};

// --- 解析 helpers ---
const gvoImgCache = {};
// 加载一张 GVO 图片（跨域，带 CORS）；失败 resolve(null)。Promise 已缓存。
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
// 大图 assets/discovery/{id:04d}_a.png（128px），小图标 _i.png（48px）
export function gvoDiscArtPath(villageId) {
  const id = GVO_DISC[villageId];
  return id ? `assets/discovery/${String(id).padStart(4, '0')}_a.png` : null;
}
export function gvoDiscIconPath(villageId) {
  const id = GVO_DISC[villageId];
  return id ? `assets/discovery/${String(id).padStart(4, '0')}_i.png` : null;
}
export const gvoDiscHas = villageId => villageId in GVO_DISC;

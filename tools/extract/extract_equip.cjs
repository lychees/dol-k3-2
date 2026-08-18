// extract_equip.cjs — 提取 OUTFIT_ITEMS + CABIN_TYPES + CABIN_DEFAULTS 到 assets/equipment.json，
// 并生成 assets/balance.json（平衡参数，数值取自 main.js 当前常量）
const fs = require('fs');
const path = require('path');
const gameDir = path.join(__dirname, '..', '..', 'game');
const src = fs.readFileSync(path.join(gameDir, 'main.js'), 'utf8');

function extractObject(marker, opener) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(marker + ' not found');
  const objStart = src.indexOf(opener, start);
  let depth = 0, i = objStart, inStr = null, esc = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === opener) depth++;
    else if ((opener === '[' && c === ']') || (opener === '{' && c === '}')) {
      depth--; if (depth === 0) { i++; break; }
    }
  }
  return eval('(' + src.slice(objStart, i) + ')');
}

const outfit = extractObject('const OUTFIT_ITEMS =', '[');
const cabins = extractObject('const CABIN_TYPES =', '{');
const cabinDefaults = extractObject('const CABIN_DEFAULTS =', '[');

fs.writeFileSync(path.join(gameDir, 'assets', 'equipment.json'),
  JSON.stringify({ outfit, cabins, cabinDefaults }, null, 1));
console.log('equipment.json:', outfit.length, 'outfit items,', Object.keys(cabins).length, 'cabin types');

const balance = {
  sailDayScale: 10,        // 航行时时间加速倍数
  dayLengthSec: 180,       // 一游戏日的现实秒数
  bankInterest: 0.02,      // 银行日利率
  drainBase: 4,            // 补给消耗基数（每日）
  drainPerCrew: 0.25,      // 每船员额外消耗
  fatiguePerSettle: 6,     // 每次结算疲劳增量
  starvingFatigueMul: 3,   // 断粮时疲劳倍率
  deathBase: 10,           // 疲劳致死基数
  deathMinPct: 0.05,       // 致死比例下限
  deathRandPct: 0.2,       // 致死比例随机幅度
  pirateShips: ['Brigantine', 'Nao', 'Galleon', 'Carrack'],  // 海盗船型池
  pirateRate: 25,          // 海盗刷新间隔（秒，0 = 不刷新）
};
fs.writeFileSync(path.join(gameDir, 'assets', 'balance.json'), JSON.stringify(balance, null, 1));
console.log('balance.json written');

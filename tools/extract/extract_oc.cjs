// extract_oc.cjs — 从 main.js 提取原创伙伴（Object.assign(matesData, {...}) 块）到 assets/mates_extra.json
const fs = require('fs');
const path = require('path');
const gameDir = path.join(__dirname, '..', '..', 'game');
const src = fs.readFileSync(path.join(gameDir, 'main.js'), 'utf8');

const marker = 'Object.assign(matesData, {';
const start = src.indexOf(marker);
if (start < 0) throw new Error('extra mates block not found');
const objStart = src.indexOf('{', start);

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
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
}
const obj = eval('(' + src.slice(objStart, i) + ')');
fs.writeFileSync(path.join(gameDir, 'assets', 'mates_extra.json'), JSON.stringify(obj, null, 1));
console.log('extra mates:', Object.keys(obj).join(','), '—', Object.values(obj).map(m => m.name).join(', '));

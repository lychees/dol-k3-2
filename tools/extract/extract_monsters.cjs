// extract_monsters.cjs — 从 main.js 提取 LAND_MONSTERS 到 assets/monsters.json
const fs = require('fs');
const path = require('path');
const gameDir = path.join(__dirname, '..', '..', 'game');
const src = fs.readFileSync(path.join(gameDir, 'main.js'), 'utf8');

const start = src.indexOf('const LAND_MONSTERS = [');
if (start < 0) throw new Error('LAND_MONSTERS not found');
const arrStart = src.indexOf('[', start);
let depth = 0, i = arrStart, inStr = null, esc = false;
for (; i < src.length; i++) {
  const c = src[i];
  if (inStr) {
    if (esc) esc = false;
    else if (c === '\\') esc = true;
    else if (c === inStr) inStr = null;
    continue;
  }
  if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
  if (c === '[' || c === '{') depth++;
  else if (c === ']' || c === '}') { depth--; if (depth === 0) { i++; break; } }
}
const arr = eval('(' + src.slice(arrStart, i) + ')');
fs.writeFileSync(path.join(gameDir, 'assets', 'monsters.json'), JSON.stringify(arr, null, 1));
console.log('monsters:', arr.length, '—', arr.map(m => m.name).join(', '));

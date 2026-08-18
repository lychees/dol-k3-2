// extract_story.cjs — 从 main.js 提取 STORYLINES 的数据字段到 assets/story.json
const fs = require('fs');
const path = require('path');
const gameDir = path.join(__dirname, '..', '..', 'game');
const src = fs.readFileSync(path.join(gameDir, 'main.js'), 'utf8');

const start = src.indexOf('const STORYLINES = [');
if (start < 0) throw new Error('STORYLINES not found');
const arrStart = src.indexOf('[', start);

// 平衡括号提取整个数组字面量（跳过字符串/模板串内容）
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
const literal = src.slice(arrStart, i);

// 用桩变量 eval 出结构（check/progress 是函数，只取数据字段）
const P = { fame: 0, gold: 0, shipsSunk: 0, treasuresDug: 0 };
const discovered = new Set(), discoveriesFound = new Set();
const story = eval('(' + literal + ')');

const out = story.map(line => ({
  title: line.title,
  steps: line.steps.map(s => ({ name: s.name, goal: s.goal, reward: s.reward, text: s.text })),
}));
fs.writeFileSync(path.join(gameDir, 'assets', 'story.json'), JSON.stringify(out, null, 1));
console.log('storylines:', out.length, '| steps per line:', out.map(l => l.steps.length).join(','));

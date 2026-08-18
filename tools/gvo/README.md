# tools/gvo — GVO（dol-rev）素材融合管线

把 [dol-rev](https://github.com/lychees/dol-rev)（大航海时代 Online 资源站）的
内容映射到本游戏，生成两个资产文件：

- `game/assets/gvo_map.json` — 商品图标 + 发现物大图的映射（GVO 素材包用）
- `game/assets/lang_zh.json` — 中文语言包（商品/港口/船/发现物/怪物译名）

## 步骤

```bash
cd tools/gvo
# 1. 下载 dol-rev 数据（GitHub Pages，约 1.7MB）
for f in goods.js discoveries.js ships.js ship_thumbs.js filelist.js; do
  curl -sO "https://lychees.github.io/dol-rev/data/$f"
done

# 2. 建立映射（输出 goods_map.json / discoveries_map.json / ships_map.json，
#    并打印未匹配项；改脚本顶部的中英文对照字典可提高覆盖率）
python build_maps.py     # 商品：UW2 英文名 -> GVO 图标文件
python build_maps2.py    # 发现物：UW2 英文名 -> GVO 发现物 id

# 3. 生成游戏资产
python gen_gvo_map.py    # -> game/assets/gvo_map.json
python gen_lang_zh.py    # -> game/assets/lang_zh.json
```

注意：

- GVO 的发现物/商品集与 UW2 并不完全重合，未匹配的条目自动回退经典素材，
  属正常现象（当前覆盖：商品 44/46，发现物 59 个村庄 id）。
- 船只名称在 dol-rev 中没有与图标文件的关联数据，故船图不做 GVO 映射。
- 发现物说明文字为 dol-rev 爬取的繁体中文原文。
- 线上编辑器 `editor/gvoimport.html` 可在运行时继续追加发现物映射。

## tools/extract — 内置数据提取脚本（一次性迁移用）

`extract_*.cjs` 从 `main.js` 的内置常量提取数据为 JSON（story / mates_extra /
monsters / equipment）。这些 JSON 现在由游戏启动时直接加载覆盖内置值，
脚本仅在校对或重建时需要用 `node tools/extract/extract_story.cjs` 等运行。

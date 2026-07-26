# DOS 版《大航海时代 2》（Uncharted Waters: New Horizons）导出素材

从 DOS 版游戏本体（`Uncharted_Waters_2/`，未入库）导出的全部素材。
导出流程参考了知乎文章《大航海时代2的逆向工程实验》提到的两个参考实现：

- [JohanLi/uncharted-waters-2-research](https://github.com/JohanLi/uncharted-waters-2-research) — 资源格式解析脚本
- [tzengyuxio/kaodata](https://github.com/tzengyuxio/kaodata) — Koei LS11 压缩格式解码

## 导出管线

1. `python tools/extract_ls11.py Uncharted_Waters_2 raw`
   把 14 个 `.LZW` 归档（LS10/LS11 格式：magic + 256 字节字典 + 分片表 +
   LZW 变体压缩）解压为 `raw/<NAME>/<NAME>.NNN` 原始分片。
   `tools/extract_ls11.py` 是 kaodata `dekoei/ls11.py` 的纯 Python 移植（去掉
   bitarray 依赖），并兼容 LS10 magic。
2. 克隆 uncharted-waters-2-research，把 `raw/` 放到其根目录，运行其中的
   一次性脚本（见下表「来源脚本」）。

## 目录内容

| 目录 | 内容 | 来源文件 | 来源脚本 |
|---|---|---|---|
| `worldmap/` | 世界地图 3 块（各 720×1080）+ 合并版 `world-map.bin`（2160×1080 字节，0-based  tile id）+ 对应 PNG | WORLDMAP.LZW（3 分片） | draw_world_map.py, combine_world_map_parts.py |
| `tilesets/` | `regular-tileset.png`（16×8 小图块）、`large-tileset.png`（12×12 大块）、`ship-tileset.png`（船只） | DATA1.LZW | draw_tilesets.py |
| `ports/` | `port-tilemaps.bin`（101×96×96 港口地图）、`port-tilesets.png`（7 套港口图块）、`ports.json`（港口元数据） | PORTMAP.LZW, PORTCHIP.LZW, DATA1.015 | ports/*.py |
| `ships/` | `ships.json`（22 种船：帆型/动力/容量/火炮/水手/价格） | MAIN.EXE | ships/extract_metadata.py |
| `portraits/` | `portraits.png`（128 张 64×80 头像横排）、`items.png`（道具）、`discoveries.png`（99 张发现物） | KAO.LZW（270 分片：0–127 头像，128–226 发现物，227–269 道具） | portraits-items-discoveries/*.py |
| `dueling/png/` | 875 张决斗 sprite（IAP1–6 = 玩家 6 主角 × 35 组，IAE1 = NPC 35 组，每组含多帧带透明通道） | IAP1–6.LZW, IAE1.LZW（各 35 分片） | dueling/extract_iap.py, extract_iae.py |
| `characters/` | 7 张主角行走帧横排（char0–5 各 8 帧 32×32，char6 为 24 帧） | CHAR.LZW（7 分片） | portraits-items-discoveries/char.py |
| `wind_current/` | 夏季风、冬季风、洋流可视化图 | WINDCUR.DAT | draw_winds_current_anomalies.py |
| `music/` | 21 首曲目：`midi/`（原始 MIDI）+ `ogg/` + `mp3/`（fluidsynth + TimGM6mb.sf2 渲染） | 见下「音乐」 | — |

## 音乐

DOS 版音乐本体是 FM 音源数据（SNR*.DAT/.MES, D2.MML），无法直接转波形。
采用与参考实现相同的方案：[tieba 用户 botxp 手工制作的 MIDI](https://tieba.baidu.com/p/2753769314)
（21 首，存于 `music/midi/`），再用 fluidsynth + TimGM6mb.sf2（GPL, MuseScore 1.3
附带的 GM 音色库）渲染为 `music/ogg/` 与 `music/mp3/`（各 21 首）。
其中 8 首与参考实现 repo 中已转换的版本同名覆盖。
- 本目录素材与 `game/assets/`（SNES 版，来自 uw2ol）是两套不同平台的素材，
  tile id 编码不同（DOS 版 world-map.bin 为 0-based）。

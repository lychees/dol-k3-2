# Uncharted Waters 联机后端 · 设计文档

> 技术原型（prototype）：玩家账号 + 游戏数据持久化 + WebSocket 包规范。
> 设计第一原则：**可扩展性（extensibility）**——新游戏功能、新数据字段的
> 加入不应改动任何既有代码，只允许"新增文件 / 新增注册项"。

## 1. 总览

```
客户端 (浏览器)                      服务器 (Python asyncio)
─────────────                      ─────────────────────────
JSON over WebSocket  ──────────►  net.server (GameServer)
                                     │  codec 解码 → registry 路由
                                     ▼
                                  handlers/* (插件式处理器)
                                     │  调用
                                     ▼
                                  services/* (业务逻辑)
                                     │  依赖注入解析接口
                                     ▼
                                  repositories/* (仓储接口)
                                     │
                                     ▼
                                  db/* (SQLite / 可换 MySQL)
```

技术选型：Python 3.11 + `websockets` + SQLite（stdlib）。
依赖注入 + 接口（`typing.Protocol`）隔离每一层，具体实现只在入口装配处选定。

## 2. 目录结构

```
server/
  main.py                  # 入口：装配 DI 容器（唯一选择具体实现的地方）
  requirements.txt
  app/
    config.py              # 环境变量配置（host/port/db 路径/pbkdf2 迭代数）
    container.py           # DI 容器（singleton / factory / instance）
    db/
      base.py              # Database 协议（接口）
      sqlite_db.py         # SQLite 实现
      schema.sql           # 建表语句
    models/
      account.py           # Account / PlayerData（含 DATA_VERSION 与初始存档）
    repositories/
      base.py              # AccountRepository / PlayerDataRepository 协议
      account_repo.py      # 账号 + 会话令牌 SQL
      player_repo.py       # 玩家数据（版本化 JSON + 迁移表）
    services/
      auth_service.py      # 注册/登录（pbkdf2 加盐哈希）
      player_service.py    # 玩家数据读写
    net/
      packet.py            # 数据包结构（v/type/seq/token/payload）
      codec.py             # 编解码接口 + JSON 实现
      registry.py          # 处理器注册表（扩展点）
      session.py           # 连接会话状态
      server.py            # asyncio WebSocket 服务
    handlers/
      __init__.py          # 插件发现（自动注册所有模块）
      auth.py              # auth.register / auth.login / auth.whoami
      player.py            # player.load / player.save
      misc.py              # server.ping / server.types（扩展示例）
  tests/
    test_api.py            # 集成测试（17 项，含插件模式验证）
```

## 3. 依赖注入设计

`app/container.py` 提供一个 40 行的容器，三种注册方式：

| 方法 | 语义 | 用途 |
|---|---|---|
| `instance(key, obj)` | 已有对象登记为单例 | codec 等无状态组件 |
| `singleton(key, factory)` | 惰性单例（首次解析时构造） | Database / Repo / Service / Registry |
| `factory(key, factory)` | 每次解析新建 | 需要 per-call 生命周期的对象 |

**接口即 key**：消费者只依赖 `app/db/base.py`、`app/repositories/base.py`
里的 `Protocol`，例如：

```python
class PlayerService:
    def __init__(self, players: PlayerDataRepository) -> None: ...
```

容器装配（`main.py: build_container`）是唯一知道"用 SQLite 还是 MySQL"的地方：

```python
c.singleton(Database, lambda c: SqliteDatabase(db_path))
# 换成 MySQL 时只需: c.singleton(Database, lambda c: MysqlDatabase(dsn))
```

## 4. 数据包规范（packet-spec v1）

### 4.1 传输

一个 WebSocket 文本帧 = 一个 JSON 数据包。编解码由 `PacketCodec` 接口抽象
（当前 `JsonCodec`；将来要上 msgpack/protobuf 时新增 codec 并在容器替换即可）。

### 4.2 请求包

```json
{
  "v": 1,
  "type": "player.save",
  "seq": 12,
  "token": "8f3c...",
  "payload": { "data": { "gold": 54321 } }
}
```

| 字段 | 说明 |
|---|---|
| `v` | 协议版本。高于服务端 `PACKET_VERSION` 的包被拒绝 |
| `type` | 点分格式 `<域>.<动作>`，如 `auth.login`、`player.save` |
| `seq` | 客户端序号，响应原样回显（用于请求-响应匹配） |
| `token` | 会话令牌。除 `auth.*` 与 `server.*` 外所有包必需 |
| `payload` | 各类型自定义对象 |

### 4.3 响应包

- 成功：`type` = 请求类型 + `.ok`，`seq` 回显
- 失败：`type` = `"error"`，`payload = {"code": ..., "message": ...}`

内置错误码：`bad_packet`（帧无法解码）、`unknown_type`、
`unauthorized`、`internal`（处理器异常，已记录日志）。
业务错误码由处理器返回（如 `username_taken`、`bad_credentials`）。

### 4.4 当前包类型

| 类型 | 鉴权 | 说明 |
|---|---|---|
| `server.ping` | 否 | 探活，返回协议版本 |
| `server.types` | 否 | 列出全部已注册包类型（客户端可自发现） |
| `auth.register` | 否 | `{username, password}` → `{account_id, username}` |
| `auth.login` | 否 | `{username, password}` → `{token}` |
| `auth.whoami` | 是 | → `{account_id, username}` |
| `player.load` | 是 | → `{data}`（完整游戏存档） |
| `player.save` | 是 | `{data}` → `{saved: true}` |

### 4.5 扩展新包类型（新游戏功能的标准做法）

在 `app/handlers/` 新增一个文件即可，**不需要改动任何既有代码**：

```python
# app/handlers/fishing.py
from ..net.packet import Packet

def register(registry, container) -> None:
    async def fishing_cast(ctx):
        # ctx.packet / ctx.session.account_id / ctx.container 可用
        return Packet.ok(ctx.packet, {"fish": "tuna"})
    registry.add("fishing.cast", fishing_cast, auth=True)
```

`app/handlers/__init__.py` 的 `discover_registrars()` 会自动发现并注册它。

## 5. 数据存储规范（storage-spec）

原则：**账号强关系化，游戏数据文档化**。

### 5.1 关系表（schema.sql）

```sql
account(id, username UNIQUE, password_hash, salt, created_at)
player_data(account_id PK, version, data(JSON TEXT), updated_at)
session_token(token PK, account_id, created_at)
```

- 密码：`pbkdf2_hmac(sha256, 60_000 次)` + 16 字节随机盐，常量时间比较
- 令牌：登录签发 32 位十六进制随机串，存表；受保护包凭 `token` 解析会话

### 5.2 玩家数据文档（player_data.data）

游戏状态（舰队、货物、财富、船员、航海士、装备、英雄、发现物、港口、
任务、角色…）整体作为一个 **JSON 文档**存储，键即存档版本
`DATA_VERSION`：

```json
{
  "gold": 54321, "fame": 12,
  "fleet": [{"ship": "Balsa", "hull": 60}, {"ship": "Galleon", "hull": 160}],
  "cargo": {"Wine": 10}, "cargoCost": {"Wine": 360},
  "crew": 30, "mates": [1, 2], "shipCabins": {"1": "0:1"},
  "equipment": {"sails": 1, "cannons": 0, "armor": true},
  "hero": {"lv": 3, "exp": 8, "hp": 40, "weapon": 2, "armor": 1, "balms": 3},
  "discoveries": [48, 99], "portsFound": [1, 2, 3], "character": 1
}
```

### 5.3 字段扩展与迁移

- **新增字段**：直接写入文档即可——不需要 SQL 迁移，新旧版本兼容
  （老存档缺字段时由消费方给默认值，与前端 `P` 的合并策略一致）。
- **不兼容变更**：递增 `DATA_VERSION`，并在
  `repositories/player_repo.py` 的 `MIGRATIONS` 表登记
  `{旧版本: fn(data) -> data}`；加载时按版本链式升级到最新。

这样"数据存储规范"的扩展成本与"数据包规范"一致：只增不改。

## 6. 服务器进程的可扩展性

| 扩展维度 | 机制 | 改动成本 |
|---|---|---|
| 新游戏功能（包类型） | `handlers/` 放新模块，插件自动注册 | 1 个新文件 |
| 新数据字段 | JSON 文档自由扩展；不兼容时加迁移函数 | 0~1 处 |
| 换数据库 | 实现 `Database` 协议，容器换注册 | 1 行 |
| 换传输格式 | 实现 `PacketCodec`，容器换注册 | 1 行 |
| 新服务（业务逻辑） | `services/` 新增并注册；处理器经容器解析 | 2 个新文件 |
| 协议版本 | `v` 字段 + 版本拒绝；可并行注册 `v2` codec | 平滑 |

## 7. 安全说明

- 密码绝不落明文（pbkdf2 加盐，恒定时间比较防时序攻击）
- 令牌随机 128 bit，存库可吊销（删除 session_token 行即下线）
- 处理器异常不外泄堆栈（返回 `internal` + 服务端日志）
- 玩家数据写入仅允许 JSON 对象（`bad_data`），按会话 account_id 隔离

## 8. 运行与测试

```bash
cd server
pip install -r requirements.txt
python main.py                 # ws://127.0.0.1:8790
python tests/test_api.py       # 17 项集成测试
```

环境变量：`UW_HOST` / `UW_PORT` / `UW_DB_PATH` / `UW_PBKDF2_ITER`。

## 9. 后续路线（不在本次原型范围）

- 前端接入（`player.load/save` 与现有 localStorage 存档结构完全同构，
  可直接映射 `P`）
- 世界共享状态（海域玩家列表、位置广播 —— 新 handler + 订阅机制）
- 房间化海战实例
- 速率限制与反作弊（服务端校验关键数值变化）

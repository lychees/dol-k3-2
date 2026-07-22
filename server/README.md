# Uncharted Waters 联机后端（技术原型）

玩家账号 + 游戏数据持久化 + WebSocket 数据包服务。
设计文档见 [DESIGN.md](DESIGN.md)。

## 快速开始

```bash
cd server
pip install -r requirements.txt
python main.py            # 监听 ws://127.0.0.1:8790
```

## 测试

```bash
python tests/test_api.py  # 17 项集成测试（注册/登录/存取/错误/插件扩展）
```

## 特性

- 依赖注入容器：实现可替换（SQLite→MySQL、JSON→二进制编解码）一行切换
- 数据包规范 v1：版本号、点分类型、seq 回显、令牌鉴权、统一错误码
- 处理器插件模式：`app/handlers/` 新增文件即自动注册，零改动扩展功能
- 账号强关系化（加盐 pbkdf2 哈希），游戏数据版本化 JSON 文档 + 迁移表

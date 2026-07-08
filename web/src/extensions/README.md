# Web 扩展体系

Layer 4 动态模块与 IDE 贡献点的代码入口。

| 目录 | 职责 |
|------|------|
| `types/` | manifest、module、contribution 类型 |
| `registry/` | 内置 + 动态模块注册、路由生成 |
| `api/` | `niuma.*` 扩展 API 门面（受控） |
| `contributions/` | commands / views 运行时（P3） |

文档：[docs/10-web-extension-system.md](../../docs/10-web-extension-system.md)

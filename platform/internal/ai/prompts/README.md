# AI 提示词（platform/internal/ai/prompts）

本目录文本经 `go:embed` 打进 platform-core，改完需重新编译生效。

| 文件 | 用途 |
|------|------|
| `system_default.txt` | **通用** system：如何用 Context、如何答、面板渲染格式 |
| `skill_section.txt` | Skill 注入段落（`%s` = skill 模板） |
| `user_attach_only.txt` | 仅附件、无用户正文时的兜底 user 句 |
| `attached_file.txt` | 文本附件展开块（`%s` = 文件名、正文） |
| `dialect_vastbase.txt` | **回退**：无 capabilities 时的 Vastbase 默认规则；优先由前端传入 capability 生成的 `dialectRules` |

## 分层（勿把模块手册写进 system_default）

| 层 | 放什么 | 不放什么 |
|----|--------|----------|
| `system_default` | 人设、Context Pack 用法、克制臆造 UI、输出格式 | 某模块菜单/按钮/专用流程（Vastbase Debug、SSH…） |
| Context Pack | 当前 workspace / 选区 / 诊断等**事实**；按 module 注入短方言硬规则 | 长篇产品说明书 |
| Skill（`nm_ai_skill`） | 用户显式选用的场景剧本 | 默认全局绑定 |
| MCP Tools | 可调用能力 | 编译进 platform 的业务逻辑 |

运维 Skill（慢查询 / Explain / 连接 / Vastbase SQL）在 SQLite `nm_ai_skill`，不在此目录。新模块场景优先加 Skill 或加厚 Context，而不是改通用 system。

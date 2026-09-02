// Package ai 是 AI 助手组合根（Handler 只依赖本包）。
//
// 实现按目录拆分，对齐 Cursor / Claude Code / Luma：
//
//	loop/   Agent Loop、装配、上下文、模型流、系统 Provider
//	host/   官方一手工具（sql_* / ssh_* → 已有 Bridge）
//	mcp/    扩展 MCP 登记与 stdio/HTTP 调用
//	skill/  Skill 模板与包
//	tool/   Policy Gate 与风险分级
//
// Bridge 入口仍在 handler（platform.ai.*）。设计见 docs/24-ai-assistant.md。
package ai

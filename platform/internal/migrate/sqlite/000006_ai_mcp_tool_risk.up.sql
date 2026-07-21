-- 000006_ai_mcp_tool_risk.up.sql
-- MCP 工具风险等级（Policy Gate；桌面端不做审计流水）

ALTER TABLE nm_mcp_tool ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'read';
-- read | write | dangerous

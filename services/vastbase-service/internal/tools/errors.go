package tools

import "strings"

// rewriteToolFailure 将原生工具 stderr 整理为可读失败信息。
// PG 15+ pg_dump 会查询 acldefault('l', lanowner)；Vastbase / openGauss 的
// acldefault 在过程语言上常触发「language with OID 0 does not exist」。
func rewriteToolFailure(stderr string) string {
	msg := pickToolErrorLine(stderr)
	if msg == "" {
		return ""
	}
	lower := strings.ToLower(msg)
	full := strings.ToLower(stderr)
	if (strings.Contains(full, "acldefault") || strings.Contains(lower, "acldefault")) &&
		(strings.Contains(full, "language with oid 0") || strings.Contains(lower, "language with oid 0")) {
		return "社区 pg_dump 与当前 Vastbase 不兼容（acldefault / language OID 0）。" +
			"请在设置 → 工具组件中配置 Vastbase 官方 vb_dump，或改用库节点「导出 SQL」。"
	}
	return msg
}

// pickToolErrorLine 从多行 stderr 中挑出最有信息量的一行。
func pickToolErrorLine(stderr string) string {
	lines := strings.Split(stderr, "\n")
	var lastNonEmpty, preferred string
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		lastNonEmpty = line
		lower := strings.ToLower(line)
		if strings.Contains(lower, "error:") || strings.Contains(lower, "fatal:") {
			preferred = line
		}
	}
	if preferred != "" {
		return preferred
	}
	return lastNonEmpty
}

package tools

import (
	"strings"
	"unicode/utf8"
)

const (
	// maxToolProgressMsgRunes 进度消息最大字符数，避免把整条 INSERT 塞进事件总线。
	maxToolProgressMsgRunes = 240
	// maxToolStderrRetain 仅保留尾部 stderr，供失败时提取错误行。
	maxToolStderrRetain = 64 * 1024
	// maxToolScanLine 单行扫描上限；超长行丢弃进度（多为巨型 SQL）。
	maxToolScanLine = 64 * 1024
)

func truncateRunes(s string, max int) string {
	if max <= 0 || s == "" {
		return s
	}
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	var b strings.Builder
	b.Grow(max * 3)
	n := 0
	for _, r := range s {
		if n >= max {
			break
		}
		b.WriteRune(r)
		n++
	}
	return b.String() + "…"
}

func appendCappedLine(buf *strings.Builder, line string, maxBytes int) {
	if buf == nil || maxBytes <= 0 {
		return
	}
	if buf.Len() > 0 {
		buf.WriteByte('\n')
	}
	buf.WriteString(line)
	if buf.Len() <= maxBytes {
		return
	}
	s := buf.String()
	s = s[len(s)-maxBytes:]
	if i := strings.IndexByte(s, '\n'); i >= 0 && i+1 < len(s) {
		s = s[i+1:]
	}
	buf.Reset()
	buf.WriteString(s)
}

// shouldEmitToolProgress 过滤 mysql --verbose 刷出的整句 SQL，只保留有用进度/错误。
func shouldEmitToolProgress(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return false
	}
	// 分隔线 / DDL 碎片（`col` varchar...）不进任务日志
	if isSQLNoiseLine(trimmed) {
		return false
	}
	if strings.HasPrefix(trimmed, "--") {
		return true
	}
	lower := strings.ToLower(trimmed)
	if strings.Contains(lower, "error") ||
		strings.Contains(lower, "warning") ||
		strings.Contains(lower, "failed") {
		return true
	}
	if looksLikeSQLStatement(lower) {
		return false
	}
	// 短状态行可放行
	return utf8.RuneCountInString(trimmed) <= maxToolProgressMsgRunes
}

func isSQLNoiseLine(trimmed string) bool {
	if strings.Trim(trimmed, "-=") == "" {
		return true
	}
	// CREATE TABLE 列定义碎片：`name` type ...
	if strings.HasPrefix(trimmed, "`") || strings.HasPrefix(trimmed, "'") {
		return true
	}
	upper := strings.ToUpper(trimmed)
	if strings.HasPrefix(upper, "PRIMARY KEY") ||
		strings.HasPrefix(upper, "UNIQUE KEY") ||
		strings.HasPrefix(upper, "KEY ") ||
		strings.HasPrefix(upper, "CONSTRAINT ") ||
		strings.HasPrefix(upper, "ENGINE=") ||
		strings.HasPrefix(upper, ") ENGINE") {
		return true
	}
	lower := strings.ToLower(trimmed)
	if strings.Contains(lower, " collate ") ||
		strings.Contains(lower, " character set ") ||
		strings.HasSuffix(trimmed, ",") && (strings.Contains(lower, "varchar") ||
			strings.Contains(lower, "char(") ||
			strings.Contains(lower, "int(") ||
			strings.Contains(lower, "datetime") ||
			strings.Contains(lower, "decimal")) {
		return true
	}
	return false
}

func looksLikeSQLStatement(lower string) bool {
	prefixes := []string{
		"insert ", "update ", "delete ", "replace ",
		"create ", "drop ", "alter ", "truncate ",
		"lock ", "unlock ", "set ", "use ",
		"delimiter ", "/*!", "/*",
	}
	for _, p := range prefixes {
		if strings.HasPrefix(lower, p) {
			return true
		}
	}
	return false
}

func formatToolProgressMessage(line string) string {
	return truncateRunes(strings.TrimSpace(line), maxToolProgressMsgRunes)
}

package mysqlparser

import (
	"regexp"
	"strings"
)

var delimiterDirectiveRe = regexp.MustCompile(`(?i)^(\s*)DELIMITER\s+(\S+)\s*$`)

// preprocessDelimiter 将客户端 DELIMITER 指令改为注释，并把自定义结束符换成 `;`。
// 保持行数，便于诊断行列仍大致对准原文。
func preprocessDelimiter(code string) string {
	if code == "" || !regexp.MustCompile(`(?im)^\s*DELIMITER\b`).MatchString(code) {
		return code
	}
	newline := "\n"
	if strings.Contains(code, "\r\n") {
		newline = "\r\n"
	}
	lines := strings.Split(code, "\n")
	// 去掉可能残留的 \r
	for i := range lines {
		lines[i] = strings.TrimSuffix(lines[i], "\r")
	}
	delimiter := ";"
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		if m := delimiterDirectiveRe.FindStringSubmatch(line); len(m) == 3 {
			delimiter = m[2]
			out = append(out, m[1]+"-- DELIMITER "+delimiter)
			continue
		}
		if delimiter != ";" {
			trimRight := strings.TrimRight(line, " \t")
			if strings.HasSuffix(trimRight, delimiter) {
				head := strings.TrimSuffix(trimRight, delimiter)
				head = strings.TrimRight(head, " \t")
				if head == "" {
					out = append(out, ";")
				} else {
					out = append(out, head+";")
				}
				continue
			}
		}
		out = append(out, line)
	}
	return strings.Join(out, newline)
}

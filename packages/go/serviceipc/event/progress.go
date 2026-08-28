package event

import "strings"

// IsProgressType 判断事件是否为可合并、可丢的进度类（type 以 .progress 结尾）。
// state / done / session.state 等不在此列，仍须可靠投递。
func IsProgressType(typ string) bool {
	return strings.HasSuffix(strings.TrimSpace(typ), ".progress")
}

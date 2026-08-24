package session

import (
	"fmt"
	"strings"
)

// FormatConnectError 将驱动/网络错误整理为可展示、不含密码的短文案。
func FormatConnectError(err error) string {
	if err == nil {
		return ""
	}
	msg := strings.TrimSpace(err.Error())
	if msg == "" {
		return "sqlserver: connect failed"
	}
	lower := strings.ToLower(msg)

	switch {
	case strings.Contains(lower, "login failed") || strings.Contains(lower, "18456"):
		return prefixConnect("login failed", msg)
	case strings.Contains(lower, "certificate") ||
		strings.Contains(lower, "tls:") ||
		strings.Contains(lower, "x509") ||
		strings.Contains(lower, "encrypt"):
		return prefixConnect("certificate/encrypt error", msg)
	case strings.Contains(lower, "timeout") ||
		strings.Contains(lower, "deadline exceeded") ||
		strings.Contains(lower, "i/o timeout"):
		return prefixConnect("connect timeout", msg)
	case strings.Contains(lower, "connection refused") ||
		strings.Contains(lower, "actively refused") ||
		strings.Contains(lower, "no such host") ||
		strings.Contains(lower, "network is unreachable"):
		return prefixConnect("host unreachable", msg)
	case strings.Contains(lower, "instance") ||
		strings.Contains(lower, "browser") ||
		strings.Contains(lower, "udp"):
		return prefixConnect("named instance/browser error", msg)
	case strings.Contains(lower, "ssh tunnel") || strings.HasPrefix(lower, "sqlserver: ssh tunnel"):
		return prefixConnect("ssh tunnel", msg)
	default:
		if strings.HasPrefix(lower, "sqlserver:") {
			return msg
		}
		return prefixConnect("connect failed", msg)
	}
}

func prefixConnect(kind, detail string) string {
	detail = strings.TrimSpace(detail)
	if strings.HasPrefix(strings.ToLower(detail), "sqlserver:") {
		return detail
	}
	return fmt.Sprintf("sqlserver: %s: %s", kind, detail)
}

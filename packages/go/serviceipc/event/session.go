package event

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"strings"
)

// SessionLost 构造能力会话意外断开事件（sessionId 为具体值，不是 *）。
func SessionLost(namespace, sessionID, message string) map[string]any {
	ns := strings.TrimSpace(namespace)
	return map[string]any{
		"type":      ns + ".session.state",
		"sessionId": strings.TrimSpace(sessionID),
		"state":     "lost",
		"message":   message,
	}
}

// IsConnLost 判断是否为传输层断开（非 SQL 语法错误、非 session busy）。
// 仅用于通知 UI 会话失效，不改变原错误仍返回给调用方。
func IsConnLost(err error) bool {
	if err == nil {
		return false
	}
	m := strings.ToLower(err.Error())
	if m == "" {
		return false
	}
	if strings.Contains(m, "session busy") ||
		strings.Contains(m, "context canceled") ||
		strings.Contains(m, "cancelled") {
		return false
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, net.ErrClosed) {
		return true
	}
	switch {
	case strings.Contains(m, "broken pipe"),
		strings.Contains(m, "connection reset"),
		strings.Contains(m, "connection refused"),
		strings.Contains(m, "wsasend"),
		strings.Contains(m, "wsarecv"),
		strings.Contains(m, "forcibly closed"),
		strings.Contains(m, "use of closed network"),
		strings.Contains(m, "invalid connection"),
		strings.Contains(m, "driver: bad connection"),
		strings.Contains(m, "unexpected eof"),
		strings.Contains(m, "connection lost"),
		strings.Contains(m, "disconnect"):
		return true
	default:
		return false
	}
}

// SessionIDFromParams 从请求 params 取出 sessionId；解析失败返回空串。
func SessionIDFromParams(params json.RawMessage) string {
	if len(params) == 0 {
		return ""
	}
	var p struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return ""
	}
	return strings.TrimSpace(p.SessionID)
}

// NoteLost 在传输层断开时关闭本机会话并广播 lost。closeSession 返回错误（如已关闭）则不再发事件。
func NoteLost(emit func(map[string]any), namespace, sessionID string, fail error, closeSession func(string) error) {
	if fail == nil || sessionID == "" || !IsConnLost(fail) {
		return
	}
	if closeSession != nil {
		if err := closeSession(sessionID); err != nil {
			return
		}
	}
	if emit != nil {
		emit(SessionLost(namespace, sessionID, fail.Error()))
	}
}

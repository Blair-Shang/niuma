package supervisor

import "strings"

// EventSink 把进程生命周期事件扇出给 Shell（由 eventhub.Publish 实现）。
type EventSink func(event map[string]any)

const (
	serviceStateLost = "lost"
	sessionIDAll     = "*"
)

// lostEvents 构造能力进程退出后的 UI 通知。
// sessionId 为 * 表示该命名空间下全部物理会话失效（进程已没，不必逐个 close）。
func lostEvents(serviceID, namespace, message string) []map[string]any {
	ns := strings.TrimSpace(namespace)
	out := []map[string]any{
		{
			"type":      "platform.service.state",
			"serviceId": serviceID,
			"namespace": ns,
			"state":     serviceStateLost,
			"message":   message,
		},
	}
	if ns != "" {
		out = append(out, map[string]any{
			"type":      ns + ".session.state",
			"sessionId": sessionIDAll,
			"state":     serviceStateLost,
			"message":   message,
		})
	}
	return out
}

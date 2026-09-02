package socket

import (
	"time"

	"niuma/services/api-service/internal/codec"
)

const (
	// EventData 是一条收发报文（含 hex 视图）。
	EventData = "api.socket.data"
	// EventState 是会话或对端状态变化。
	EventState = "api.session.state"
)

func dataEvent(sessionID, peerID, remote, local string, dir Direction, raw []byte, pref codec.Encoding) map[string]any {
	view := codec.Inspect(raw, pref)
	ev := map[string]any{
		"type":       EventData,
		"sessionId":  sessionID,
		"direction":  string(dir),
		"remoteAddr": remote,
		"localAddr":  local,
		"encoding":   string(view.Encoding),
		"data":       view.Data,
		"hex":        view.Hex,
		"bytes":      view.Bytes,
		"at":         time.Now().UTC().Format(time.RFC3339Nano),
	}
	if peerID != "" {
		ev["peerId"] = peerID
	}
	return ev
}

func stateEvent(sessionID string, state State, peerID, remote, message string) map[string]any {
	ev := map[string]any{
		"type":      EventState,
		"sessionId": sessionID,
		"state":     string(state),
	}
	if peerID != "" {
		ev["peerId"] = peerID
	}
	if remote != "" {
		ev["remoteAddr"] = remote
	}
	if message != "" {
		ev["message"] = message
	}
	return ev
}

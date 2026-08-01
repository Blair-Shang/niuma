package handler

import (
	"encoding/json"
	"strings"

	"niuma/services/sqlite-service/internal/session"
)

// applyHostAddressFallback：platform 注入的内联参数用 hostAddress 承载文件路径，
// 在 filePath / options.filePath 均空时回填，避免 session.open/test 报 filePath required。
func applyHostAddressFallback(raw json.RawMessage, params *session.ConnectParams) {
	if params == nil || params.ResolvedFilePath() != "" {
		return
	}
	var bridge struct {
		HostAddress string `json:"hostAddress"`
	}
	if json.Unmarshal(raw, &bridge) != nil {
		return
	}
	if hp := strings.TrimSpace(bridge.HostAddress); hp != "" {
		params.FilePath = hp
	}
}

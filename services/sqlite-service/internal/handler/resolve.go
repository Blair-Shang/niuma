package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/sqlite-service/internal/session"
)

// resolveDB 从 sessionId 或 platform 注入的 ConnectParams 解析 *sql.DB。
// 短连路径（无 sessionId）用于树 / meta / catalog 的 profileId 旁路调用；调用方必须 defer release()。
func (d *Dispatcher) resolveDB(ctx context.Context, raw json.RawMessage) (*sql.DB, *session.Session, func(), error) {
	var withSession sessionIDParams
	if err := json.Unmarshal(raw, &withSession); err == nil && strings.TrimSpace(withSession.SessionID) != "" {
		s, err := d.sessions.Get(withSession.SessionID)
		if err != nil {
			return nil, nil, nil, err
		}
		return s.DB, s, func() {}, nil
	}

	var params session.ConnectParams
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, nil, nil, fmt.Errorf(errInvalidParamsFmt, err)
	}
	applyHostAddressFallback(raw, &params)
	if params.ResolvedFilePath() == "" {
		return nil, nil, nil, fmt.Errorf("sessionId or filePath required")
	}
	db, err := session.Connect(ctx, params)
	if err != nil {
		return nil, nil, nil, err
	}
	return db, nil, func() { _ = db.Close() }, nil
}

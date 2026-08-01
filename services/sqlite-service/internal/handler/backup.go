package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/sqlite-service/internal/backup"
	"niuma/services/sqlite-service/internal/session"
)

type backupCopyParams struct {
	SessionID  string `json:"sessionId"`
	ProfileID  string `json:"profileId"`
	OutputPath string `json:"outputPath"`
	DestPath   string `json:"destPath"`
}

func (d *Dispatcher) backupCopy(ctx context.Context, req Request) Response {
	var params backupCopyParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	out := strings.TrimSpace(params.OutputPath)
	if out == "" {
		out = strings.TrimSpace(params.DestPath)
	}
	if out == "" {
		return errorResponse(req.ID, "outputPath required")
	}

	connect, sessionID, err := d.resolveTaskConnect(req.Params, params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	var pages int64
	emit := func(p int64, msg string) {
		pages = p
		if d.events != nil {
			d.events.Emit(map[string]any{
				"type":    "sqlite.backup.progress",
				"session": sessionID,
				"pages":   p,
				"message": msg,
			})
		}
	}

	if sessionID != "" {
		sess, gerr := d.sessions.Get(sessionID)
		if gerr != nil {
			return errorResponse(req.ID, gerr.Error())
		}
		if err := backup.CopyFile(ctx, sess.DB, out, emit); err != nil {
			logOpWarn(MethodBackupCopy, err, "session", sessionID)
			return errorResponse(req.ID, err.Error())
		}
	} else {
		db, oerr := session.Connect(ctx, connect)
		if oerr != nil {
			return errorResponse(req.ID, oerr.Error())
		}
		defer db.Close()
		if err := backup.CopyFile(ctx, db, out, emit); err != nil {
			logOpWarn(MethodBackupCopy, err, "file", connect.ResolvedFilePath())
			return errorResponse(req.ID, err.Error())
		}
	}

	if d.events != nil {
		d.events.Emit(map[string]any{
			"type":       "sqlite.backup.done",
			"session":    sessionID,
			"ok":         true,
			"outputPath": out,
			"pages":      pages,
			"message":    "completed",
		})
	}
	logOpInfo(MethodBackupCopy, "session", sessionID, "output", out)
	return okResponse(req.ID, map[string]any{"ok": true, "outputPath": out})
}

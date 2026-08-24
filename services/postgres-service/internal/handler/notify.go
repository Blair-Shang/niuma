package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/services/postgres-service/internal/session"
)

type notifyChannelParams struct {
	SessionID string `json:"sessionId"`
	Channel   string `json:"channel"`
}

func (d *Dispatcher) notifyHub(sess *session.Session) *session.NotifyHub {
	if sess.Notify == nil {
		sess.Notify = session.NewNotifyHub(sess.ID, sess.Pool, func(ev map[string]any) {
			if d.events != nil {
				d.events.Emit(ev)
			}
		})
	}
	return sess.Notify
}

func (d *Dispatcher) notifyListen(ctx context.Context, req Request) Response {
	var params notifyChannelParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	sess, err := d.sessions.Get(params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if err := d.notifyHub(sess).Listen(ctx, params.Channel); err != nil {
		logOpWarn(MethodNotifyListen, err, "session", params.SessionID, "channel", params.Channel)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodNotifyListen, "session", params.SessionID, "channel", params.Channel)
	return okResponse(req.ID, map[string]any{
		"ok":       true,
		"channel":  params.Channel,
		"channels": sess.Notify.Channels(),
	})
}

func (d *Dispatcher) notifyUnlisten(ctx context.Context, req Request) Response {
	var params notifyChannelParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	sess, err := d.sessions.Get(params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if sess.Notify == nil {
		return okResponse(req.ID, map[string]any{"ok": true, "channels": []string{}})
	}
	if err := sess.Notify.Unlisten(ctx, params.Channel); err != nil {
		logOpWarn(MethodNotifyUnlisten, err, "session", params.SessionID, "channel", params.Channel)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodNotifyUnlisten, "session", params.SessionID, "channel", params.Channel)
	return okResponse(req.ID, map[string]any{
		"ok":       true,
		"channel":  params.Channel,
		"channels": sess.Notify.Channels(),
	})
}

func (d *Dispatcher) notifyChannels(ctx context.Context, req Request) Response {
	_ = ctx
	var params notifyChannelParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	sess, err := d.sessions.Get(params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	channels := []string{}
	if sess.Notify != nil {
		channels = sess.Notify.Channels()
	}
	return okResponse(req.ID, map[string]any{"channels": channels})
}

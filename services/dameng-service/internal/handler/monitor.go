package handler

import (
	"context"
	"fmt"

	"niuma/services/dameng-service/internal/meta"
)

func (d *Dispatcher) processlist(ctx context.Context, r Request) Response {
	var p listP
	db, _, release, e := d.resolveDB(ctx, r.Params, &p)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	if p.SessionID == "" {
		return fail(r.ID, "sessionId required")
	}
	v, e := meta.ListProcesslist(ctx, db)
	if e != nil {
		logOpWarn("meta.processlist", e, "session", p.SessionID)
		return fail(r.ID, e)
	}
	logOpInfo("meta.processlist", "session", p.SessionID, "count", len(v.Processes))
	return ok(r.ID, v)
}

func (d *Dispatcher) kill(ctx context.Context, r Request) Response {
	var p struct {
		SessionID string `json:"sessionId"`
		ID        int64  `json:"id"`
		QueryOnly bool   `json:"queryOnly"`
	}
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	if p.SessionID == "" {
		return fail(r.ID, "sessionId required")
	}
	if p.ID <= 0 {
		return fail(r.ID, "id required")
	}
	s, e := d.get(p.SessionID)
	if e != nil {
		return fail(r.ID, e)
	}
	if e := meta.KillProcess(ctx, s.DB, p.ID, p.QueryOnly); e != nil {
		logOpWarn("meta.kill", e, "session", p.SessionID, "id", p.ID, "queryOnly", p.QueryOnly)
		return fail(r.ID, e)
	}
	logOpInfo("meta.kill", "session", p.SessionID, "id", p.ID)
	return ok(r.ID, map[string]any{"killed": true, "id": p.ID, "queryOnly": false})
}

func (d *Dispatcher) instanceOverview(ctx context.Context, r Request) Response {
	var p listP
	db, _, release, e := d.resolveDB(ctx, r.Params, &p)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	if p.SessionID == "" {
		return fail(r.ID, "sessionId required")
	}
	v, e := meta.InstanceOverview(ctx, db)
	if e != nil {
		logOpWarn("meta.instanceOverview", e, "session", p.SessionID)
		return fail(r.ID, e)
	}
	logOpInfo("meta.instanceOverview", "session", p.SessionID)
	return ok(r.ID, v)
}

func (d *Dispatcher) locks(ctx context.Context, r Request) Response {
	var p listP
	db, _, release, e := d.resolveDB(ctx, r.Params, &p)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	if p.SessionID == "" {
		return fail(r.ID, "sessionId required")
	}
	v, e := meta.ListLocks(ctx, db)
	if e != nil {
		logOpWarn("meta.locks", e, "session", p.SessionID)
		return fail(r.ID, e)
	}
	if v.Unavailable {
		logOpWarn("meta.locks", fmt.Errorf("%s", v.Message), "session", p.SessionID, "unavailable", true)
	} else {
		logOpInfo("meta.locks", "session", p.SessionID, "count", len(v.Locks))
	}
	return ok(r.ID, v)
}

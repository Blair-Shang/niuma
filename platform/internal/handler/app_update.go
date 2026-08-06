package handler

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"

	"niuma/platform/internal/appupdate"
)

const (
	MethodAppUpdateDownload = "platform.appUpdate.download"
	MethodAppUpdateVerify   = "platform.appUpdate.verify"
	MethodAppUpdateCancel   = "platform.appUpdate.cancel"
)

type appUpdateDownloadParams struct {
	URL          string `json:"url"`
	SHA256       string `json:"sha256"`
	ExpectedSize int64  `json:"expectedSize"`
}

type appUpdateVerifyParams struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

func (d *Dispatcher) appUpdateDownload(ctx context.Context, req Request) Response {
	if d.appUpdate == nil {
		return errorResponse(req.ID, "app update not available")
	}
	var params appUpdateDownloadParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, "invalid params")
	}
	onProgress := func(received, total int64) {
		if d.events == nil {
			return
		}
		d.events.Publish(map[string]any{
			"type":     appupdate.EventProgressType,
			"received": received,
			"total":    total,
		})
	}
	path, bytes, err := d.appUpdate.Download(ctx, params.URL, params.SHA256, params.ExpectedSize, onProgress)
	if err != nil {
		if errors.Is(err, appupdate.ErrCancelled) {
			return errorResponse(req.ID, "cancelled")
		}
		if errors.Is(err, appupdate.ErrHashMismatch) {
			return errorResponse(req.ID, "hash_mismatch")
		}
		if errors.Is(err, appupdate.ErrHostNotAllowed) {
			return errorResponse(req.ID, "host_not_allowed")
		}
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"path": path, "bytes": bytes})
}

func (d *Dispatcher) appUpdateVerify(ctx context.Context, req Request) Response {
	_ = ctx
	if d.appUpdate == nil {
		return errorResponse(req.ID, "app update not available")
	}
	var params appUpdateVerifyParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, "invalid params")
	}
	if err := d.appUpdate.Verify(params.Path, params.SHA256); err != nil {
		if errors.Is(err, appupdate.ErrHashMismatch) {
			return errorResponse(req.ID, "hash_mismatch")
		}
		if errors.Is(err, os.ErrNotExist) || strings.Contains(err.Error(), "no such file") {
			return errorResponse(req.ID, "file_missing")
		}
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"ok": true})
}

func (d *Dispatcher) appUpdateCancel(ctx context.Context, req Request) Response {
	_ = ctx
	if d.appUpdate == nil {
		return errorResponse(req.ID, "app update not available")
	}
	d.appUpdate.Cancel()
	return okResponse(req.ID, map[string]any{"cancelled": true})
}

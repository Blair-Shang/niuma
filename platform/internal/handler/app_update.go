// 本文件实现本体安装包受限下载（platform.appUpdate.* / shell.update.*）。
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
	// MethodAppUpdateDownload 按白名单主机下载安装包并校验 SHA-256。
	MethodAppUpdateDownload = "platform.appUpdate.download"
	// MethodAppUpdateVerify 校验本机已下载安装包的 SHA-256。
	MethodAppUpdateVerify = "platform.appUpdate.verify"
	// MethodAppUpdateCancel 取消进行中的安装包下载。
	MethodAppUpdateCancel = "platform.appUpdate.cancel"
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

// appUpdateDownload 处理 platform.appUpdate.download：受限下载并回传本地路径。
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

// appUpdateVerify 处理 platform.appUpdate.verify：校验已下载文件哈希。
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

// appUpdateCancel 处理 platform.appUpdate.cancel：中止当前下载。
func (d *Dispatcher) appUpdateCancel(ctx context.Context, req Request) Response {

	_ = ctx
	if d.appUpdate == nil {
		return errorResponse(req.ID, "app update not available")
	}
	d.appUpdate.Cancel()
	return okResponse(req.ID, map[string]any{"cancelled": true})
}

// 本文件实现工具组件包探测与安装（platform.components.*）。
package handler

import (
	"context"
	"encoding/json"

	"niuma/platform/internal/components"
)

type componentsListParams struct {
	BundleID string `json:"bundleId"`
}

type componentsDetectParams struct {
	BundleID string `json:"bundleId"`
}

type componentsSetPathParams struct {
	BundleID string `json:"bundleId"`
	ToolID   string `json:"toolId"`
	Path     string `json:"path"`
}

type componentsGetDownloadParams struct {
	BundleID string `json:"bundleId"`
	ToolID   string `json:"toolId"`
}

type componentsListResult struct {
	Bundles []components.BundleStatusDTO `json:"bundles"`
}

type componentsDetectResult struct {
	Bundle components.BundleStatusDTO `json:"bundle"`
}

type componentsSetPathResult struct {
	Updated bool `json:"updated"`
}

type componentsGetDownloadResult struct {
	URL string `json:"url"`
}

// componentsList 处理 platform.components.list：列出组件包及探测状态。
func (d *Dispatcher) componentsList(ctx context.Context, req Request) Response {
	if d.components == nil {
		return errorResponse(req.ID, "components registry not available")
	}
	var params componentsListParams
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, "invalid params: "+err.Error())
		}
	}
	bundles, err := d.components.List(ctx, params.BundleID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, componentsListResult{Bundles: bundles})
}

// componentsDetect 处理 platform.components.detect：重新探测指定组件包。
func (d *Dispatcher) componentsDetect(ctx context.Context, req Request) Response {
	if d.components == nil {
		return errorResponse(req.ID, "components registry not available")
	}
	var params componentsDetectParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, "invalid params: "+err.Error())
	}
	if params.BundleID == "" {
		return errorResponse(req.ID, "bundleId required")
	}
	bundle, err := d.components.Detect(ctx, params.BundleID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, componentsDetectResult{Bundle: bundle})
}

// componentsSetPath 处理 platform.components.setPath：设置或清除工具可执行路径。
func (d *Dispatcher) componentsSetPath(ctx context.Context, req Request) Response {
	if d.components == nil {
		return errorResponse(req.ID, "components registry not available")
	}
	var params componentsSetPathParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, "invalid params: "+err.Error())
	}
	if params.BundleID == "" || params.ToolID == "" {
		return errorResponse(req.ID, "bundleId and toolId required")
	}
	if err := d.components.SetPath(ctx, params.BundleID, params.ToolID, params.Path); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, componentsSetPathResult{Updated: true})
}

// componentsGetDownload 处理 platform.components.getDownload：返回官方下载页 URL。
func (d *Dispatcher) componentsGetDownload(ctx context.Context, req Request) Response {
	if d.components == nil {
		return errorResponse(req.ID, "components registry not available")
	}
	var params componentsGetDownloadParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, "invalid params: "+err.Error())
	}
	if params.BundleID == "" || params.ToolID == "" {
		return errorResponse(req.ID, "bundleId and toolId required")
	}
	url, err := d.components.GetDownloadURL(params.BundleID, params.ToolID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, componentsGetDownloadResult{URL: url})
}

type componentsInstallParams struct {
	BundleID string `json:"bundleId"`
	// ToolID 可选：指定时仅安装覆盖该工具的包（单独安装 / 重新安装）。
	ToolID string `json:"toolId"`
}

type componentsInstallResult struct {
	Bundle    components.BundleStatusDTO `json:"bundle"`
	Installed bool                       `json:"installed"`
}

// componentsInstall 处理 platform.components.install：下载并安装组件到 data/components。
func (d *Dispatcher) componentsInstall(ctx context.Context, req Request) Response {
	if d.components == nil {
		return errorResponse(req.ID, "components registry not available")
	}
	var params componentsInstallParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, "invalid params: "+err.Error())
	}
	if params.BundleID == "" {
		return errorResponse(req.ID, "bundleId required")
	}
	onProgress := func(p components.InstallProgress) {
		if d.events == nil {
			return
		}
		d.events.Publish(map[string]any{
			"type":          "platform.components.install.progress",
			"bundleId":      p.BundleID,
			"toolId":        p.ToolID,
			"packageId":     p.PackageID,
			"phase":         p.Phase,
			"bytesReceived": p.BytesReceived,
			"bytesTotal":    p.BytesTotal,
			"percent":       p.Percent,
		})
	}
	bundle, err := d.components.Install(ctx, params.BundleID, params.ToolID, onProgress)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, componentsInstallResult{Bundle: bundle, Installed: true})
}

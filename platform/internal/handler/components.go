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
}

type componentsInstallResult struct {
	Bundle    components.BundleStatusDTO `json:"bundle"`
	Installed bool                       `json:"installed"`
}

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
	bundle, err := d.components.Install(ctx, params.BundleID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, componentsInstallResult{Bundle: bundle, Installed: true})
}

package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/platform/internal/ai"
)

// aiSkillList 处理 platform.ai.skill.list。
func (d *Dispatcher) aiSkillList(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		Status string `json:"status"`
	}
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
		}
	}
	list, err := svc.ListSkills(ctx, params.Status)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"skills": list})
}

// aiSkillGet 处理 platform.ai.skill.get。
func (d *Dispatcher) aiSkillGet(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		SkillID string `json:"skillId"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if strings.TrimSpace(params.SkillID) == "" {
		return errorResponse(req.ID, "skillId required")
	}
	v, err := svc.GetSkill(ctx, params.SkillID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"skill": v})
}

// aiSkillUpsert 处理 platform.ai.skill.upsert。
func (d *Dispatcher) aiSkillUpsert(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		SkillID        string `json:"skillId"`
		SkillCode      string `json:"skillCode"`
		SkillName      string `json:"skillName"`
		SkillScope     string `json:"skillScope"`
		PromptTemplate string `json:"promptTemplate"`
		ParamSchema    string `json:"paramSchema"`
		SkillOptions   string `json:"skillOptions"`
		RecordStatus   string `json:"recordStatus"`
		SortOrder      int64  `json:"sortOrder"`
		RowVersion     int64  `json:"rowVersion"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	v, err := svc.UpsertSkill(ctx, ai.SkillUpsertParams{
		SkillID:        params.SkillID,
		SkillCode:      params.SkillCode,
		SkillName:      params.SkillName,
		SkillScope:     params.SkillScope,
		PromptTemplate: params.PromptTemplate,
		ParamSchema:    params.ParamSchema,
		SkillOptions:   params.SkillOptions,
		RecordStatus:   params.RecordStatus,
		SortOrder:      params.SortOrder,
		RowVersion:     params.RowVersion,
	})
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"skill": v})
}

// aiSkillDelete 处理 platform.ai.skill.delete。
func (d *Dispatcher) aiSkillDelete(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		SkillID string `json:"skillId"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	deleted, err := svc.DeleteSkill(ctx, params.SkillID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"deleted": deleted})
}

// aiSkillInstallPack 处理 platform.ai.skill.installPack。
func (d *Dispatcher) aiSkillInstallPack(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		SourcePath string `json:"sourcePath"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	res, err := svc.InstallSkillPack(ctx, ai.SkillPackInstallParams{SourcePath: params.SourcePath})
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, res)
}

// aiSkillExportPack 处理 platform.ai.skill.exportPack。
func (d *Dispatcher) aiSkillExportPack(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		SkillID  string `json:"skillId"`
		DestPath string `json:"destPath"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	path, err := svc.ExportSkillPack(ctx, ai.SkillPackExportParams{
		SkillID:  params.SkillID,
		DestPath: params.DestPath,
	})
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"path": path})
}

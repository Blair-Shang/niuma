package ai

import (
	"context"
	"fmt"
	"strings"

	"niuma/platform/internal/store"
)

// SkillView 是 Bridge 回传的 Skill 视图。
type SkillView struct {
	SkillID        string `json:"skillId"`
	SkillCode      string `json:"skillCode"`
	SkillName      string `json:"skillName"`
	SkillScope     string `json:"skillScope,omitempty"`
	PromptTemplate string `json:"promptTemplate"`
	ParamSchema    string `json:"paramSchema"`
	SkillOptions   string `json:"skillOptions"`
	RecordStatus   string `json:"recordStatus"`
	SortOrder      int64  `json:"sortOrder"`
	RowVersion     int64  `json:"rowVersion"`
	CreatedAt      string `json:"createdAt"`
	UpdatedAt      string `json:"updatedAt"`
}

// SkillUpsertParams 新建或更新 Skill。
type SkillUpsertParams struct {
	SkillID        string
	SkillCode      string
	SkillName      string
	SkillScope     string
	PromptTemplate string
	ParamSchema    string
	SkillOptions   string
	RecordStatus   string
	SortOrder      int64
	RowVersion     int64
}

func toSkillView(sk store.AISkill) SkillView {
	return SkillView{
		SkillID:        sk.SkillID,
		SkillCode:      sk.SkillCode,
		SkillName:      sk.SkillName,
		SkillScope:     sk.SkillScope,
		PromptTemplate: sk.PromptTemplate,
		ParamSchema:    sk.ParamSchema,
		SkillOptions:   sk.SkillOptions,
		RecordStatus:   sk.RecordStatus,
		SortOrder:      sk.SortOrder,
		RowVersion:     sk.RowVersion,
		CreatedAt:      sk.CreatedAt,
		UpdatedAt:      sk.UpdatedAt,
	}
}

// ListSkills 列出 Skill。
func (s *Service) ListSkills(ctx context.Context, status string) ([]SkillView, error) {
	if s == nil || s.Skills == nil {
		return nil, fmt.Errorf("ai: skills unavailable")
	}
	list, err := s.Skills.List(ctx, status)
	if err != nil {
		return nil, err
	}
	out := make([]SkillView, 0, len(list))
	for _, sk := range list {
		out = append(out, toSkillView(sk))
	}
	return out, nil
}

// GetSkill 读取单个 Skill。
func (s *Service) GetSkill(ctx context.Context, skillID string) (*SkillView, error) {
	if s == nil || s.Skills == nil {
		return nil, fmt.Errorf("ai: skills unavailable")
	}
	sk, err := s.Skills.Get(ctx, skillID)
	if err != nil {
		return nil, err
	}
	if sk == nil {
		return nil, nil
	}
	v := toSkillView(*sk)
	return &v, nil
}

// UpsertSkill 新建或更新 Skill。
func (s *Service) UpsertSkill(ctx context.Context, params SkillUpsertParams) (*SkillView, error) {
	if s == nil || s.Skills == nil || s.ids == nil {
		return nil, fmt.Errorf("ai: skills unavailable")
	}
	code := strings.TrimSpace(params.SkillCode)
	name := strings.TrimSpace(params.SkillName)
	template := strings.TrimSpace(params.PromptTemplate)
	if code == "" || name == "" || template == "" {
		return nil, fmt.Errorf("ai: skillCode, skillName and promptTemplate required")
	}
	status := strings.TrimSpace(params.RecordStatus)
	if status == "" {
		status = "active"
	}
	paramSchema := strings.TrimSpace(params.ParamSchema)
	if paramSchema == "" {
		paramSchema = "{}"
	}
	options := strings.TrimSpace(params.SkillOptions)
	if options == "" {
		options = "{}"
	}

	if params.SkillID == "" {
		id, err := s.ids.NextString()
		if err != nil {
			return nil, err
		}
		sk := store.AISkill{
			SkillID:        id,
			SkillCode:      code,
			SkillName:      name,
			SkillScope:     strings.TrimSpace(params.SkillScope),
			PromptTemplate: template,
			ParamSchema:    paramSchema,
			SkillOptions:   options,
			RecordStatus:   status,
			SortOrder:      params.SortOrder,
		}
		if err := s.Skills.Create(ctx, sk); err != nil {
			return nil, err
		}
		created, err := s.Skills.Get(ctx, id)
		if err != nil {
			return nil, err
		}
		if created == nil {
			return nil, fmt.Errorf("ai: skill create failed")
		}
		v := toSkillView(*created)
		return &v, nil
	}

	sk := store.AISkill{
		SkillID:        params.SkillID,
		SkillCode:      code,
		SkillName:      name,
		SkillScope:     strings.TrimSpace(params.SkillScope),
		PromptTemplate: template,
		ParamSchema:    paramSchema,
		SkillOptions:   options,
		RecordStatus:   status,
		SortOrder:      params.SortOrder,
	}
	newVer, ok, err := s.Skills.Update(ctx, sk, params.RowVersion)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("ai: skill conflict or not found")
	}
	updated, err := s.Skills.Get(ctx, params.SkillID)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, fmt.Errorf("ai: skill not found")
	}
	updated.RowVersion = newVer
	v := toSkillView(*updated)
	return &v, nil
}

// DeleteSkill 删除 Skill。
func (s *Service) DeleteSkill(ctx context.Context, skillID string) (bool, error) {
	if s == nil || s.Skills == nil {
		return false, fmt.Errorf("ai: skills unavailable")
	}
	if strings.TrimSpace(skillID) == "" {
		return false, fmt.Errorf("ai: skillId required")
	}
	existing, err := s.Skills.Get(ctx, skillID)
	if err != nil {
		return false, err
	}
	if existing == nil {
		return false, nil
	}
	if err := s.Skills.Delete(ctx, skillID); err != nil {
		return false, err
	}
	return true, nil
}

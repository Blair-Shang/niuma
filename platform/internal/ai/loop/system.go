package loop

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/platform/internal/store"
)

// SystemProviderID 是云端系统模型在本机 SQLite 中的稳定主键。
const SystemProviderID = "niuma-system"

const (
	systemProviderOptions = `{"system":true,"source":"niuma-cloud"}`
	systemProviderKind    = "openai"
	systemProviderSort    = int64(-100)
)

// SystemModelSpec 是系统模型目录中的一条模型。
type SystemModelSpec struct {
	Code  string
	Label string
}

// EnsureSystemParams 是登录后同步系统 Provider 的入参。
type EnsureSystemParams struct {
	Enabled          bool
	BaseURL          string
	ProviderName     string
	DefaultModelCode string
	Models           []SystemModelSpec
}

// EnsureSystemResult 是同步结果。
type EnsureSystemResult struct {
	ProviderID string
	Enabled    bool
}

// IsSystemProviderID 判断是否为系统 Provider 主键。
func IsSystemProviderID(id string) bool {
	return strings.TrimSpace(id) == SystemProviderID
}

// IsSystemProvider 判断库中的 Provider 是否由云端系统模型托管。
func IsSystemProvider(p *store.AIProvider) bool {
	if p == nil {
		return false
	}
	if IsSystemProviderID(p.ProviderID) {
		return true
	}
	raw := strings.TrimSpace(p.ProviderOptions)
	if raw == "" {
		return false
	}
	var opt struct {
		System bool `json:"system"`
	}
	if err := json.Unmarshal([]byte(raw), &opt); err != nil {
		return false
	}
	return opt.System
}

// EnsureSystemProvider 按云端目录创建或更新本机系统 Provider（不含上游 Key）。
func (s *Service) EnsureSystemProvider(ctx context.Context, params EnsureSystemParams) (*EnsureSystemResult, error) {
	if s == nil || s.Providers == nil {
		return nil, fmt.Errorf("ai: service unavailable")
	}
	existing, err := s.Providers.GetProvider(ctx, SystemProviderID)
	if err != nil {
		return nil, err
	}

	name := strings.TrimSpace(params.ProviderName)
	if name == "" {
		name = "NiuMa"
	}
	status := "active"
	if !params.Enabled {
		status = "disabled"
	}

	if existing == nil {
		if !params.Enabled {
			return &EnsureSystemResult{ProviderID: SystemProviderID, Enabled: false}, nil
		}
		if err := s.Providers.CreateProvider(ctx, store.AIProvider{
			ProviderID:       SystemProviderID,
			ProviderName:     name,
			ProviderKind:     systemProviderKind,
			BaseURL:          strings.TrimSpace(params.BaseURL),
			DefaultModelCode: strings.TrimSpace(params.DefaultModelCode),
			ProviderOptions:  systemProviderOptions,
			RecordStatus:     status,
			SortOrder:        systemProviderSort,
		}); err != nil {
			return nil, err
		}
	} else {
		if _, ok, updErr := s.Providers.UpdateProvider(ctx, store.AIProvider{
			ProviderID:       SystemProviderID,
			ProviderName:     name,
			ProviderKind:     systemProviderKind,
			BaseURL:          strings.TrimSpace(params.BaseURL),
			CredentialID:     existing.CredentialID,
			DefaultModelCode: strings.TrimSpace(params.DefaultModelCode),
			ProviderOptions:  systemProviderOptions,
			RecordStatus:     status,
			SortOrder:        systemProviderSort,
		}, existing.RowVersion); updErr != nil {
			return nil, updErr
		} else if !ok {
			return nil, fmt.Errorf("ai: system provider version conflict")
		}
	}

	if params.Enabled {
		if err := s.syncSystemModels(ctx, params.Models); err != nil {
			return nil, err
		}
	}
	return &EnsureSystemResult{ProviderID: SystemProviderID, Enabled: params.Enabled}, nil
}

func (s *Service) syncSystemModels(ctx context.Context, models []SystemModelSpec) error {
	existing, err := s.Providers.ListModels(ctx, SystemProviderID)
	if err != nil {
		return err
	}
	byCode := make(map[string]store.AIModel, len(existing))
	for _, m := range existing {
		byCode[m.ModelCode] = m
	}
	for i, spec := range models {
		code := strings.TrimSpace(spec.Code)
		if code == "" {
			continue
		}
		label := strings.TrimSpace(spec.Label)
		if label == "" {
			label = code
		}
		if hit, ok := byCode[code]; ok {
			if hit.RecordStatus != "active" || hit.ModelLabel != label || hit.SortOrder != int64(i) {
				hit.ModelLabel = label
				hit.RecordStatus = "active"
				hit.SortOrder = int64(i)
				if _, _, updErr := s.Providers.UpdateModel(ctx, hit, hit.RowVersion); updErr != nil {
					return updErr
				}
			}
			delete(byCode, code)
			continue
		}
		modelID, idErr := s.ids.NextString()
		if idErr != nil {
			return idErr
		}
		if err := s.Providers.CreateModel(ctx, store.AIModel{
			ModelID:      modelID,
			ProviderID:   SystemProviderID,
			ModelCode:    code,
			ModelLabel:   label,
			RecordStatus: "active",
			SortOrder:    int64(i),
		}); err != nil {
			return err
		}
	}
	for _, leftover := range byCode {
		if leftover.RecordStatus == "disabled" {
			continue
		}
		leftover.RecordStatus = "disabled"
		if _, _, updErr := s.Providers.UpdateModel(ctx, leftover, leftover.RowVersion); updErr != nil {
			return updErr
		}
	}
	return nil
}

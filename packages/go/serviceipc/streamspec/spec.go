// Package streamspec 定义 InvokeStream 的声明式契约（由 manifest 加载，无业务硬编码）。
package streamspec

import (
	"encoding/json"
	"fmt"
)

// Spec 描述一条 stream 订阅：method、绑定参数与事件过滤规则。
type Spec struct {
	Method     string   `yaml:"method"`
	BindParam  string   `yaml:"bind_param"`
	MatchField string   `yaml:"match_field"`
	EventTypes []string `yaml:"event_types"`
	Exclusive  bool     `yaml:"exclusive"`
}

// BindValue 从开流请求 params JSON 中解析绑定字段值。
func (s Spec) BindValue(paramsJSON []byte) (string, error) {
	if s.BindParam == "" {
		return "", fmt.Errorf("bind_param required")
	}
	var params map[string]any
	if len(paramsJSON) == 0 {
		paramsJSON = []byte("{}")
	}
	if err := json.Unmarshal(paramsJSON, &params); err != nil {
		return "", err
	}
	v, _ := params[s.BindParam].(string)
	if v == "" {
		return "", fmt.Errorf("%s required", s.BindParam)
	}
	return v, nil
}

// Match 判断事件 JSON 是否属于该绑定实例。
func (s Spec) Match(payload []byte, bindValue string) bool {
	if bindValue == "" || s.MatchField == "" || len(s.EventTypes) == 0 {
		return false
	}
	var hdr struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(payload, &hdr); err != nil || hdr.Type == "" {
		return false
	}
	if !contains(s.EventTypes, hdr.Type) {
		return false
	}
	return fieldString(payload, s.MatchField) == bindValue
}

func contains(list []string, v string) bool {
	for _, item := range list {
		if item == v {
			return true
		}
	}
	return false
}

func fieldString(payload []byte, key string) string {
	var raw map[string]any
	if err := json.Unmarshal(payload, &raw); err != nil {
		return ""
	}
	v, _ := raw[key].(string)
	return v
}

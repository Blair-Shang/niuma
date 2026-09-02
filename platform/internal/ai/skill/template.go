package ai

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

// skillPlaceholderRe 匹配模板中的 {{name}} / {{ name }}。
var skillPlaceholderRe = regexp.MustCompile(`\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}`)

// applySkillTemplate 用 param_schema.properties.*.default 填充 {{param}} 占位符。
// 无 default 的占位保留原文，便于作者发现未配置项。不做任意用户入参执行（Skills 仍是纯模板）。
func applySkillTemplate(template, paramSchemaJSON string) string {
	template = strings.TrimSpace(template)
	if template == "" {
		return ""
	}
	defaults := skillSchemaDefaults(paramSchemaJSON)
	if len(defaults) == 0 {
		return template
	}
	return skillPlaceholderRe.ReplaceAllStringFunc(template, func(m string) string {
		sub := skillPlaceholderRe.FindStringSubmatch(m)
		if len(sub) < 2 {
			return m
		}
		if v, ok := defaults[sub[1]]; ok {
			return v
		}
		return m
	})
}

func skillSchemaDefaults(paramSchemaJSON string) map[string]string {
	raw := strings.TrimSpace(paramSchemaJSON)
	if raw == "" || raw == "{}" {
		return nil
	}
	var schema struct {
		Properties map[string]struct {
			Default any `json:"default"`
		} `json:"properties"`
	}
	if err := json.Unmarshal([]byte(raw), &schema); err != nil || len(schema.Properties) == 0 {
		return nil
	}
	out := make(map[string]string, len(schema.Properties))
	for name, prop := range schema.Properties {
		if prop.Default == nil {
			continue
		}
		switch v := prop.Default.(type) {
		case string:
			out[name] = v
		case float64:
			if v == float64(int64(v)) {
				out[name] = strconv.FormatInt(int64(v), 10)
			} else {
				out[name] = strconv.FormatFloat(v, 'f', -1, 64)
			}
		case bool:
			out[name] = strconv.FormatBool(v)
		default:
			b, err := json.Marshal(v)
			if err == nil {
				out[name] = string(b)
			}
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

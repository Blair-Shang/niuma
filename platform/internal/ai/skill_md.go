package ai

import (
	"fmt"
	"strings"
	"unicode"

	"gopkg.in/yaml.v3"
)

// skillMDDoc 是 OpenClaw 兼容的 SKILL.md 解析结果。
type skillMDDoc struct {
	Name        string
	Description string
	Body        string
	RawFront    map[string]any
}

// parseSkillMD 解析 SKILL.md（YAML frontmatter + Markdown 正文）。
func parseSkillMD(raw string) (*skillMDDoc, error) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return nil, fmt.Errorf("ai: SKILL.md is empty")
	}
	if !strings.HasPrefix(text, "---") {
		// 无 frontmatter：整篇当正文，名称稍后由目录名推断。
		return &skillMDDoc{Body: strings.TrimSpace(text), RawFront: map[string]any{}}, nil
	}
	rest := strings.TrimPrefix(text, "---")
	rest = strings.TrimLeft(rest, "\r\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return nil, fmt.Errorf("ai: SKILL.md frontmatter not closed")
	}
	front := rest[:end]
	body := strings.TrimSpace(rest[end+len("\n---"):])
	body = strings.TrimLeft(body, "\r\n")

	var meta map[string]any
	if err := yaml.Unmarshal([]byte(front), &meta); err != nil {
		return nil, fmt.Errorf("ai: parse SKILL.md frontmatter: %w", err)
	}
	if meta == nil {
		meta = map[string]any{}
	}
	doc := &skillMDDoc{
		Name:        stringifyMeta(meta["name"]),
		Description: stringifyMeta(meta["description"]),
		Body:        body,
		RawFront:    meta,
	}
	if doc.Body == "" {
		return nil, fmt.Errorf("ai: SKILL.md body is empty")
	}
	return doc, nil
}

func stringifyMeta(v any) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case fmt.Stringer:
		return strings.TrimSpace(t.String())
	default:
		if v == nil {
			return ""
		}
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

// sanitizeSkillCode 规范为 OpenClaw 风格：小写字母、数字、连字符。
func sanitizeSkillCode(raw string) string {
	s := strings.TrimSpace(strings.ToLower(raw))
	if s == "" {
		return ""
	}
	var b strings.Builder
	prevHyphen := false
	for _, r := range s {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			prevHyphen = false
		case r == '-' || r == '_' || r == ' ' || r == '.':
			if b.Len() > 0 && !prevHyphen {
				b.WriteByte('-')
				prevHyphen = true
			}
		}
	}
	out := strings.Trim(b.String(), "-")
	if len(out) > 64 {
		out = out[:64]
		out = strings.Trim(out, "-")
	}
	return out
}

func skillPackMCPServerID(code string) string {
	code = sanitizeSkillCode(code)
	code = strings.ReplaceAll(code, "-", "_")
	if code == "" {
		return ""
	}
	return "skillpack_" + code
}

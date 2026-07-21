package ai

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	// maxContextBytes 是 Normalize 后 Context Pack 序列化进 prompt 的上限。
	maxContextBytes = 32 * 1024
	// maxSelectionBytes 是单条 selection 文本上限。
	maxSelectionBytes = 8 * 1024
)

var sensitiveKeyRe = regexp.MustCompile(`(?i)(password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|credential)`)

// ContextDraft 是 Web 采集的 Context Pack 草稿（对齐 docs/24 §15.2）。
type ContextDraft struct {
	Workspace   *ContextWorkspace    `json:"workspace,omitempty"`
	Attachments []ContextAttachment  `json:"attachments,omitempty"`
}

// ContextWorkspace 限定工具作用域。
type ContextWorkspace struct {
	TabID       string   `json:"tabId,omitempty"`
	ModuleID    string   `json:"moduleId,omitempty"`
	ProfileID   string   `json:"profileId,omitempty"`
	SessionID   string   `json:"sessionId,omitempty"`
	Title       string   `json:"title,omitempty"`
	Database    string   `json:"database,omitempty"`
	Schema      string   `json:"schema,omitempty"`
	// DialectFamily / Capabilities：前端会话探测结果（DBeaver/Navicat 能力模型）。
	DialectFamily string   `json:"dialectFamily,omitempty"`
	Capabilities  []string `json:"capabilities,omitempty"`
	DialectRules  string   `json:"dialectRules,omitempty"`
}

// ContextAttachment 是用户显式 @ 附加项。
type ContextAttachment struct {
	ID      string         `json:"id"`
	Kind    string         `json:"kind"`
	Label   string         `json:"label"`
	Detail  string         `json:"detail,omitempty"`
	Payload map[string]any `json:"payload,omitempty"`
}

// NormalizedContext 是校验、脱敏、截断后的上下文。
type NormalizedContext struct {
	Workspace   *ContextWorkspace
	Attachments []ContextAttachment
	// PromptBlock 供 Assemble 注入（可空表示无有效上下文）。
	PromptBlock string
	Truncated   bool
}

// NormalizeContext 校验、脱敏、截断 Context Pack。
func NormalizeContext(draft *ContextDraft) NormalizedContext {
	if draft == nil {
		return NormalizedContext{}
	}
	out := NormalizedContext{}
	if draft.Workspace != nil {
		ws := *draft.Workspace
		ws.TabID = strings.TrimSpace(ws.TabID)
		ws.ModuleID = strings.TrimSpace(ws.ModuleID)
		ws.ProfileID = strings.TrimSpace(ws.ProfileID)
		ws.SessionID = strings.TrimSpace(ws.SessionID)
		ws.Title = truncateUTF8(strings.TrimSpace(ws.Title), 200)
		ws.Database = strings.TrimSpace(ws.Database)
		ws.Schema = strings.TrimSpace(ws.Schema)
		ws.DialectFamily = strings.TrimSpace(ws.DialectFamily)
		ws.DialectRules = strings.TrimSpace(ws.DialectRules)
		if len(ws.Capabilities) > 0 {
			cleaned := make([]string, 0, len(ws.Capabilities))
			for _, c := range ws.Capabilities {
				if t := strings.TrimSpace(c); t != "" {
					cleaned = append(cleaned, t)
				}
			}
			ws.Capabilities = cleaned
		}
		if ws.TabID != "" || ws.ModuleID != "" || ws.ProfileID != "" || ws.SessionID != "" || ws.Title != "" || ws.Database != "" || ws.Schema != "" || ws.DialectFamily != "" || len(ws.Capabilities) > 0 || ws.DialectRules != "" {
			out.Workspace = &ws
		}
	}

	for _, a := range draft.Attachments {
		id := strings.TrimSpace(a.ID)
		label := strings.TrimSpace(a.Label)
		if id == "" || label == "" {
			continue
		}
		kind := strings.TrimSpace(a.Kind)
		if kind == "" {
			kind = "tab"
		}
		payload, truncated := sanitizePayload(a.Payload)
		if truncated {
			out.Truncated = true
		}
		out.Attachments = append(out.Attachments, ContextAttachment{
			ID:      id,
			Kind:    kind,
			Label:   truncateUTF8(label, 200),
			Detail:  truncateUTF8(strings.TrimSpace(a.Detail), 400),
			Payload: payload,
		})
	}

	// schema 附件可补齐 workspace.database / schema（供 MCP 作用域注入）
	if out.Workspace != nil {
		for _, a := range out.Attachments {
			if a.Kind != "schema" || a.Payload == nil {
				continue
			}
			if out.Workspace.Database == "" {
				if db, ok := a.Payload["database"].(string); ok {
					out.Workspace.Database = strings.TrimSpace(db)
				}
			}
			if out.Workspace.Schema == "" {
				if sch, ok := a.Payload["schema"].(string); ok {
					out.Workspace.Schema = strings.TrimSpace(sch)
				}
			}
		}
	}

	block, truncated := formatContextPrompt(out.Workspace, out.Attachments)
	if truncated {
		out.Truncated = true
	}
	out.PromptBlock = block
	return out
}

func sanitizePayload(in map[string]any) (map[string]any, bool) {
	if len(in) == 0 {
		return nil, false
	}
	truncated := false
	out := make(map[string]any, len(in))
	for k, v := range in {
		if sensitiveKeyRe.MatchString(k) {
			truncated = true
			continue
		}
		switch t := v.(type) {
		case string:
			if strings.EqualFold(k, "text") || strings.EqualFold(k, "sql") || strings.EqualFold(k, "snippet") {
				s, cut := truncateBytes(t, maxSelectionBytes)
				if cut {
					truncated = true
				}
				out[k] = s
				continue
			}
			out[k] = truncateUTF8(t, 2000)
		case map[string]any:
			nested, cut := sanitizePayload(t)
			if cut {
				truncated = true
			}
			if len(nested) > 0 {
				out[k] = nested
			}
		case []any:
			// 跳过大型数组，避免整表 dump
			if len(t) > 32 {
				truncated = true
				out[k] = fmt.Sprintf("[array truncated len=%d]", len(t))
				continue
			}
			out[k] = t
		default:
			out[k] = v
		}
	}
	if len(out) == 0 {
		return nil, truncated
	}
	return out, truncated
}

func formatContextPrompt(ws *ContextWorkspace, attachments []ContextAttachment) (string, bool) {
	if ws == nil && len(attachments) == 0 {
		return "", false
	}
	var b strings.Builder
	b.WriteString("[Context Pack]\n")
	if ws != nil {
		b.WriteString(fmt.Sprintf(
			"workspace: module=%s profile=%s session=%s tab=%s\n",
			dash(ws.ModuleID), dash(ws.ProfileID), dash(ws.SessionID), dash(ws.Title),
		))
		if rules := strings.TrimSpace(ws.DialectRules); rules != "" {
			b.WriteString(rules)
			b.WriteByte('\n')
		} else if dialect := moduleDialectPrompt(ws.ModuleID, ws.DialectFamily, ws.Capabilities); dialect != "" {
			b.WriteString(dialect)
			b.WriteByte('\n')
		}
	}
	for _, a := range attachments {
		detail := a.Detail
		if detail != "" {
			b.WriteString(fmt.Sprintf("[%s] %s (%s)\n", a.Kind, a.Label, detail))
		} else {
			b.WriteString(fmt.Sprintf("[%s] %s\n", a.Kind, a.Label))
		}
		// 正文类附件：selection / diagnostic / schema 等，必须把 payload 文本入模
		if text := attachmentBodyText(a); text != "" {
			b.WriteString("```\n")
			b.WriteString(text)
			b.WriteString("\n```\n")
		}
		if pid, ok := a.Payload["profileId"].(string); ok && strings.TrimSpace(pid) != "" {
			b.WriteString(fmt.Sprintf("  profileId=%s\n", strings.TrimSpace(pid)))
		}
		if db, ok := a.Payload["database"].(string); ok && strings.TrimSpace(db) != "" {
			b.WriteString(fmt.Sprintf("  database=%s\n", strings.TrimSpace(db)))
		}
		if sch, ok := a.Payload["schema"].(string); ok && strings.TrimSpace(sch) != "" {
			b.WriteString(fmt.Sprintf("  schema=%s\n", strings.TrimSpace(sch)))
		}
		if tbl, ok := a.Payload["table"].(string); ok && strings.TrimSpace(tbl) != "" {
			b.WriteString(fmt.Sprintf("  table=%s\n", strings.TrimSpace(tbl)))
		}
	}
	raw := b.String()
	cut, truncated := truncateBytes(raw, maxContextBytes)
	if truncated {
		return cut + "\n…[truncated]", true
	}
	return cut, false
}

// attachmentBodyText 提取附件中应入模的正文（选区 SQL、诊断/Explain 文本等）。
func attachmentBodyText(a ContextAttachment) string {
	if a.Payload == nil {
		return ""
	}
	for _, key := range []string{"text", "sql", "snippet"} {
		if v, ok := a.Payload[key].(string); ok {
			if s := strings.TrimSpace(v); s != "" {
				return s
			}
		}
	}
	return ""
}

func dash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "-"
	}
	return s
}

// moduleDialectPrompt 按能力集生成方言规则；无能力时回退模块默认（Vastbase=PL/SQL 过程）。
func moduleDialectPrompt(moduleID, family string, caps []string) string {
	fam := strings.ToLower(strings.TrimSpace(family))
	if fam == "" {
		fam = strings.ToLower(strings.TrimSpace(moduleID))
	}
	if len(caps) > 0 {
		return formatCapabilitiesDialect(fam, caps)
	}
	switch fam {
	case "vastbase":
		return dialectVastbasePrompt
	default:
		return ""
	}
}

func formatCapabilitiesDialect(family string, caps []string) string {
	var b strings.Builder
	b.WriteString("[Dialect · ")
	b.WriteString(family)
	b.WriteString("]\ncapabilities=")
	b.WriteString(strings.Join(caps, ","))
	b.WriteByte('\n')
	set := make(map[string]struct{}, len(caps))
	for _, c := range caps {
		set[c] = struct{}{}
	}
	has := func(id string) bool {
		_, ok := set[id]
		return ok
	}
	if has("proc.plsql_bare") {
		b.WriteString("CREATE PROCEDURE: use AS|IS … BEGIN … END; do NOT use LANGUAGE plpgsql / AS $$ unless capability proc.plpgsql_dollar is also present.\n")
	}
	if has("proc.plpgsql_dollar") && !has("proc.plsql_bare") {
		b.WriteString("CREATE PROCEDURE: LANGUAGE plpgsql AS $$ … $$ is supported.\n")
	}
	if has("func.plpgsql_dollar") {
		b.WriteString("CREATE FUNCTION: LANGUAGE plpgsql AS $$ … $$ is OK.\n")
	}
	if has("script.oracle_slash") {
		b.WriteString("Trailing lone-line / is a client terminator; strip before query.exec.\n")
	}
	if has("editor.suppress_pg_diagnostics") {
		b.WriteString("Editor PG-parser redlines on PL/SQL may be false positives; trust SQLSTATE.\n")
	}
	return strings.TrimSpace(b.String())
}

func truncateBytes(s string, max int) (string, bool) {
	if max <= 0 || len(s) <= max {
		return s, false
	}
	// 按字节截断后回退到合法 UTF-8 边界。
	cut := s[:max]
	for len(cut) > 0 && !utf8.ValidString(cut) {
		cut = cut[:len(cut)-1]
	}
	return cut, true
}

func truncateUTF8(s string, maxRunes int) string {
	if maxRunes <= 0 || s == "" {
		return s
	}
	if utf8.RuneCountInString(s) <= maxRunes {
		return s
	}
	return string([]rune(s)[:maxRunes])
}

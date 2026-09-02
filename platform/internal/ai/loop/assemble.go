package ai

import (
	"net/url"
	"regexp"
	"strings"

	"niuma/platform/internal/store"
)

// nmRefMarkerRe 匹配前端 chip 标记 ⟦nm-ref:…⟧，入模前剥离。
var nmRefMarkerRe = regexp.MustCompile(`⟦nm-ref:[^⟧]*⟧`)

// nmImgMarkerRe 匹配图片标记 ⟦nm-img:data:image/...;base64,...⟧。
var nmImgMarkerRe = regexp.MustCompile(`⟦nm-img:(data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)⟧`)

// nmTxtMarkerRe 匹配文本附件 ⟦nm-txt:name⟧…⟦/nm-txt⟧（name 为 URL-encoded）。
var nmTxtMarkerRe = regexp.MustCompile(`(?s)⟦nm-txt:([^⟧]*)⟧\n?(.*?)\n?⟦/nm-txt⟧`)

const (
	maxImagesPerMessage = 3
	maxTextFilesPerMessage = 5
	maxTextFileChars       = 100_000
	// maxImageDataURLBytes 单张 data URL 上限（含前缀），防止把百万级 base64 塞进 prompt。
	maxImageDataURLBytes = 1_200_000
)

// AssembleMessages 将历史消息与规范化 Context 装配为 LLM messages。
//
// 分轨：system 人设（+ Skill）→（可选）system Context Pack → 近 N 轮 user/assistant。
// 用户消息若含 nm-img 标记，转为 Vision content parts；nm-txt 展开为正文附件块。
func AssembleMessages(history []store.AIMessage, normalized NormalizedContext, skillPrompt string) []ChatMessage {
	out := make([]ChatMessage, 0, len(history)+2)
	out = append(out, ChatMessage{Role: MessageRoleSystem, Content: mergeSystemPrompt(skillPrompt)})
	if block := strings.TrimSpace(normalized.PromptBlock); block != "" {
		out = append(out, ChatMessage{Role: MessageRoleSystem, Content: block})
	}
	start := 0
	if len(history) > chatHistoryLimit {
		start = len(history) - chatHistoryLimit
	}
	for _, m := range history[start:] {
		role := m.MessageRole
		if role != MessageRoleUser && role != MessageRoleAssistant && role != MessageRoleSystem {
			continue
		}
		if role == MessageRoleUser {
			msg, ok := assembleUserMessage(m.MessageContent)
			if !ok {
				continue
			}
			out = append(out, msg)
			continue
		}
		content := strings.TrimSpace(m.MessageContent)
		if content == "" {
			continue
		}
		out = append(out, ChatMessage{Role: role, Content: content})
	}
	return out
}

func assembleUserMessage(raw string) (ChatMessage, bool) {
	images, text := extractImageDataURLs(raw)
	text = expandTextFileMarkers(text)
	text = stripRefMarkers(text)
	text = strings.TrimSpace(text)
	if len(images) == 0 {
		if text == "" {
			return ChatMessage{}, false
		}
		return ChatMessage{Role: MessageRoleUser, Content: text}, true
	}
	parts := make([]ContentPart, 0, len(images)+1)
	if text == "" {
		text = userAttachOnlyPrompt
	}
	parts = append(parts, ContentPart{Type: "text", Text: text})
	for _, url := range images {
		parts = append(parts, ContentPart{
			Type:     "image_url",
			ImageURL: &ImageURLPart{URL: url},
		})
	}
	return ChatMessage{Role: MessageRoleUser, Content: parts}, true
}

func extractImageDataURLs(s string) (images []string, text string) {
	matches := nmImgMarkerRe.FindAllStringSubmatch(s, -1)
	for _, m := range matches {
		if len(m) < 2 {
			continue
		}
		url := m[1]
		if len(url) > maxImageDataURLBytes {
			continue
		}
		if len(images) >= maxImagesPerMessage {
			break
		}
		images = append(images, url)
	}
	text = nmImgMarkerRe.ReplaceAllString(s, "")
	return images, text
}

func expandTextFileMarkers(s string) string {
	count := 0
	return nmTxtMarkerRe.ReplaceAllStringFunc(s, func(m string) string {
		sub := nmTxtMarkerRe.FindStringSubmatch(m)
		if len(sub) < 3 {
			return ""
		}
		if count >= maxTextFilesPerMessage {
			return ""
		}
		count++
		name := decodeFileName(sub[1])
		body := strings.TrimSpace(sub[2])
		if len(body) > maxTextFileChars {
			body = body[:maxTextFileChars] + "\n…(truncated)"
		}
		return formatAttachedFileBlock(name, body)
	})
}

func decodeFileName(enc string) string {
	enc = strings.TrimSpace(enc)
	if enc == "" {
		return "untitled.txt"
	}
	if decoded, err := url.QueryUnescape(enc); err == nil && decoded != "" {
		return decoded
	}
	return enc
}

func stripRefMarkers(s string) string {
	cleaned := nmRefMarkerRe.ReplaceAllString(s, "")
	return strings.TrimSpace(cleaned)
}

func stripAllMarkers(s string) string {
	s = nmImgMarkerRe.ReplaceAllString(s, "")
	s = nmTxtMarkerRe.ReplaceAllString(s, "")
	s = nmRefMarkerRe.ReplaceAllString(s, "")
	return strings.TrimSpace(s)
}

func hasImageMarkers(s string) bool {
	return nmImgMarkerRe.MatchString(s)
}

func hasTextFileMarkers(s string) bool {
	return nmTxtMarkerRe.MatchString(s)
}

func hasAttachmentMarkers(s string) bool {
	return hasImageMarkers(s) || hasTextFileMarkers(s)
}

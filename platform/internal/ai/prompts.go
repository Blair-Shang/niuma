package ai

import (
	"embed"
	"fmt"
	"strings"
)

// 提示词文本在 prompts/ 目录单独维护，改文案无需改编排逻辑。

//go:embed prompts/*.txt
var promptFS embed.FS

// 入模提示词（启动时从 prompts/*.txt 加载）。
var (
	defaultSystemPrompt    string
	userAttachOnlyPrompt   string
	attachedFileTemplate   string
	skillSectionTemplate   string
	dialectVastbasePrompt  string
)

func init() {
	defaultSystemPrompt = mustPrompt("prompts/system_default.txt")
	userAttachOnlyPrompt = mustPrompt("prompts/user_attach_only.txt")
	attachedFileTemplate = mustPrompt("prompts/attached_file.txt")
	skillSectionTemplate = mustPrompt("prompts/skill_section.txt")
	dialectVastbasePrompt = mustPrompt("prompts/dialect_vastbase.txt")
}

func mustPrompt(path string) string {
	b, err := promptFS.ReadFile(path)
	if err != nil {
		panic("ai: load prompt " + path + ": " + err.Error())
	}
	return strings.TrimSpace(string(b))
}

// mergeSystemPrompt 将可选 Skill 模板并入默认 system。
func mergeSystemPrompt(skillPrompt string) string {
	system := defaultSystemPrompt
	if sp := strings.TrimSpace(skillPrompt); sp == "" {
		return system
	}
	return system + "\n\n" + fmt.Sprintf(skillSectionTemplate, strings.TrimSpace(skillPrompt))
}

// formatAttachedFileBlock 将文本附件展开为入模正文块。
func formatAttachedFileBlock(name, body string) string {
	return "\n" + fmt.Sprintf(attachedFileTemplate, name, body) + "\n"
}

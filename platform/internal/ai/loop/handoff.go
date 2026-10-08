package loop

import (
	"regexp"
	"strings"
)

// maxHandoffNudges 是一次 run 里补叫工具的次数。只补一次，避免停不下来。
const maxHandoffNudges = 1

// handoffMarkers 是「说了要接着做、却没有调用工具」的说法。
// 完成报告里的可选追问（要不要顺手再做）不在这里，那种该停下来等用户。
var handoffMarkers = []string{
	"下一轮",
	"确认就回",
	"回「执行」",
	"回复「执行」",
	"回“执行”",
	"开干",
	"现在开始",
	"接下来我会",
	"接下来就",
	"随后验证",
	"然后再验证",
	"再验证",
	"然后验证",
}

// defersWork 判断这段助手正文是不是把还没做的步骤留到了对话之外。
func defersWork(content string) bool {
	text := strings.TrimSpace(stripThink(content))
	if text == "" {
		return false
	}
	for _, marker := range handoffMarkers {
		if strings.Contains(text, marker) {
			return true
		}
	}
	return false
}

var thinkBlock = regexp.MustCompile(`(?is)<\s*(?:think|thinking)\s*>[\s\S]*?(?:<\s*/\s*(?:think|thinking)\s*>|$)`)

func stripThink(content string) string {
	return thinkBlock.ReplaceAllString(content, "")
}

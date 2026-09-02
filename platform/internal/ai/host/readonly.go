package host

import (
	"fmt"
	"regexp"
	"strings"
)

var mutatingSQLRe = regexp.MustCompile(`(?is)\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do|execute)\b`)

// AssertReadonlySQL 拒绝非 SELECT/WITH、多语句与明显写关键字。
// 这是第一道滤网，不是权限硬闸。
func AssertReadonlySQL(sql string) error {
	sql = strings.TrimSpace(sql)
	if sql == "" {
		return fmt.Errorf("sql required")
	}
	cleaned := regexp.MustCompile(`(?m)--.*?$`).ReplaceAllString(sql, " ")
	cleaned = regexp.MustCompile(`(?s)/\*.*?\*/`).ReplaceAllString(cleaned, " ")
	cleaned = strings.TrimSpace(cleaned)
	lower := strings.ToLower(cleaned)
	if !(strings.HasPrefix(lower, "select") || strings.HasPrefix(lower, "with")) {
		return fmt.Errorf("only SELECT/WITH statements are allowed")
	}
	if mutatingSQLRe.MatchString(cleaned) {
		return fmt.Errorf("mutating SQL rejected")
	}
	if strings.Contains(cleaned, ";") {
		parts := strings.Split(cleaned, ";")
		n := 0
		for _, p := range parts {
			if strings.TrimSpace(p) != "" {
				n++
			}
		}
		if n > 1 {
			return fmt.Errorf("multiple statements rejected")
		}
	}
	return nil
}

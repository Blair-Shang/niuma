package host

import (
	"fmt"
	"regexp"
	"strings"
)

var mutatingSQLRe = regexp.MustCompile(`(?is)\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do|execute)\b`)
var sqlLineCommentRe = regexp.MustCompile(`(?m)--.*?$`)
var sqlHashCommentRe = regexp.MustCompile(`(?m)#.*?$`)
var sqlBlockCommentRe = regexp.MustCompile(`(?s)/\*.*?\*/`)
var explainLeadRe = regexp.MustCompile(`(?is)^explain\s+(?:analyze\s+)?(?:format\s*=\s*\S+\s+)?`)

func stripSQLComments(sql string) string {
	cleaned := sqlLineCommentRe.ReplaceAllString(sql, " ")
	cleaned = sqlHashCommentRe.ReplaceAllString(cleaned, " ")
	cleaned = sqlBlockCommentRe.ReplaceAllString(cleaned, " ")
	return strings.TrimSpace(cleaned)
}

func statementCount(cleaned string) int {
	n := 0
	for _, p := range strings.Split(cleaned, ";") {
		if strings.TrimSpace(p) != "" {
			n++
		}
	}
	return n
}

func isShowOrDescribe(lower string) bool {
	return strings.HasPrefix(lower, "show") ||
		strings.HasPrefix(lower, "describe") ||
		strings.HasPrefix(lower, "desc ")
}

// AssertReadonlySQL 拒绝写语句与多语句。
// 允许 SELECT/WITH、SHOW/DESCRIBE（含 SHOW CREATE）、以及 EXPLAIN 只读目标。
// 这是第一道滤网，不是权限硬闸；写操作走 sql_exec 并经用户确认。
func AssertReadonlySQL(sql string) error {
	sql = strings.TrimSpace(sql)
	if sql == "" {
		return fmt.Errorf("sql required")
	}
	cleaned := stripSQLComments(sql)
	if cleaned == "" {
		return fmt.Errorf("sql required")
	}
	if statementCount(cleaned) > 1 {
		return fmt.Errorf("multiple statements rejected")
	}
	lower := strings.ToLower(cleaned)
	switch {
	case strings.HasPrefix(lower, "select"), strings.HasPrefix(lower, "with"):
		if mutatingSQLRe.MatchString(cleaned) {
			return fmt.Errorf("mutating SQL rejected")
		}
		return nil
	case isShowOrDescribe(lower):
		return nil
	case strings.HasPrefix(lower, "explain"):
		rest := strings.TrimSpace(explainLeadRe.ReplaceAllString(cleaned, ""))
		restLower := strings.ToLower(rest)
		if restLower == "" {
			return fmt.Errorf("explain target required")
		}
		if isShowOrDescribe(restLower) {
			return nil
		}
		if strings.HasPrefix(restLower, "select") || strings.HasPrefix(restLower, "with") {
			if mutatingSQLRe.MatchString(rest) {
				return fmt.Errorf("mutating SQL rejected")
			}
			return nil
		}
		return fmt.Errorf("only EXPLAIN of SELECT/WITH/SHOW is allowed; use sql_exec for writes")
	default:
		return fmt.Errorf("only SELECT/WITH/SHOW/EXPLAIN statements are allowed; use sql_exec after user confirmation")
	}
}

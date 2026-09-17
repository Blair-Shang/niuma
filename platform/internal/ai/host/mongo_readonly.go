package host

import (
	"fmt"
	"regexp"
	"strings"
)

var mutatingMongoRe = regexp.MustCompile(`(?is)\b(insert(?:one|many)?|update(?:one|many)?|replaceone|delete(?:one|many)?|findoneand(?:update|replace|delete)|bulkwrite|drop(?:index|indexes|database|collection)?|create(?:index|indexes|collection|user)?|renamecollection|remove|save)\b`)

// AssertReadonlyMongo 拒绝写语句（第一道滤网）。写操作走 mongo_exec 并经用户确认。
func AssertReadonlyMongo(input string) error {
	input = strings.TrimSpace(input)
	if input == "" {
		return fmt.Errorf("input required")
	}
	if mutatingMongoRe.MatchString(input) {
		return fmt.Errorf("mutating Mongo command rejected; use mongo_exec after user confirmation")
	}
	return nil
}

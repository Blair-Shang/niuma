// Package buildinfo 保存构建时通过 -ldflags 注入的版本元数据。
package buildinfo

import "encoding/json"

// Version 是应用语义化版本（来自根 package.json）。
var Version = "dev"

// BuildID 是构建标识（通常为 git short SHA）。
var BuildID = "dev"

// BuildDate 是构建 UTC 时间（ISO 8601）。
var BuildDate = ""

// Info 返回可序列化的版本信息。
func Info() map[string]string {
	return map[string]string{
		"version":   Version,
		"buildId":   BuildID,
		"buildDate": BuildDate,
	}
}

// JSON 返回版本信息的 JSON 字符串。
func JSON() string {
	b, _ := json.Marshal(Info())
	return string(b)
}

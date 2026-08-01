// Package id 提供进程内唯一 ID 生成。
package id

import (
	"fmt"
	"strings"
	"sync/atomic"
	"time"
)

// 单调序号，避免并行请求在同一纳秒生成相同 ID
//（例如浏览页 COUNT + SELECT 的 Promise.all）。
var idSeq atomic.Uint64

// UniqueID 生成进程内唯一 ID，格式：{prefix}-{unixNano}-{seq}。
// prefix 为空时使用 "id"。
func UniqueID(prefix string) string {
	p := strings.TrimSpace(prefix)
	if p == "" {
		p = "id"
	}
	return fmt.Sprintf("%s-%d-%d", p, time.Now().UnixNano(), idSeq.Add(1))
}

// CoalesceID 若 raw 去空白后非空则返回该值，否则返回 UniqueID(prefix)。
func CoalesceID(raw, prefix string) string {
	if s := strings.TrimSpace(raw); s != "" {
		return s
	}
	return UniqueID(prefix)
}

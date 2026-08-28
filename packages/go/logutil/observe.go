package logutil

import (
	"bufio"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	// ObserveFileName 是本机会话目录下的 RPC 观测 JSONL 文件名。
	ObserveFileName = "observe.jsonl"
	// SlowThreshold 超过该耗时视为慢调用（桌面本机检索用，不上报）。
	SlowThreshold = 200 * time.Millisecond
	// defaultTraceLimit 是按 traceId 检索时的默认条数上限。
	defaultTraceLimit = 200
	// maxTraceLimit 是按 traceId 检索时的硬上限。
	maxTraceLimit = 1000
	// defaultSummaryScan 是汇总时最多扫描的 JSONL 行数。
	defaultSummaryScan = 20000
	// maxSummaryScan 是汇总扫描行数硬上限。
	maxSummaryScan   = 50000
	diagMethodPrefix = "platform.diag."
)

// Event 是一条本机 RPC 观测记录。不含 SQL 正文或业务 result。
type Event struct {
	// TS 为 RFC3339 时间。
	TS string `json:"ts"`
	// Kind 固定为 rpc。
	Kind string `json:"kind"`
	// Service 为进程名，如 platform-core、mysql-service、niuma-shell。
	Service string `json:"service"`
	// Method 为 IPC 方法名。
	Method string `json:"method"`
	// ID 为请求 id。
	ID string `json:"id,omitempty"`
	// TraceID 为跨进程关联 id。
	TraceID string `json:"traceId,omitempty"`
	// OK 为信封成功标志。
	OK bool `json:"ok"`
	// ErrorCode 为稳定错误码；成功时省略。
	ErrorCode string `json:"errorCode,omitempty"`
	// DurationMs 为该跳耗时毫秒。
	DurationMs int64 `json:"durationMs"`
}

// MethodStat 是按方法聚合的本机统计。
type MethodStat struct {
	Method string `json:"method"`
	Count  int    `json:"count"`
	Fail   int    `json:"fail"`
	Slow   int    `json:"slow"`
	MaxMs  int64  `json:"maxMs"`
}

// ErrorCodeStat 是按错误码聚合的本机统计。
type ErrorCodeStat struct {
	Code  string `json:"code"`
	Count int    `json:"count"`
}

// Summary 是 observe.jsonl 的本机汇总（无外部 APM）。
type Summary struct {
	Dir       string          `json:"dir"`
	RPCTotal  int             `json:"rpcTotal"`
	FailTotal int             `json:"failTotal"`
	SlowTotal int             `json:"slowTotal"`
	SlowMs    int64           `json:"slowMs"`
	Scanned   int             `json:"scanned"`
	Truncated bool            `json:"truncated"`
	Methods   []MethodStat    `json:"methods"`
	Errors    []ErrorCodeStat `json:"errors"`
	Slowest   []Event         `json:"slowest"`
}

type ipcPeek struct {
	Method    string `json:"method"`
	ID        string `json:"id"`
	TraceID   string `json:"traceId"`
	OK        bool   `json:"ok"`
	ErrorCode string `json:"errorCode"`
}

var (
	observeMu  sync.Mutex
	observeW   *rotatingWriter
	observeDir string
)

// ObserveIPC 把一次 IPC 往返写成 observe.jsonl 一行。诊断方法自身不记录，避免检索递归。
func ObserveIPC(reqJSON, respJSON []byte, d time.Duration) {
	var req, resp ipcPeek
	_ = json.Unmarshal(reqJSON, &req)
	_ = json.Unmarshal(respJSON, &resp)
	method := strings.TrimSpace(req.Method)
	if method == "" || strings.HasPrefix(method, diagMethodPrefix) {
		return
	}
	id := strings.TrimSpace(resp.ID)
	if id == "" {
		id = strings.TrimSpace(req.ID)
	}
	trace := strings.TrimSpace(resp.TraceID)
	if trace == "" {
		trace = strings.TrimSpace(req.TraceID)
	}
	if trace == "" {
		trace = id
	}
	code := strings.TrimSpace(resp.ErrorCode)
	ok := resp.OK
	if len(respJSON) == 0 {
		ok = false
		if code == "" {
			code = "internal"
		}
	}
	service := currentServiceName()
	if service == "" {
		service = "unknown"
	}
	Record(Event{
		TS:         time.Now().Format(time.RFC3339Nano),
		Kind:       "rpc",
		Service:    service,
		Method:     method,
		ID:         id,
		TraceID:    trace,
		OK:         ok,
		ErrorCode:  code,
		DurationMs: d.Milliseconds(),
	})
}

// Record 追加一条观测事件；无法解析日志目录时静默跳过。
func Record(ev Event) {
	if strings.TrimSpace(ev.Method) == "" || strings.HasPrefix(ev.Method, diagMethodPrefix) {
		return
	}
	if ev.Kind == "" {
		ev.Kind = "rpc"
	}
	if ev.TS == "" {
		ev.TS = time.Now().Format(time.RFC3339Nano)
	}
	if ev.Service == "" {
		ev.Service = currentServiceName()
	}
	line, err := json.Marshal(ev)
	if err != nil {
		return
	}
	w := getObserveWriter()
	if w == nil {
		return
	}
	observeMu.Lock()
	defer observeMu.Unlock()
	_, _ = w.Write(append(line, '\n'))
}

// SearchTrace 在 observe.jsonl 及其滚动备份中按 traceId 检索，新到旧。
func SearchTrace(traceID string, limit int) []Event {
	traceID = strings.TrimSpace(traceID)
	if traceID == "" {
		return nil
	}
	if limit <= 0 {
		limit = defaultTraceLimit
	}
	if limit > maxTraceLimit {
		limit = maxTraceLimit
	}
	var out []Event
	scanObserveFiles(func(ev Event) bool {
		if ev.TraceID != traceID && ev.ID != traceID {
			return true
		}
		out = append(out, ev)
		return len(out) < limit
	})
	return out
}

// Summarize 扫描 observe.jsonl 做本机汇总。
func Summarize(maxEvents int) Summary {
	if maxEvents <= 0 {
		maxEvents = defaultSummaryScan
	}
	if maxEvents > maxSummaryScan {
		maxEvents = maxSummaryScan
	}
	slowMs := SlowThreshold.Milliseconds()
	sum := Summary{Dir: Dir(), SlowMs: slowMs}
	byMethod := map[string]*MethodStat{}
	byCode := map[string]int{}
	slowest := make([]Event, 0, 21)

	scanObserveFiles(func(ev Event) bool {
		if sum.Scanned >= maxEvents {
			sum.Truncated = true
			return false
		}
		sum.Scanned++
		sum.RPCTotal++
		st := byMethod[ev.Method]
		if st == nil {
			st = &MethodStat{Method: ev.Method}
			byMethod[ev.Method] = st
		}
		st.Count++
		if ev.DurationMs > st.MaxMs {
			st.MaxMs = ev.DurationMs
		}
		if !ev.OK {
			sum.FailTotal++
			st.Fail++
			if ev.ErrorCode != "" {
				byCode[ev.ErrorCode]++
			}
		}
		if ev.DurationMs >= slowMs {
			sum.SlowTotal++
			st.Slow++
		}
		slowest = insertSlowest(slowest, ev, 20)
		return true
	})

	methods := make([]MethodStat, 0, len(byMethod))
	for _, st := range byMethod {
		methods = append(methods, *st)
	}
	sort.Slice(methods, func(i, j int) bool {
		if methods[i].Fail != methods[j].Fail {
			return methods[i].Fail > methods[j].Fail
		}
		if methods[i].MaxMs != methods[j].MaxMs {
			return methods[i].MaxMs > methods[j].MaxMs
		}
		return methods[i].Count > methods[j].Count
	})
	if len(methods) > 30 {
		methods = methods[:30]
	}
	sum.Methods = methods

	codes := make([]ErrorCodeStat, 0, len(byCode))
	for code, n := range byCode {
		codes = append(codes, ErrorCodeStat{Code: code, Count: n})
	}
	sort.Slice(codes, func(i, j int) bool {
		if codes[i].Count != codes[j].Count {
			return codes[i].Count > codes[j].Count
		}
		return codes[i].Code < codes[j].Code
	})
	sum.Errors = codes
	sum.Slowest = slowest
	return sum
}

func insertSlowest(dst []Event, ev Event, capN int) []Event {
	dst = append(dst, ev)
	sort.Slice(dst, func(i, j int) bool { return dst[i].DurationMs > dst[j].DurationMs })
	if len(dst) > capN {
		return dst[:capN]
	}
	return dst
}

func scanObserveFiles(fn func(Event) bool) {
	dir := Dir()
	if dir == "" {
		return
	}
	paths := []string{
		filepath.Join(dir, ObserveFileName+".1"),
		filepath.Join(dir, ObserveFileName),
	}
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(bytes.NewReader(raw))
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			line := bytes.TrimSpace(sc.Bytes())
			if len(line) == 0 {
				continue
			}
			var ev Event
			if err := json.Unmarshal(line, &ev); err != nil {
				continue
			}
			if !fn(ev) {
				return
			}
		}
	}
}

func getObserveWriter() *rotatingWriter {
	dir := resolveLogDir()
	if dir == "" {
		return nil
	}
	observeMu.Lock()
	defer observeMu.Unlock()
	if observeW != nil && observeDir == dir {
		return observeW
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil
	}
	if observeW != nil {
		_ = observeW.close()
		observeW = nil
	}
	observeW = newRotatingWriter(filepath.Join(dir, ObserveFileName))
	observeDir = dir
	return observeW
}

func resetObserveWriter() {
	observeMu.Lock()
	defer observeMu.Unlock()
	if observeW != nil {
		_ = observeW.close()
		observeW = nil
		observeDir = ""
	}
}

// CloseObserve 关闭 observe.jsonl 句柄。切换会话目录或测试结束时调用，避免 Windows 下文件占用。
func CloseObserve() {
	resetObserveWriter()
}

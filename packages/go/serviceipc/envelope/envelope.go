// Package envelope 定义应用 IPC 的 JSON 信封（Named Pipe / UDS 上的契约层）。
//
// 传输仍是 4 字节小端长度前缀 + UTF-8 JSON（见 protocol 包）。本包只约束载荷形状：
// 保留既有 id / ok / error / result（result 为业务 JSON 再编码后的字符串，供 C++ 壳
// JsonGetString 取出），并追加 v / errorCode / traceId。禁止把 error 改成对象、禁止
// 把 result 改成嵌套对象。
package envelope

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Version 是当前信封协议版本。对端缺省 v 时按 0 解释（旧客户端）。
const Version = 1

// 稳定错误码（snake_case）。新增只加常量，勿改已有取值。
const (
	// CodeInternal 未分类失败。
	CodeInternal = "internal"
	// CodeMethodNotFound 方法名未注册。
	CodeMethodNotFound = "method_not_found"
	// CodeInvalidRequest 请求 JSON 无法解析。
	CodeInvalidRequest = "invalid_request"
	// CodeInvalidParams 参数缺失或非法。
	CodeInvalidParams = "invalid_params"
	// CodeCancelled 调用方取消或 context 取消。
	CodeCancelled = "cancelled"
	// CodeUnavailable 对端进程/管道不可用。
	CodeUnavailable = "unavailable"
	// CodeEngineMismatch 探测到错误的数据库引擎，须改用匹配的 ConnKind。
	CodeEngineMismatch = "engine_mismatch"
	// CodeTimeout 请求/查询超时（会话通常仍在）。
	CodeTimeout = "timeout"
	// CodeLost 传输层断开（会话已失效）。
	CodeLost = "lost"
)

// Request 是 Web/Shell → Platform / 能力服务的请求信封。
type Request struct {
	// V 为信封版本；旧端省略。
	V int `json:"v,omitempty"`
	// Method 为完整方法名，如 mysql.session.open。
	Method string `json:"method"`
	// Params 为原始参数对象，由各方法二次解析。
	Params json.RawMessage `json:"params"`
	// ID 为请求关联 id，原样回填到响应。
	ID string `json:"id"`
	// TraceID 为跨进程关联 id；省略时服务端用 ID。
	TraceID string `json:"traceId,omitempty"`
}

// Response 是回写给 Shell 的响应信封。
//
// Result 存放业务结果对象序列化后的 JSON 字符串（而非对象本身），线路上形如
// {"result":"{\"value\":\"dark\"}"}。
type Response struct {
	// V 为信封版本，成功与失败均写出。
	V int `json:"v"`
	// ID 回填请求 id。
	ID string `json:"id"`
	// OK 为成功标志。
	OK bool `json:"ok"`
	// Error 为人可读失败原因（必须是字符串，供壳层 JsonGetString）。
	Error string `json:"error,omitempty"`
	// ErrorCode 为稳定错误码；成功时省略。
	ErrorCode string `json:"errorCode,omitempty"`
	// TraceID 为跨进程关联 id。
	TraceID string `json:"traceId,omitempty"`
	// Result 为业务 JSON 的再编码字符串。
	Result string `json:"result"`
}

// Error 是带稳定错误码的远程 IPC 失败，Error() 仍返回人可读 Message。
type Error struct {
	// Code 为稳定错误码。
	Code string
	// Message 为人可读说明。
	Message string
	// TraceID 为跨进程关联 id。
	TraceID string
}

// Error 实现 error 接口，保持既有字符串匹配可用。
func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	if e.Message != "" {
		return e.Message
	}
	return e.Code
}

// InferCode 从既有错误文案推断稳定码（供未显式传码的调用方）。
func InferCode(message string) string {
	m := strings.TrimSpace(message)
	if m == "" {
		return CodeInternal
	}
	lower := strings.ToLower(m)
	switch {
	case strings.HasPrefix(lower, "method not found"):
		return CodeMethodNotFound
	case strings.HasPrefix(lower, "invalid request json"), strings.HasPrefix(lower, "invalid method"):
		return CodeInvalidRequest
	case strings.HasPrefix(lower, "invalid params"):
		return CodeInvalidParams
	case strings.Contains(lower, "context canceled"), lower == "cancelled":
		return CodeCancelled
	case strings.Contains(lower, "deadline exceeded"),
		strings.Contains(lower, "i/o timeout"),
		strings.Contains(lower, "timeout exceeded"),
		strings.Contains(lower, "wait timeout"):
		return CodeTimeout
	case strings.Contains(lower, "broken pipe"),
		strings.Contains(lower, "connection reset"),
		strings.Contains(lower, "connection refused"),
		strings.Contains(lower, "forcibly closed"),
		strings.Contains(lower, "use of closed network"),
		strings.Contains(lower, "invalid connection"),
		strings.Contains(lower, "driver: bad connection"),
		strings.Contains(lower, "unexpected eof"),
		strings.Contains(lower, "connection lost"),
		strings.Contains(lower, "wsasend"),
		strings.Contains(lower, "wsarecv"):
		return CodeLost
	case strings.Contains(lower, "unavailable"):
		return CodeUnavailable
	case strings.Contains(lower, "use mariadb connection kind"),
		strings.Contains(lower, "use the matching connection kind"):
		return CodeEngineMismatch
	default:
		return CodeInternal
	}
}

// ResolveTraceID 返回应写入响应的 trace id。
func ResolveTraceID(reqID, traceID string) string {
	if t := strings.TrimSpace(traceID); t != "" {
		return t
	}
	return strings.TrimSpace(reqID)
}

// OK 构造成功响应，result 序列化为 JSON 字符串。
func OK(id string, result any) Response {
	encoded, err := json.Marshal(result)
	if err != nil {
		return Fail(id, fmt.Sprintf("marshal result: %v", err))
	}
	return Normalize(Response{
		ID:     id,
		OK:     true,
		Result: string(encoded),
	})
}

// Fail 构造失败响应，错误码由文案推断。
func Fail(id, message string) Response {
	return FailCode(id, InferCode(message), message)
}

// FailCode 构造带显式错误码的失败响应。
func FailCode(id, code, message string) Response {
	if strings.TrimSpace(code) == "" {
		code = InferCode(message)
	}
	return Normalize(Response{
		ID:        id,
		OK:        false,
		Error:     message,
		ErrorCode: code,
		Result:    "",
	})
}

// FailEngineMismatch 构造引擎不匹配失败（Probe 拒接错误产品）。
func FailEngineMismatch(id string, err error) Response {
	msg := "engine mismatch"
	if err != nil {
		msg = err.Error()
	}
	return FailCode(id, CodeEngineMismatch, msg)
}

// Normalize 补齐 v / traceId / errorCode，不改变 result 与 error 的类型。
func Normalize(resp Response) Response {
	if resp.V == 0 {
		resp.V = Version
	}
	if strings.TrimSpace(resp.TraceID) == "" {
		resp.TraceID = resp.ID
	}
	if !resp.OK {
		if strings.TrimSpace(resp.ErrorCode) == "" {
			resp.ErrorCode = InferCode(resp.Error)
		}
		if resp.Result == "" {
			resp.Result = ""
		}
	}
	return resp
}

// WithRequest 把请求的 id / traceId 覆盖到响应上（请求 traceId 优先）。
func WithRequest(req Request, resp Response) Response {
	if strings.TrimSpace(resp.ID) == "" {
		resp.ID = req.ID
	}
	resp.TraceID = ResolveTraceID(req.ID, req.TraceID)
	return Normalize(resp)
}

// Marshal 序列化响应；失败时返回最小错误帧（含 v 与 errorCode）。
func Marshal(resp Response) []byte {
	resp = Normalize(resp)
	out, err := json.Marshal(resp)
	if err != nil {
		return []byte(`{"v":1,"ok":false,"error":"internal marshal error","errorCode":"internal","result":""}`)
	}
	return out
}

// UnmarshalError 把失败响应当成 envelope.Error。
func UnmarshalError(resp Response) error {
	if resp.OK {
		return nil
	}
	code := resp.ErrorCode
	if code == "" {
		code = InferCode(resp.Error)
	}
	msg := resp.Error
	if msg == "" {
		msg = "remote error"
	}
	return &Error{Code: code, Message: msg, TraceID: ResolveTraceID(resp.ID, resp.TraceID)}
}

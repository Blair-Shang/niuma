// Package handler 实现 api-service 的 IPC 方法分发。
//
// 套接字方法服务 TCP / UDP。HTTP 与 HTTPS 走 http.exchange，由 httpclient 完成 TLS、重定向和 Cookie。
package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"niuma/pkg/serviceipc/envelope"
	"niuma/services/api-service/internal/capture"
	"niuma/services/api-service/internal/codec"
	"niuma/services/api-service/internal/httpclient"
	"niuma/services/api-service/internal/mock"
	"niuma/services/api-service/internal/socket"
	"niuma/services/api-service/internal/wsclient"
)

// 能力服务内部方法名（platform-core 代理时映射为 api.*）。
const (
	MethodSessionOpen  = "session.open"
	MethodSessionClose = "session.close"
	MethodSessionTest  = "session.test"
	MethodSocketSend   = "socket.send"
	MethodSocketList   = "socket.list"
	MethodSocketPeers  = "socket.peers"
	MethodSocketKick   = "socket.kick"
	MethodHTTPExchange = "http.exchange"
	MethodHTTPCancel   = "http.cancel"
	MethodWSConnect    = "ws.connect"
	MethodWSSend       = "ws.send"
	MethodWSClose      = "ws.close"
	MethodMockStart    = "mock.start"
	MethodMockStop     = "mock.stop"
	MethodMockUpdate   = "mock.update"
	MethodMockLog      = "mock.log"
	MethodGrpcInvoke   = "grpc.invoke"
	MethodProxyStart   = "proxy.start"
	MethodProxyStop    = "proxy.stop"
	MethodProxyLog     = "proxy.log"
)

const errInvalidParamsFmt = "invalid params: %v"

type Request = envelope.Request

type Response = envelope.Response

// Emitter 上报套接字事件。
type Emitter interface {
	Emit(ev map[string]any)
}

type openParams struct {
	Kind         string `json:"kind"`
	Host         string `json:"host"`
	Port         int    `json:"port"`
	LocalHost    string `json:"localHost"`
	LocalPort    int    `json:"localPort"`
	TimeoutMs    int    `json:"timeoutMs"`
	Encoding     string `json:"encoding"`
	ReadLimit    int    `json:"readLimit"`
	Frame        string `json:"frame"`
	Delimiter    string `json:"delimiter"`
	LengthOffset int    `json:"lengthOffset"`
	LengthSize   int    `json:"lengthSize"`
	LengthEndian string `json:"lengthEndian"`
	LengthAdjust int    `json:"lengthAdjust"`
	HTTPMethod   string `json:"httpMethod"`
}

type sessionIDParams struct {
	SessionID string `json:"sessionId"`
}

type sendParams struct {
	SessionID string `json:"sessionId"`
	Data      string `json:"data"`
	Encoding  string `json:"encoding"`
	PeerID    string `json:"peerId"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
}

type kickParams struct {
	SessionID string `json:"sessionId"`
	PeerID    string `json:"peerId"`
}

// Dispatcher 管理套接字会话并处理方法。
type Dispatcher struct {
	sockets    *socket.Manager
	websockets *wsclient.Hub
	httpCancel *httpclient.Canceler
	mocks      *mock.Hub
	capture    *capture.Hub
}

// New 创建 Dispatcher。
func New(events Emitter) *Dispatcher {
	var emit func(map[string]any)
	if events != nil {
		emit = events.Emit
	}
	return &Dispatcher{
		sockets:    socket.NewManager(emit),
		websockets: wsclient.NewHub(emit),
		httpCancel: httpclient.NewCanceler(),
		mocks:      mock.NewHub(),
		capture:    capture.NewHub(),
	}
}

// HandleFrame 解析请求并返回响应 JSON 字节。
func (d *Dispatcher) HandleFrame(ctx context.Context, raw []byte) []byte {
	var req Request
	if err := json.Unmarshal(raw, &req); err != nil {
		return envelope.Marshal(envelope.Fail("", fmt.Sprintf("invalid request json: %v", err)))
	}
	return envelope.Marshal(envelope.WithRequest(req, d.dispatch(ctx, req)))
}

func (d *Dispatcher) dispatch(ctx context.Context, req Request) Response {
	switch req.Method {
	case MethodSessionOpen:
		return d.sessionOpen(ctx, req)
	case MethodSessionClose:
		return d.sessionClose(ctx, req)
	case MethodSessionTest:
		return d.sessionTest(ctx, req)
	case MethodSocketSend:
		return d.socketSend(ctx, req)
	case MethodSocketList:
		return d.socketList(ctx, req)
	case MethodSocketPeers:
		return d.socketPeers(ctx, req)
	case MethodSocketKick:
		return d.socketKick(ctx, req)
	case MethodHTTPExchange:
		return d.httpExchange(ctx, req)
	case MethodHTTPCancel:
		return d.httpCancelReq(req)
	case MethodWSConnect:
		return d.wsConnect(ctx, req)
	case MethodWSSend:
		return d.wsSend(ctx, req)
	case MethodWSClose:
		return d.wsClose(req)
	case MethodMockStart:
		return d.mockStart(req)
	case MethodMockStop:
		return d.mockStop(req)
	case MethodMockUpdate:
		return d.mockUpdate(req)
	case MethodMockLog:
		return d.mockLog(req)
	case MethodGrpcInvoke:
		return d.grpcInvoke(ctx, req)
	case MethodProxyStart:
		return d.proxyStart(req)
	case MethodProxyStop:
		return d.proxyStop(req)
	case MethodProxyLog:
		return d.proxyLog(req)
	default:
		return envelope.Fail(req.ID, "method not found: "+req.Method)
	}
}

func (d *Dispatcher) sessionOpen(ctx context.Context, req Request) Response {
	spec, err := parseOpenSpec(req.Params)
	if err != nil {
		return envelope.Fail(req.ID, err.Error())
	}
	info, err := d.sockets.Open(ctx, spec)
	if err != nil {
		slog.Error(MethodSessionOpen, "kind", spec.Kind, "host", spec.Host, "port", spec.Port, "err", err)
		return envelope.Fail(req.ID, err.Error())
	}
	slog.Info(MethodSessionOpen, "session", info.SessionID, "kind", info.Kind, "local", info.LocalAddr)
	return envelope.OK(req.ID, info)
}

func (d *Dispatcher) sessionClose(_ context.Context, req Request) Response {
	var params sessionIDParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return envelope.Fail(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if err := d.sockets.Close(params.SessionID); err != nil {
		return envelope.Fail(req.ID, err.Error())
	}
	slog.Info(MethodSessionClose, "session", params.SessionID)
	return envelope.OK(req.ID, map[string]any{"closed": true})
}

func (d *Dispatcher) sessionTest(ctx context.Context, req Request) Response {
	spec, err := parseOpenSpec(req.Params)
	if err != nil {
		return envelope.Fail(req.ID, err.Error())
	}
	message, err := d.sockets.Test(ctx, spec)
	if err != nil {
		return envelope.Fail(req.ID, err.Error())
	}
	return envelope.OK(req.ID, map[string]any{"ok": true, "message": message})
}

func (d *Dispatcher) socketSend(ctx context.Context, req Request) Response {
	var params sendParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return envelope.Fail(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	result, err := d.sockets.Send(ctx, socket.SendSpec{
		SessionID: params.SessionID,
		Data:      params.Data,
		Encoding:  codec.Normalize(params.Encoding),
		PeerID:    params.PeerID,
		Host:      params.Host,
		Port:      params.Port,
	})
	if err != nil {
		return envelope.Fail(req.ID, err.Error())
	}
	return envelope.OK(req.ID, result)
}

func (d *Dispatcher) socketList(_ context.Context, req Request) Response {
	return envelope.OK(req.ID, map[string]any{"sessions": d.sockets.List()})
}

func (d *Dispatcher) socketPeers(_ context.Context, req Request) Response {
	var params sessionIDParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return envelope.Fail(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	peers, err := d.sockets.Peers(params.SessionID)
	if err != nil {
		return envelope.Fail(req.ID, err.Error())
	}
	return envelope.OK(req.ID, map[string]any{"peers": peers})
}

func (d *Dispatcher) socketKick(_ context.Context, req Request) Response {
	var params kickParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return envelope.Fail(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if err := d.sockets.Kick(params.SessionID, params.PeerID); err != nil {
		return envelope.Fail(req.ID, err.Error())
	}
	return envelope.OK(req.ID, map[string]any{"kicked": true})
}

type httpHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type httpExchangeParams struct {
	CancelID        string                `json:"cancelId"`
	Method          string                `json:"method"`
	URL             string                `json:"url"`
	Headers         []httpHeader          `json:"headers"`
	Body            string                `json:"body"`
	TimeoutMs       int                   `json:"timeoutMs"`
	FollowRedirects *bool                 `json:"followRedirects"`
	Insecure        bool                  `json:"insecure"`
	Cookies         []httpclient.Cookie   `json:"cookies"`
	Parts           []httpclient.FormPart `json:"parts"`
	Proxy           string                `json:"proxy"`
	CertPath        string                `json:"certPath"`
	KeyPath         string                `json:"keyPath"`
	NtlmUser        string                `json:"ntlmUser"`
	NtlmPassword    string                `json:"ntlmPassword"`
	NtlmDomain      string                `json:"ntlmDomain"`
}

type httpCancelParams struct {
	CancelID string `json:"cancelId"`
}

func (d *Dispatcher) httpExchange(ctx context.Context, req Request) Response {
	var params httpExchangeParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return envelope.Fail(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	follow := true
	if params.FollowRedirects != nil {
		follow = *params.FollowRedirects
	}
	headers := make([]httpclient.Header, 0, len(params.Headers))
	for _, header := range params.Headers {
		headers = append(headers, httpclient.Header{Name: header.Name, Value: header.Value})
	}
	timeout := time.Duration(params.TimeoutMs) * time.Millisecond
	callCtx, stop := d.httpCancel.Start(ctx, params.CancelID, timeout)
	defer stop()
	result, err := httpclient.Exchange(callCtx, httpclient.ExchangeRequest{
		Method:          params.Method,
		URL:             params.URL,
		Headers:         headers,
		Body:            []byte(params.Body),
		Timeout:         timeout,
		FollowRedirects: follow,
		Insecure:        params.Insecure,
		Cookies:         params.Cookies,
		Parts:           params.Parts,
		Proxy:           params.Proxy,
		CertFile:        params.CertPath,
		KeyFile:         params.KeyPath,
		NtlmUser:        params.NtlmUser,
		NtlmPassword:    params.NtlmPassword,
		NtlmDomain:      params.NtlmDomain,
	})
	if err != nil {
		if errors.Is(err, httpclient.ErrCancelled) {
			return envelope.Fail(req.ID, "cancelled")
		}
		slog.Info(MethodHTTPExchange, "url", params.URL, "err", err)
		return envelope.Fail(req.ID, err.Error())
	}
	text, ok := httpclient.TextBody(result.Body)
	out := map[string]any{
		"status":     result.Status,
		"statusText": result.StatusText,
		"protocol":   result.Protocol,
		"finalUrl":   result.FinalURL,
		"headers":    result.Headers,
		"body":       text,
		"binary":     !ok,
		"sizeBytes":  len(result.Body),
		"durationMs": result.Duration.Milliseconds(),
		"redirects":  result.Redirects,
		"cookies":    result.Cookies,
	}
	if !ok {
		out["bodyBase64"] = base64.StdEncoding.EncodeToString(result.Body)
	}
	if result.Duration > 0 && result.Duration < time.Millisecond {
		out["durationMs"] = int64(1)
	}
	return envelope.OK(req.ID, out)
}

func (d *Dispatcher) httpCancelReq(req Request) Response {
	var params httpCancelParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return envelope.Fail(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	d.httpCancel.Cancel(params.CancelID)
	return envelope.OK(req.ID, map[string]any{"cancelled": true})
}

type wsHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type wsConnectParams struct {
	URL       string     `json:"url"`
	Headers   []wsHeader `json:"headers"`
	Protocols []string   `json:"protocols"`
	Insecure  bool       `json:"insecure"`
	Proxy     string     `json:"proxy"`
	CertPath  string     `json:"certPath"`
	KeyPath   string     `json:"keyPath"`
	TimeoutMs int        `json:"timeoutMs"`
}

type wsSendParams struct {
	SessionID string `json:"sessionId"`
	Data      string `json:"data"`
	Encoding  string `json:"encoding"`
}

func (d *Dispatcher) wsConnect(ctx context.Context, req Request) Response {
	var params wsConnectParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return envelope.Fail(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	headers := make([]wsclient.Header, 0, len(params.Headers))
	for _, header := range params.Headers {
		headers = append(headers, wsclient.Header{Name: header.Name, Value: header.Value})
	}
	info, err := d.websockets.Connect(ctx, wsclient.ConnectSpec{
		URL:       params.URL,
		Headers:   headers,
		Protocols: params.Protocols,
		Insecure:  params.Insecure,
		Proxy:     params.Proxy,
		CertFile:  params.CertPath,
		KeyFile:   params.KeyPath,
		Timeout:   time.Duration(params.TimeoutMs) * time.Millisecond,
	})
	if err != nil {
		return envelope.Fail(req.ID, err.Error())
	}
	return envelope.OK(req.ID, info)
}

func (d *Dispatcher) wsSend(ctx context.Context, req Request) Response {
	var params wsSendParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return envelope.Fail(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	n, err := d.websockets.Send(ctx, wsclient.SendSpec{
		SessionID: params.SessionID,
		Data:      params.Data,
		Encoding:  params.Encoding,
	})
	if err != nil {
		return envelope.Fail(req.ID, err.Error())
	}
	return envelope.OK(req.ID, map[string]any{"bytesSent": n})
}

func (d *Dispatcher) wsClose(req Request) Response {
	var params sessionIDParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return envelope.Fail(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if err := d.websockets.Close(params.SessionID); err != nil {
		return envelope.Fail(req.ID, err.Error())
	}
	return envelope.OK(req.ID, map[string]any{"closed": true})
}

type mockServerParams struct {
	ServerID string       `json:"serverId"`
	Host     string       `json:"host"`
	Port     int          `json:"port"`
	Routes   []mock.Route `json:"routes"`
}

func (d *Dispatcher) mockStart(req Request) Response {
	var params mockServerParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return envelope.Fail(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	started, err := d.mocks.Start(params.ServerID, params.Host, params.Port, params.Routes)
	if err != nil {
		return envelope.Fail(req.ID, err.Error())
	}
	return envelope.OK(req.ID, started)
}

func (d *Dispatcher) mockStop(req Request) Response {
	var params mockServerParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return envelope.Fail(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if err := d.mocks.Stop(params.ServerID); err != nil {
		return envelope.Fail(req.ID, err.Error())
	}
	return envelope.OK(req.ID, map[string]any{"stopped": true})
}

func (d *Dispatcher) mockUpdate(req Request) Response {
	var params mockServerParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return envelope.Fail(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if err := d.mocks.Update(params.ServerID, params.Routes); err != nil {
		return envelope.Fail(req.ID, err.Error())
	}
	return envelope.OK(req.ID, map[string]any{"updated": true})
}

func (d *Dispatcher) mockLog(req Request) Response {
	var params mockServerParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return envelope.Fail(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	hits := d.mocks.Log(params.ServerID)
	if hits == nil {
		hits = []mock.Hit{}
	}
	return envelope.OK(req.ID, map[string]any{"hits": hits})
}

func delimiterBytes(name string) []byte {
	switch name {
	case "lf":
		return []byte{'\n'}
	case "cr":
		return []byte{'\r'}
	case "crlf":
		return []byte{'\r', '\n'}
	default:
		return nil
	}
}

func parseOpenSpec(raw json.RawMessage) (socket.OpenSpec, error) {
	if len(raw) == 0 {
		return socket.OpenSpec{}, fmt.Errorf(errInvalidParamsFmt, "empty")
	}
	var params openParams
	if err := json.Unmarshal(raw, &params); err != nil {
		return socket.OpenSpec{}, fmt.Errorf(errInvalidParamsFmt, err)
	}
	spec := socket.OpenSpec{
		Kind:      socket.Kind(params.Kind),
		Host:      params.Host,
		Port:      params.Port,
		LocalHost: params.LocalHost,
		LocalPort: params.LocalPort,
		Encoding:  codec.Normalize(params.Encoding),
		ReadLimit: params.ReadLimit,
		Frame: socket.FrameSpec{
			Mode:         socket.FrameMode(params.Frame),
			Delimiter:    delimiterBytes(params.Delimiter),
			LengthOffset: params.LengthOffset,
			LengthSize:   params.LengthSize,
			LittleEndian: params.LengthEndian == "little",
			LengthAdjust: params.LengthAdjust,
			HTTPMethod:   params.HTTPMethod,
		},
	}
	if params.TimeoutMs > 0 {
		spec.Timeout = time.Duration(params.TimeoutMs) * time.Millisecond
	}
	return spec, nil
}

type grpcInvokeParams struct {
	URL       string       `json:"url"`
	Method    string       `json:"method"`
	Body      string       `json:"body"`
	TimeoutMs int          `json:"timeoutMs"`
	Insecure  bool         `json:"insecure"`
	Proxy     string       `json:"proxy"`
	Headers   []httpHeader `json:"headers"`
}

func (d *Dispatcher) grpcInvoke(ctx context.Context, req Request) Response {
	var params grpcInvokeParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return envelope.Fail(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	headers := make([]httpclient.Header, 0, len(params.Headers))
	for _, header := range params.Headers {
		headers = append(headers, httpclient.Header{Name: header.Name, Value: header.Value})
	}
	result, err := httpclient.InvokeGrpc(ctx, httpclient.GrpcRequest{
		URL:      params.URL,
		Method:   params.Method,
		Body:     params.Body,
		Timeout:  time.Duration(params.TimeoutMs) * time.Millisecond,
		Insecure: params.Insecure,
		Proxy:    params.Proxy,
		Headers:  headers,
	})
	if err != nil {
		return envelope.Fail(req.ID, err.Error())
	}
	return envelope.OK(req.ID, result)
}

type proxyStartParams struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}

func (d *Dispatcher) proxyStart(req Request) Response {
	var params proxyStartParams
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return envelope.Fail(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
		}
	}
	started, err := d.capture.Start(params.Host, params.Port)
	if err != nil {
		return envelope.Fail(req.ID, err.Error())
	}
	return envelope.OK(req.ID, started)
}

func (d *Dispatcher) proxyStop(req Request) Response {
	if err := d.capture.Stop(); err != nil {
		return envelope.Fail(req.ID, err.Error())
	}
	return envelope.OK(req.ID, map[string]any{"stopped": true})
}

func (d *Dispatcher) proxyLog(req Request) Response {
	return envelope.OK(req.ID, map[string]any{"entries": d.capture.Log()})
}


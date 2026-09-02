// Package handler 实现 api-service 的 IPC 方法分发。
//
// 本期只暴露原始套接字：TCP 客户端、TCP 监听、UDP 绑定。应用层 HTTP 后续再加。
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"niuma/pkg/serviceipc/envelope"
	"niuma/services/api-service/internal/codec"
	"niuma/services/api-service/internal/socket"
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
)

const errInvalidParamsFmt = "invalid params: %v"

type Request = envelope.Request

type Response = envelope.Response

// Emitter 上报套接字事件。
type Emitter interface {
	Emit(ev map[string]any)
}

type openParams struct {
	Kind      string `json:"kind"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	LocalHost string `json:"localHost"`
	LocalPort int    `json:"localPort"`
	TimeoutMs int    `json:"timeoutMs"`
	Encoding  string `json:"encoding"`
	ReadLimit int    `json:"readLimit"`
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
	sockets *socket.Manager
}

// New 创建 Dispatcher。
func New(events Emitter) *Dispatcher {
	var emit socket.Emitter
	if events != nil {
		emit = events.Emit
	}
	return &Dispatcher{sockets: socket.NewManager(emit)}
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
	}
	if params.TimeoutMs > 0 {
		spec.Timeout = time.Duration(params.TimeoutMs) * time.Millisecond
	}
	return spec, nil
}

package socket

import (
	"time"

	"niuma/services/api-service/internal/codec"
)

// Kind 是套接字角色，对齐 Packet Sender / Hercules：客户端、监听端、数据报。
type Kind string

const (
	// KindTCPClient 主动拨号的 TCP 连接，建连后可读可写。
	KindTCPClient Kind = "tcp-client"
	// KindTCPServer 在本机端口监听，接受多个对端。
	KindTCPServer Kind = "tcp-server"
	// KindUDP 绑定本机 UDP 端口，可向任意目的发送并接收数据报。
	KindUDP Kind = "udp"
)

// State 是会话或对端的生命周期状态。
type State string

const (
	// StateConnected TCP 客户端已建连，或 UDP 已绑定且带默认发送目的。
	StateConnected State = "connected"
	// StateListening TCP 服务端已监听，或 UDP 仅绑定本机（无默认对端）。
	StateListening State = "listening"
	// StateAccepted TCP 服务端接受了一条对端连接。
	StateAccepted State = "accepted"
	// StateClosed 调用方主动关闭。
	StateClosed State = "closed"
	// StateLost 对端断开或传输失败。
	StateLost State = "lost"
)

// Direction 是报文方向。
type Direction string

const (
	// DirIn 从网络收到。
	DirIn Direction = "in"
	// DirOut 向网络写出。
	DirOut Direction = "out"
)

const (
	// MaxPayload 单次发送/读取上限（1 MiB）。
	MaxPayload = 1 << 20
	// DefaultRead 默认读缓冲（64 KiB）。
	DefaultRead = 64 << 10
	// MaxSessions 进程内同时存活的套接字会话上限。
	MaxSessions = 64
	// MaxPeers 单个 TCP 监听允许的对端上限。
	MaxPeers = 256
	// DefaultTimeout 拨号默认超时。
	DefaultTimeout = 10 * time.Second
)

// OpenSpec 打开一条套接字会话。
type OpenSpec struct {
	Kind      Kind
	Host      string
	Port      int
	LocalHost string
	LocalPort int
	Timeout   time.Duration
	Encoding  codec.Encoding
	ReadLimit int
}

// SendSpec 在已打开的会话上发送一帧。
type SendSpec struct {
	SessionID string
	Data      string
	Encoding  codec.Encoding
	PeerID    string
	Host      string
	Port      int
}

// SendResult 是一次发送的回执。
type SendResult struct {
	BytesSent  int       `json:"bytesSent"`
	At         time.Time `json:"at"`
	PeerID     string    `json:"peerId,omitempty"`
	RemoteAddr string    `json:"remoteAddr,omitempty"`
}

// SessionInfo 是会话快照，供 list / open 返回。
type SessionInfo struct {
	SessionID  string         `json:"sessionId"`
	Kind       Kind           `json:"kind"`
	State      State          `json:"state"`
	Host       string         `json:"host,omitempty"`
	Port       int            `json:"port,omitempty"`
	LocalAddr  string         `json:"localAddr,omitempty"`
	RemoteAddr string         `json:"remoteAddr,omitempty"`
	Encoding   codec.Encoding `json:"encoding"`
	OpenedAt   time.Time      `json:"openedAt"`
	PeerCount  int            `json:"peerCount"`
}

// PeerInfo 是 TCP 监听下的一条已接受连接。
type PeerInfo struct {
	PeerID      string    `json:"peerId"`
	RemoteAddr  string    `json:"remoteAddr"`
	LocalAddr   string    `json:"localAddr,omitempty"`
	ConnectedAt time.Time `json:"connectedAt"`
}

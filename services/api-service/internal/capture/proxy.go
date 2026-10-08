// Package capture 是本机正向代理。只监听 127.0.0.1，记录经过它的 HTTP 请求。
// HTTPS 只记录 CONNECT 的目标主机，不解密。
package capture

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	maxEntries = 200
	maxBody    = 1 << 20
)

// Header 是抓到的一条头。
type Header struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// Entry 是一条经过代理的请求。
type Entry struct {
	ID      string   `json:"id"`
	Method  string   `json:"method"`
	URL     string   `json:"url"`
	Headers []Header `json:"headers"`
	Body    string   `json:"body"`
	At      string   `json:"at"`
}

// StartResult 是监听地址。
type StartResult struct {
	ListenAddr string `json:"listenAddr"`
	Port       int    `json:"port"`
}

// Hub 同时只跑一个本机代理。
type Hub struct {
	mu       sync.Mutex
	server   *http.Server
	listener net.Listener
	entries  []Entry
	seq      int
}

// NewHub 创建代理表。
func NewHub() *Hub {
	return &Hub{}
}

// Start 在 127.0.0.1 上监听。host 只接受本机地址。
func (h *Hub) Start(host string, port int) (StartResult, error) {
	host, err := localHost(host)
	if err != nil {
		return StartResult{}, err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.server != nil {
		return StartResult{}, fmt.Errorf("capture: already listening")
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("%s:%d", host, port))
	if err != nil {
		return StartResult{}, fmt.Errorf("capture: %w", err)
	}
	h.listener = ln
	h.entries = nil
	h.server = &http.Server{Handler: h}
	go func() { _ = h.server.Serve(ln) }()
	tcp, _ := ln.Addr().(*net.TCPAddr)
	return StartResult{ListenAddr: ln.Addr().String(), Port: tcp.Port}, nil
}

// Stop 关闭代理。
func (h *Hub) Stop() error {
	h.mu.Lock()
	srv := h.server
	h.server = nil
	h.listener = nil
	h.mu.Unlock()
	if srv == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return srv.Shutdown(ctx)
}

// Log 返回已抓到的请求。
func (h *Hub) Log() []Entry {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]Entry, len(h.entries))
	copy(out, h.entries)
	return out
}

func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodConnect {
		h.record(r.Method, "https://"+r.Host, nil, "")
		h.tunnel(w, r)
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, maxBody))
	_ = r.Body.Close()
	target := r.URL.String()
	if !r.URL.IsAbs() {
		target = "http://" + r.Host + r.URL.RequestURI()
	}
	headers := make([]Header, 0, len(r.Header))
	for key, values := range r.Header {
		if hop(key) {
			continue
		}
		headers = append(headers, Header{Name: key, Value: strings.Join(values, ", ")})
	}
	h.record(r.Method, target, headers, string(body))
	req, err := http.NewRequestWithContext(r.Context(), r.Method, target, strings.NewReader(string(body)))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	for _, header := range headers {
		req.Header.Add(header.Name, header.Value)
	}
	resp, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (h *Hub) tunnel(w http.ResponseWriter, r *http.Request) {
	dest, err := net.Dial("tcp", r.Host)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	hijack, ok := w.(http.Hijacker)
	if !ok {
		_ = dest.Close()
		http.Error(w, "capture: hijack unsupported", http.StatusInternalServerError)
		return
	}
	client, _, err := hijack.Hijack()
	if err != nil {
		_ = dest.Close()
		return
	}
	_, _ = client.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))
	go func() { _, _ = io.Copy(dest, client); _ = dest.Close() }()
	_, _ = io.Copy(client, dest)
	_ = client.Close()
}

func (h *Hub) record(method, target string, headers []Header, body string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.seq++
	h.entries = append(h.entries, Entry{
		ID:      fmt.Sprintf("cap-%d", h.seq),
		Method:  method,
		URL:     target,
		Headers: headers,
		Body:    body,
		At:      time.Now().UTC().Format(time.RFC3339),
	})
	if len(h.entries) > maxEntries {
		h.entries = h.entries[len(h.entries)-maxEntries:]
	}
}

func localHost(host string) (string, error) {
	host = strings.TrimSpace(host)
	if host == "" || strings.EqualFold(host, "localhost") {
		return "127.0.0.1", nil
	}
	if host == "127.0.0.1" {
		return host, nil
	}
	return "", fmt.Errorf("capture: host must be 127.0.0.1")
}

func hop(name string) bool {
	switch strings.ToLower(name) {
	case "proxy-connection", "proxy-authorization", "connection":
		return true
	default:
		return false
	}
}

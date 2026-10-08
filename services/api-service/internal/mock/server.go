package mock

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	maxServers = 4
	maxRoutes  = 512
	maxBody    = 1 << 20
	maxHits    = 100
)

// Header 是 Mock 响应头。
type Header struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// Route 是一条固定响应。
type Route struct {
	ID      string   `json:"id"`
	Method  string   `json:"method"`
	Path    string   `json:"path"`
	Match   string   `json:"match"`
	Status  int      `json:"status"`
	Headers []Header `json:"headers"`
	Body    string   `json:"body"`
	DelayMs int      `json:"delayMs"`
	Script  string   `json:"script"`
}

// Hit 是最近一次命中或未命中。
type Hit struct {
	At      string `json:"at"`
	Method  string `json:"method"`
	Path    string `json:"path"`
	RouteID string `json:"routeId,omitempty"`
	Status  int    `json:"status"`
	Matched bool   `json:"matched"`
}

// StartResult 是监听地址。
type StartResult struct {
	ServerID   string `json:"serverId"`
	ListenAddr string `json:"listenAddr"`
	Port       int    `json:"port"`
}

// Hub 管理本机 Mock HTTP 服务。
type Hub struct {
	mu      sync.Mutex
	servers map[string]*runtime
}

type runtime struct {
	id     string
	ln     net.Listener
	srv    *http.Server
	mu     sync.RWMutex
	routes []Route
	hits   []Hit
}

// NewHub 创建 Mock 表。
func NewHub() *Hub {
	return &Hub{servers: map[string]*runtime{}}
}

// Start 在本机端口监听。host 只允许 127.0.0.1、localhost、0.0.0.0。
func (h *Hub) Start(serverID, host string, port int, routes []Route) (StartResult, error) {
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return StartResult{}, fmt.Errorf("mock: server id required")
	}
	host, err := normalizeHost(host)
	if err != nil {
		return StartResult{}, err
	}
	if port < 0 || port > 65535 {
		return StartResult{}, fmt.Errorf("mock: invalid port")
	}
	routes, err = normalizeRoutes(routes)
	if err != nil {
		return StartResult{}, err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if old := h.servers[serverID]; old != nil {
		_ = old.shutdown()
		delete(h.servers, serverID)
	}
	if len(h.servers) >= maxServers {
		return StartResult{}, fmt.Errorf("mock: too many servers")
	}
	ln, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return StartResult{}, fmt.Errorf("mock: %w", err)
	}
	rt := &runtime{id: serverID, ln: ln, routes: routes}
	rt.srv = &http.Server{Handler: rt, ReadHeaderTimeout: 5 * time.Second}
	h.servers[serverID] = rt
	go func() { _ = rt.srv.Serve(ln) }()
	tcp, _ := ln.Addr().(*net.TCPAddr)
	got := port
	if tcp != nil {
		got = tcp.Port
	}
	return StartResult{ServerID: serverID, ListenAddr: ln.Addr().String(), Port: got}, nil
}

// Update 热更新路由。
func (h *Hub) Update(serverID string, routes []Route) error {
	routes, err := normalizeRoutes(routes)
	if err != nil {
		return err
	}
	h.mu.Lock()
	rt := h.servers[strings.TrimSpace(serverID)]
	h.mu.Unlock()
	if rt == nil {
		return fmt.Errorf("mock: server not running")
	}
	rt.mu.Lock()
	rt.routes = routes
	rt.mu.Unlock()
	return nil
}

// Stop 关闭监听。
func (h *Hub) Stop(serverID string) error {
	h.mu.Lock()
	rt := h.servers[strings.TrimSpace(serverID)]
	if rt != nil {
		delete(h.servers, strings.TrimSpace(serverID))
	}
	h.mu.Unlock()
	if rt == nil {
		return nil
	}
	return rt.shutdown()
}

// Log 返回最近命中。
func (h *Hub) Log(serverID string) []Hit {
	h.mu.Lock()
	rt := h.servers[strings.TrimSpace(serverID)]
	h.mu.Unlock()
	if rt == nil {
		return nil
	}
	rt.mu.RLock()
	defer rt.mu.RUnlock()
	out := make([]Hit, len(rt.hits))
	copy(out, rt.hits)
	return out
}

func (rt *runtime) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rt.mu.RLock()
	routes := append([]Route(nil), rt.routes...)
	rt.mu.RUnlock()
	route, ok := matchRoute(r.Method, r.URL.Path, routes)
	if !ok {
		body, _ := json.Marshal(map[string]string{"error": "mock not found"})
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write(body)
		rt.record(Hit{At: time.Now().UTC().Format(time.RFC3339), Method: r.Method, Path: r.URL.Path, Status: http.StatusNotFound})
		return
	}
	if route.DelayMs > 0 {
		timer := time.NewTimer(time.Duration(route.DelayMs) * time.Millisecond)
		select {
		case <-timer.C:
		case <-r.Context().Done():
			timer.Stop()
			return
		}
	}
	status, body := renderRoute(route, r)
	for _, header := range route.Headers {
		if strings.TrimSpace(header.Name) != "" {
			w.Header().Add(header.Name, expandMock(header.Value, r))
		}
	}
	if status < 100 {
		status = http.StatusOK
	}
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
	rt.record(Hit{At: time.Now().UTC().Format(time.RFC3339), Method: r.Method, Path: r.URL.Path, RouteID: route.ID, Status: status, Matched: true})
}

func (rt *runtime) record(hit Hit) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	rt.hits = append(rt.hits, hit)
	if len(rt.hits) > maxHits {
		rt.hits = rt.hits[len(rt.hits)-maxHits:]
	}
}

func (rt *runtime) shutdown() error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return rt.srv.Shutdown(ctx)
}

func renderRoute(route Route, r *http.Request) (int, string) {
	status := route.Status
	source := route.Body
	if strings.TrimSpace(route.Script) != "" {
		source = route.Script
		if line, rest, ok := strings.Cut(source, "\n"); ok && strings.HasPrefix(strings.TrimSpace(line), "@status") {
			if n, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "@status"))); err == nil {
				status = n
			}
			source = rest
		}
	}
	raw, _ := io.ReadAll(io.LimitReader(r.Body, maxBody))
	_ = r.Body.Close()
	return status, expandMockText(source, r, string(raw))
}

func expandMock(text string, r *http.Request) string {
	return expandMockText(text, r, "")
}

func expandMockText(text string, r *http.Request, body string) string {
	replacer := strings.NewReplacer(
		"{{req.method}}", r.Method,
		"{{req.path}}", r.URL.Path,
		"{{req.body}}", body,
	)
	text = replacer.Replace(text)
	for key, values := range r.URL.Query() {
		text = strings.ReplaceAll(text, "{{req.query."+key+"}}", strings.Join(values, ","))
	}
	for key, values := range r.Header {
		text = strings.ReplaceAll(text, "{{req.header."+key+"}}", strings.Join(values, ","))
	}
	return text
}

func matchRoute(method, path string, routes []Route) (Route, bool) {
	method = strings.ToUpper(strings.TrimSpace(method))
	path = strings.TrimSpace(path)
	if path == "" {
		path = "/"
	}
	for _, route := range routes {
		if !methodMatches(method, route.Method) {
			continue
		}
		routePath := strings.TrimSpace(route.Path)
		if routePath == "" {
			routePath = "/"
		}
		if route.Match == "prefix" {
			if strings.HasPrefix(path, routePath) {
				return route, true
			}
			continue
		}
		if path == routePath {
			return route, true
		}
	}
	return Route{}, false
}

func methodMatches(got, want string) bool {
	want = strings.ToUpper(strings.TrimSpace(want))
	return want == "" || want == "*" || want == got
}

func normalizeHost(host string) (string, error) {
	host = strings.TrimSpace(host)
	if host == "" || strings.EqualFold(host, "localhost") {
		return "127.0.0.1", nil
	}
	if host == "127.0.0.1" || host == "0.0.0.0" {
		return host, nil
	}
	return "", fmt.Errorf("mock: host must be 127.0.0.1 or 0.0.0.0")
}

func normalizeRoutes(routes []Route) ([]Route, error) {
	if len(routes) > maxRoutes {
		return nil, fmt.Errorf("mock: too many routes")
	}
	out := make([]Route, 0, len(routes))
	for _, route := range routes {
		if len(route.Body) > maxBody {
			return nil, fmt.Errorf("mock: body exceeds %d bytes", maxBody)
		}
		if route.Match != "prefix" {
			route.Match = "exact"
		}
		if route.DelayMs < 0 {
			route.DelayMs = 0
		}
		if route.DelayMs > 30000 {
			route.DelayMs = 30000
		}
		out = append(out, route)
	}
	return out, nil
}

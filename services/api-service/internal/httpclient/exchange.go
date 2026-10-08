// Package httpclient 用标准库发起 HTTP/1.1 与 HTTP/2 请求。
//
// TLS、重定向和 Cookie 都在这里完成。明文 TCP 拼包不再承担 HTTP 发送。
package httpclient

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"niuma/services/api-service/internal/http11"
)

const (
	defaultTimeout = 30 * time.Second
	maxTimeout     = 5 * time.Minute
	maxRedirects   = 10
	maxBody        = 8 << 20
)

// ErrCancelled 表示调用方取消了这次发送。
var ErrCancelled = errors.New("cancelled")

// Header 是一条头。
type Header struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// Redirect 是跟随重定向时记下的一跳。
type Redirect struct {
	Status int    `json:"status"`
	URL    string `json:"url"`
}

// ExchangeRequest 是一次 HTTP 调用。
type ExchangeRequest struct {
	Method          string
	URL             string
	Headers         []Header
	Body            []byte
	Parts           []FormPart
	Timeout         time.Duration
	FollowRedirects bool
	Insecure        bool
	Cookies         []Cookie
	Proxy           string
	CertFile        string
	KeyFile         string
	NtlmUser        string
	NtlmPassword    string
	NtlmDomain      string
}

// ExchangeResult 是最终响应。正文已解开 gzip / deflate。
type ExchangeResult struct {
	Status     int
	StatusText string
	Protocol   string
	FinalURL   string
	Headers    []Header
	Body       []byte
	Duration   time.Duration
	Redirects  []Redirect
	Cookies    []Cookie
}

// Canceler 按 cancelId 中断进行中的请求。
type Canceler struct {
	mu    sync.Mutex
	slots map[string]cancelSlot
	seq   int64
}

type cancelSlot struct {
	token  int64
	cancel context.CancelFunc
}

// NewCanceler 创建取消表。
func NewCanceler() *Canceler {
	return &Canceler{slots: map[string]cancelSlot{}}
}

// Start 给这次请求加超时，并登记 cancelId。
func (c *Canceler) Start(parent context.Context, id string, timeout time.Duration) (context.Context, context.CancelFunc) {
	if parent == nil {
		parent = context.Background()
	}
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	if timeout > maxTimeout {
		timeout = maxTimeout
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	id = strings.TrimSpace(id)
	if id == "" || c == nil {
		return ctx, cancel
	}
	c.mu.Lock()
	c.seq++
	token := c.seq
	if old, ok := c.slots[id]; ok {
		old.cancel()
	}
	c.slots[id] = cancelSlot{token: token, cancel: cancel}
	c.mu.Unlock()
	return ctx, func() {
		cancel()
		c.mu.Lock()
		if cur, ok := c.slots[id]; ok && cur.token == token {
			delete(c.slots, id)
		}
		c.mu.Unlock()
	}
}

// Cancel 中断登记过的请求。
func (c *Canceler) Cancel(id string) {
	if c == nil {
		return
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return
	}
	c.mu.Lock()
	slot, ok := c.slots[id]
	if ok {
		delete(c.slots, id)
	}
	c.mu.Unlock()
	if ok {
		slot.cancel()
	}
}

// Exchange 发出请求并返回最终响应。
func Exchange(ctx context.Context, spec ExchangeRequest) (*ExchangeResult, error) {
	target, err := url.Parse(strings.TrimSpace(spec.URL))
	if err != nil || target.Scheme == "" || target.Host == "" {
		return nil, fmt.Errorf("http: invalid url")
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		return nil, fmt.Errorf("http: unsupported scheme %s", target.Scheme)
	}
	method := strings.ToUpper(strings.TrimSpace(spec.Method))
	if method == "" {
		method = http.MethodGet
	}
	payload := spec.Body
	formType := ""
	if len(spec.Parts) > 0 && method != http.MethodGet && method != http.MethodHead {
		payload, formType, err = BuildMultipart(spec.Parts)
		if err != nil {
			return nil, err
		}
	}
	var body io.Reader
	if len(payload) > 0 && method != http.MethodGet && method != http.MethodHead {
		if len(payload) > maxBody {
			return nil, fmt.Errorf("http: request exceeds %d bytes", maxBody)
		}
		body = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, target.String(), body)
	if err != nil {
		return nil, fmt.Errorf("http: %w", err)
	}
	hasAcceptEncoding := false
	for _, header := range spec.Headers {
		name := strings.TrimSpace(header.Name)
		if name == "" || hopByHop(name) || strings.EqualFold(name, "Content-Length") {
			continue
		}
		if strings.EqualFold(name, "Host") {
			req.Host = strings.TrimSpace(header.Value)
			continue
		}
		if formType != "" && strings.EqualFold(name, "Content-Type") {
			continue
		}
		if strings.EqualFold(name, "Accept-Encoding") {
			hasAcceptEncoding = true
		}
		req.Header.Add(name, header.Value)
	}
	if !hasAcceptEncoding {
		req.Header.Set("Accept-Encoding", http11.AcceptEncoding)
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", http11.UserAgent)
	}
	if formType != "" {
		req.Header.Set("Content-Type", formType)
	}

	jar := NewJar()
	jar.Seed(spec.Cookies)
	redirects := make([]Redirect, 0)
	transport, err := newTransport(spec)
	if err != nil {
		return nil, err
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport: transport,
		Jar:       jar,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if !spec.FollowRedirects {
				return http.ErrUseLastResponse
			}
			if len(via) >= maxRedirects {
				return fmt.Errorf("http: stopped after %d redirects", maxRedirects)
			}
			if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
				return fmt.Errorf("http: refuse redirect to %s", req.URL.Scheme)
			}
			if resp := req.Response; resp != nil {
				redirects = append(redirects, Redirect{Status: resp.StatusCode, URL: req.URL.String()})
			}
			return nil
		},
	}
	started := time.Now()
	var resp *http.Response
	if strings.TrimSpace(spec.NtlmUser) != "" {
		resp, err = doNTLM(ctx, client, req, spec, payload)
	} else {
		resp, err = client.Do(req)
	}
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return nil, ErrCancelled
		}
		return nil, fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return nil, fmt.Errorf("http: read body: %w", err)
	}
	if len(raw) > maxBody {
		return nil, fmt.Errorf("http: response exceeds %d bytes", maxBody)
	}
	encoding := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Encoding")))
	decoded, err := http11.DecodeBody(raw, encoding)
	if err != nil {
		return nil, err
	}
	headers := responseHeaders(resp.Header, len(decoded))
	finalURL := target.String()
	if resp.Request != nil && resp.Request.URL != nil {
		finalURL = resp.Request.URL.String()
	}
	return &ExchangeResult{
		Status:     resp.StatusCode,
		StatusText: statusText(resp),
		Protocol:   resp.Proto,
		FinalURL:   finalURL,
		Headers:    headers,
		Body:       decoded,
		Duration:   time.Since(started),
		Redirects:  redirects,
		Cookies:    jar.Snapshot(),
	}, nil
}

func responseHeaders(src http.Header, bodyLen int) []Header {
	out := make([]Header, 0, len(src)+1)
	for key, values := range src {
		switch strings.ToLower(key) {
		case "content-encoding", "content-length", "transfer-encoding":
			continue
		case "set-cookie":
			for _, value := range values {
				out = append(out, Header{Name: key, Value: value})
			}
		default:
			out = append(out, Header{Name: key, Value: strings.Join(values, ", ")})
		}
	}
	out = append(out, Header{Name: "Content-Length", Value: strconv.Itoa(bodyLen)})
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name == out[j].Name {
			return out[i].Value < out[j].Value
		}
		return out[i].Name < out[j].Name
	})
	return out
}

func statusText(resp *http.Response) string {
	text := strings.TrimSpace(strings.TrimPrefix(resp.Status, strconv.Itoa(resp.StatusCode)))
	if text == "" {
		return http.StatusText(resp.StatusCode)
	}
	return text
}

func hopByHop(name string) bool {
	switch strings.ToLower(name) {
	case "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer":
		return true
	default:
		return false
	}
}

// TextBody 在正文是合法 UTF-8 时返回文本。
func TextBody(body []byte) (string, bool) {
	if utf8.Valid(body) {
		return string(body), true
	}
	return "", false
}

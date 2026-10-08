package httpclient

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// GrpcRequest 是一次 JSON codec 的 unary 调用。
type GrpcRequest struct {
	URL      string
	Method   string
	Body     string
	Timeout  time.Duration
	Insecure bool
	Proxy    string
	Headers  []Header
}

// GrpcResult 是解开 gRPC 帧之后的 JSON 正文和 grpc-status。
type GrpcResult struct {
	Status     int      `json:"status"`
	Message    string   `json:"message"`
	Body       string   `json:"body"`
	Headers    []Header `json:"headers"`
	HTTPStatus int      `json:"httpStatus"`
	DurationMs int64    `json:"durationMs"`
}

// InvokeGrpc 用 application/grpc+json 调用 unary 方法。明文 http 不是 HTTP/2，调用会失败。
func InvokeGrpc(ctx context.Context, spec GrpcRequest) (*GrpcResult, error) {
	target := strings.TrimRight(strings.TrimSpace(spec.URL), "/")
	method := strings.Trim(strings.TrimSpace(spec.Method), "/")
	if target == "" || method == "" {
		return nil, fmt.Errorf("grpc: url and method are required")
	}
	if !strings.Contains(target, "://") {
		target = "https://" + target
	}
	frame := frameGrpc([]byte(spec.Body))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target+"/"+method, bytes.NewReader(frame))
	if err != nil {
		return nil, fmt.Errorf("grpc: %w", err)
	}
	req.Header.Set("Content-Type", "application/grpc+json")
	req.Header.Set("TE", "trailers")
	for _, header := range spec.Headers {
		name := strings.TrimSpace(header.Name)
		if name == "" || hopByHop(name) {
			continue
		}
		req.Header.Set(name, header.Value)
	}
	transport, err := newTransport(ExchangeRequest{Insecure: spec.Insecure, Proxy: spec.Proxy})
	if err != nil {
		return nil, err
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport}
	if spec.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, spec.Timeout)
		defer cancel()
		req = req.WithContext(ctx)
	}
	started := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("grpc: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return nil, fmt.Errorf("grpc: read body: %w", err)
	}
	body := unframeGrpc(raw)
	status, message := grpcStatus(resp)
	headers := responseHeaders(resp.Header, len(body))
	for key, values := range resp.Trailer {
		headers = append(headers, Header{Name: key, Value: strings.Join(values, ", ")})
	}
	return &GrpcResult{
		Status:     status,
		Message:    message,
		Body:       string(body),
		Headers:    headers,
		HTTPStatus: resp.StatusCode,
		DurationMs: time.Since(started).Milliseconds(),
	}, nil
}

func frameGrpc(payload []byte) []byte {
	frame := make([]byte, 5+len(payload))
	binary.BigEndian.PutUint32(frame[1:], uint32(len(payload)))
	copy(frame[5:], payload)
	return frame
}

func unframeGrpc(raw []byte) []byte {
	if len(raw) < 5 {
		return raw
	}
	size := binary.BigEndian.Uint32(raw[1:5])
	if int(size)+5 > len(raw) {
		return raw
	}
	return raw[5 : 5+size]
}

func grpcStatus(resp *http.Response) (int, string) {
	status := resp.Trailer.Get("Grpc-Status")
	message := resp.Trailer.Get("Grpc-Message")
	if status == "" {
		status = resp.Header.Get("Grpc-Status")
		message = resp.Header.Get("Grpc-Message")
	}
	if status == "" {
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return 0, ""
		}
		return resp.StatusCode, resp.Status
	}
	n := 0
	fmt.Sscanf(status, "%d", &n)
	return n, message
}

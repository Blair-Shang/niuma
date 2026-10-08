package httpclient

import (
	"crypto/tls"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// newTransport 组装这一次请求的传输：系统代理或显式代理、TLS、客户端证书。
func newTransport(spec ExchangeRequest) (*http.Transport, error) {
	proxy, err := proxyOf(spec.Proxy)
	if err != nil {
		return nil, err
	}
	tlsCfg := &tls.Config{
		MinVersion:         tls.VersionTLS12,
		InsecureSkipVerify: spec.Insecure,
	}
	certFile := strings.TrimSpace(spec.CertFile)
	keyFile := strings.TrimSpace(spec.KeyFile)
	if certFile != "" || keyFile != "" {
		if certFile == "" || keyFile == "" {
			return nil, fmt.Errorf("http: client certificate needs both cert and key")
		}
		pair, err := tls.LoadX509KeyPair(certFile, keyFile)
		if err != nil {
			return nil, fmt.Errorf("http: client certificate: %w", err)
		}
		tlsCfg.Certificates = []tls.Certificate{pair}
	}
	return &http.Transport{
		Proxy:              proxy,
		ForceAttemptHTTP2:  true,
		DisableCompression: true,
		TLSClientConfig:    tlsCfg,
	}, nil
}

func proxyOf(raw string) (func(*http.Request) (*url.URL, error), error) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return http.ProxyFromEnvironment, nil
	}
	parsed, err := url.Parse(text)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("http: invalid proxy")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("http: unsupported proxy")
	}
	return http.ProxyURL(parsed), nil
}

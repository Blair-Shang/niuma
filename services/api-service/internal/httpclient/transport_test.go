package httpclient

import (
	"context"
	"net/http"
	"testing"
)

func TestExchangeRejectsBadProxy(t *testing.T) {
	_, err := Exchange(context.Background(), ExchangeRequest{
		Method: http.MethodGet,
		URL:    "https://example.com",
		Proxy:  "not a proxy",
	})
	if err == nil {
		t.Fatal("expected invalid proxy")
	}
}

func TestExchangeRejectsPartialClientCert(t *testing.T) {
	_, err := Exchange(context.Background(), ExchangeRequest{
		Method:   http.MethodGet,
		URL:      "https://example.com",
		CertFile: "cert.pem",
	})
	if err == nil {
		t.Fatal("expected both cert and key")
	}
}

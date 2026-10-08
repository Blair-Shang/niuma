package capture

import (
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestCaptureRecordsForwardedRequest(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	origin := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("pong"))
	})}
	go func() { _ = origin.Serve(ln) }()
	defer origin.Close()

	hub := NewHub()
	started, err := hub.Start("127.0.0.1", 0)
	if err != nil {
		t.Fatal(err)
	}
	defer hub.Stop()

	proxyURL, err := url.Parse("http://" + started.ListenAddr)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, "http://"+ln.Addr().String()+"/echo", strings.NewReader("hi"))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-Trace", "1")
	client := &http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)}}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated || string(body) != "pong" {
		t.Fatalf("status %d body %s", resp.StatusCode, body)
	}
	entries := hub.Log()
	if len(entries) != 1 || entries[0].Method != http.MethodPost || entries[0].Body != "hi" {
		t.Fatalf("entries %+v", entries)
	}
}

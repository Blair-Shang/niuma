package httpclient

import (
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestExchangePlainAndGzip(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			t.Errorf("accept-encoding = %q", r.Header.Get("Accept-Encoding"))
		}
		if r.Header.Get("User-Agent") != "NiuMa" {
			t.Errorf("user-agent = %q", r.Header.Get("User-Agent"))
		}
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("X-Trace", "1")
		zw := gzip.NewWriter(w)
		_, _ = zw.Write([]byte("hello"))
		_ = zw.Close()
	}))
	defer srv.Close()

	result, err := Exchange(context.Background(), ExchangeRequest{
		Method:          http.MethodGet,
		URL:             srv.URL + "/items",
		FollowRedirects: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != 200 || string(result.Body) != "hello" {
		t.Fatalf("status=%d body=%q", result.Status, result.Body)
	}
	if result.Protocol != "HTTP/1.1" {
		t.Fatalf("protocol = %q", result.Protocol)
	}
}

func TestExchangeTLSRedirectAndCookie(t *testing.T) {
	mux := http.NewServeMux()
	var srv *httptest.Server
	mux.HandleFunc("/start", func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: "sid", Value: "abc", Path: "/"})
		http.Redirect(w, r, srv.URL+"/next", http.StatusFound)
	})
	mux.HandleFunc("/next", func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Cookie"); !strings.Contains(got, "sid=abc") {
			t.Errorf("cookie = %q", got)
		}
		_, _ = io.WriteString(w, "done")
	})
	srv = httptest.NewTLSServer(mux)
	defer srv.Close()

	result, err := Exchange(context.Background(), ExchangeRequest{
		Method:          http.MethodGet,
		URL:             srv.URL + "/start",
		FollowRedirects: true,
		Insecure:        true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != 200 || string(result.Body) != "done" {
		t.Fatalf("status=%d body=%q", result.Status, result.Body)
	}
	if len(result.Redirects) != 1 || result.Redirects[0].Status != http.StatusFound {
		t.Fatalf("redirects = %+v", result.Redirects)
	}
	if len(result.Cookies) != 1 || result.Cookies[0].Name != "sid" || result.Cookies[0].Value != "abc" {
		t.Fatalf("cookies = %+v", result.Cookies)
	}
}

func TestExchangeStopsOnRedirectWhenDisabled(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/other", http.StatusMovedPermanently)
	}))
	defer srv.Close()

	result, err := Exchange(context.Background(), ExchangeRequest{
		Method:          http.MethodGet,
		URL:             srv.URL,
		FollowRedirects: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != http.StatusMovedPermanently {
		t.Fatalf("status = %d", result.Status)
	}
	if len(result.Redirects) != 0 {
		t.Fatalf("redirects = %+v", result.Redirects)
	}
}

func TestMultipartFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "note.txt")
	if err := os.WriteFile(path, []byte("file-body"), 0o644); err != nil {
		t.Fatal(err)
	}
	var gotFile, gotText string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Errorf("parse: %v", err)
			return
		}
		gotText = r.FormValue("title")
		file, _, err := r.FormFile("doc")
		if err != nil {
			t.Errorf("file: %v", err)
			return
		}
		defer file.Close()
		raw, _ := io.ReadAll(file)
		gotFile = string(raw)
		_, _ = io.WriteString(w, "ok")
	}))
	defer srv.Close()

	result, err := Exchange(context.Background(), ExchangeRequest{
		Method:          http.MethodPost,
		URL:             srv.URL,
		FollowRedirects: true,
		Parts: []FormPart{
			{Name: "title", Value: "hello"},
			{Name: "doc", FilePath: path},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != 200 || gotText != "hello" || gotFile != "file-body" {
		t.Fatalf("status=%d text=%q file=%q", result.Status, gotText, gotFile)
	}
}

func TestCancelExchange(t *testing.T) {
	started := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
	}))
	defer srv.Close()

	canceler := NewCanceler()
	ctx, stop := canceler.Start(context.Background(), "req-1", time.Minute)
	defer stop()
	done := make(chan error, 1)
	go func() {
		_, err := Exchange(ctx, ExchangeRequest{Method: http.MethodGet, URL: srv.URL, FollowRedirects: true})
		done <- err
	}()
	<-started
	canceler.Cancel("req-1")
	if err := <-done; err != ErrCancelled {
		t.Fatalf("err = %v", err)
	}
}

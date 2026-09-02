package loop

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResolveChatCompletionsURL(t *testing.T) {
	t.Parallel()
	cases := []struct {
		base, kind, want string
	}{
		{"", "openai", "https://api.openai.com/v1/chat/completions"},
		{"", "ollama", "http://127.0.0.1:11434/v1/chat/completions"},
		{"https://proxy.example.com/v1", "custom", "https://proxy.example.com/v1/chat/completions"},
		{"https://proxy.example.com/v1/", "custom", "https://proxy.example.com/v1/chat/completions"},
		{"https://proxy.example.com/v1/chat/completions", "custom", "https://proxy.example.com/v1/chat/completions"},
		{"https://proxy.example.com", "custom", "https://proxy.example.com/v1/chat/completions"},
	}
	for _, tc := range cases {
		got := resolveChatCompletionsURL(tc.base, tc.kind)
		if got != tc.want {
			t.Fatalf("base=%q kind=%q: got %q want %q", tc.base, tc.kind, got, tc.want)
		}
	}
}

func TestParseOpenAIStreamDelta(t *testing.T) {
	t.Parallel()
	delta, err := parseOpenAIStreamDelta(`{"choices":[{"delta":{"content":"你好"}}]}`)
	if err != nil {
		t.Fatal(err)
	}
	if delta != "你好" {
		t.Fatalf("got %q", delta)
	}
}

func TestResolveModelsURL(t *testing.T) {
	t.Parallel()
	cases := []struct {
		base, kind, want string
	}{
		{"", "openai", "https://api.openai.com/v1/models"},
		{"", "ollama", "http://127.0.0.1:11434/v1/models"},
		{"https://proxy.example.com/v1", "custom", "https://proxy.example.com/v1/models"},
		{"https://proxy.example.com/v1/chat/completions", "custom", "https://proxy.example.com/v1/models"},
		{"https://open.bigmodel.cn/api/paas/v4/chat/completions", "openai", "https://open.bigmodel.cn/api/paas/v4/models"},
		{"https://proxy.example.com/v1/models", "custom", "https://proxy.example.com/v1/models"},
	}
	for _, tc := range cases {
		got := resolveModelsURL(tc.base, tc.kind)
		if got != tc.want {
			t.Fatalf("base=%q kind=%q: got %q want %q", tc.base, tc.kind, got, tc.want)
		}
	}
}

func TestFetchOpenAIModelIDs(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("path=%s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer sk-test" {
			t.Fatalf("auth=%q", got)
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"b"},{"id":"a"},{"id":"a"}]}`))
	}))
	t.Cleanup(srv.Close)

	ids, err := fetchOpenAIModelIDs(context.Background(), srv.URL+"/v1/models", "sk-test")
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 2 || ids[0] != "a" || ids[1] != "b" {
		t.Fatalf("ids=%v", ids)
	}
}

package mock

import (
	"io"
	"net/http"
	"testing"
	"time"
)

func TestMockExactAndMiss(t *testing.T) {
	hub := NewHub()
	started, err := hub.Start("local", "127.0.0.1", 0, []Route{{
		ID:     "ping",
		Method: "GET",
		Path:   "/ping",
		Match:  "exact",
		Status: 201,
		Body:   `{"ok":true}`,
		Headers: []Header{{
			Name:  "X-Mock",
			Value: "1",
		}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer hub.Stop("local")

	resp, err := http.Get("http://" + started.ListenAddr + "/ping")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 201 || string(body) != `{"ok":true}` || resp.Header.Get("X-Mock") != "1" {
		t.Fatalf("status %d body %s", resp.StatusCode, body)
	}

	miss, err := http.Get("http://" + started.ListenAddr + "/missing")
	if err != nil {
		t.Fatal(err)
	}
	miss.Body.Close()
	if miss.StatusCode != http.StatusNotFound {
		t.Fatalf("miss status %d", miss.StatusCode)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) && len(hub.Log("local")) < 2 {
		time.Sleep(10 * time.Millisecond)
	}
	if len(hub.Log("local")) < 2 {
		t.Fatalf("hits = %#v", hub.Log("local"))
	}
}

func TestMockRejectsPublicHost(t *testing.T) {
	hub := NewHub()
	_, err := hub.Start("local", "8.8.8.8", 0, nil)
	if err == nil {
		t.Fatal("expected host rejection")
	}
}

package envelope

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOKWireShape(t *testing.T) {
	resp := OK("g", map[string]string{"value": "dark"})
	raw := Marshal(resp)
	if !strings.Contains(string(raw), `"result":"{\"value\":\"dark\"}"`) {
		t.Fatalf("result must stay JSON-encoded string: %s", raw)
	}
	var parsed Response
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if parsed.V != Version || parsed.TraceID != "g" || parsed.ErrorCode != "" {
		t.Fatalf("ok envelope: %+v", parsed)
	}
}

func TestFailInfersMethodNotFound(t *testing.T) {
	resp := Fail("req-1", "method not found: platform.settings.delete")
	if resp.ErrorCode != CodeMethodNotFound {
		t.Fatalf("code=%q", resp.ErrorCode)
	}
	if resp.Error != "method not found: platform.settings.delete" {
		t.Fatalf("error string must stay: %q", resp.Error)
	}
	raw := Marshal(resp)
	if strings.Contains(string(raw), `"error":{`) {
		t.Fatalf("error must remain a string: %s", raw)
	}
}

func TestInferCode(t *testing.T) {
	cases := map[string]string{
		"invalid request json: x":            CodeInvalidRequest,
		"invalid params: y":                  CodeInvalidParams,
		"context canceled":                   CodeCancelled,
		"platform unavailable: z":            CodeUnavailable,
		"i/o timeout":                        CodeTimeout,
		"read tcp: connection reset by peer": CodeLost,
		"boom":                               CodeInternal,
	}
	for msg, want := range cases {
		if got := InferCode(msg); got != want {
			t.Fatalf("InferCode(%q)=%q want %q", msg, got, want)
		}
	}
	if got := InferCode("mysql: server is MariaDB; use mariadb connection kind instead"); got != CodeEngineMismatch {
		t.Fatalf("maria InferCode=%q", got)
	}
}

func TestUnmarshalError(t *testing.T) {
	err := UnmarshalError(FailCode("t1", CodeUnavailable, "service unavailable: mysql"))
	remote, ok := err.(*Error)
	if !ok {
		t.Fatalf("type %T", err)
	}
	if remote.Error() != "service unavailable: mysql" {
		t.Fatalf("Error()=%q", remote.Error())
	}
	if remote.Code != CodeUnavailable || remote.TraceID != "t1" {
		t.Fatalf("%+v", remote)
	}
}

func TestWithRequestPrefersTraceID(t *testing.T) {
	resp := WithRequest(Request{ID: "a", TraceID: "trace-z"}, OK("a", map[string]bool{"ok": true}))
	if resp.TraceID != "trace-z" || resp.V != Version {
		t.Fatalf("%+v", resp)
	}
}

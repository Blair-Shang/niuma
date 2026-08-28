package envelope

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func goldenPath(name string) string {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		return name
	}
	return filepath.Join(filepath.Dir(file), "golden", name)
}

func readGolden(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(goldenPath(name))
	if err != nil {
		t.Fatalf("read golden %s: %v", name, err)
	}
	return bytes.TrimSpace(raw)
}

func assertWireJSON(t *testing.T, name string, got []byte) {
	t.Helper()
	want := readGolden(t, name)
	var wantV, gotV any
	if err := json.Unmarshal(want, &wantV); err != nil {
		t.Fatalf("want json: %v", err)
	}
	if err := json.Unmarshal(got, &gotV); err != nil {
		t.Fatalf("got json: %v (%s)", err, got)
	}
	wantB, _ := json.Marshal(wantV)
	gotB, _ := json.Marshal(gotV)
	if !bytes.Equal(wantB, gotB) {
		t.Fatalf("%s\nwant %s\ngot  %s", name, wantB, gotB)
	}
}

func TestGoldenOK(t *testing.T) {
	assertWireJSON(t, "ok-v1.json", Marshal(OK("req-1", map[string]bool{"closed": true})))
}

func TestGoldenFailMethodNotFound(t *testing.T) {
	assertWireJSON(t, "fail-method_not_found-v1.json", Marshal(Fail("req-2", "method not found: foo")))
}

func TestGoldenFailEngineMismatch(t *testing.T) {
	err := errors.New("mysql: server is MariaDB; use mariadb connection kind instead")
	assertWireJSON(t, "fail-engine_mismatch-v1.json", Marshal(FailEngineMismatch("req-3", err)))
}

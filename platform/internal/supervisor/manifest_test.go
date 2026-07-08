package supervisor

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestLoadManifests_FtpPipeAddress(t *testing.T) {
	t.Parallel()

	dir := filepath.Join("..", "..", "..", "services")
	if _, err := os.Stat(dir); err != nil {
		t.Skip("services dir not available")
	}

	manifests, err := LoadManifests(dir)
	if err != nil {
		t.Fatal(err)
	}
	m := manifests["com.niuma.ftp"]
	if m == nil {
		t.Fatal("com.niuma.ftp manifest missing")
	}
	want := `\\.\pipe\niuma.ftp`
	if runtime.GOOS != "windows" {
		want = `/tmp/niuma.ftp.sock`
	}
	if got := m.IPCAddress(); got != want {
		t.Fatalf("IPCAddress() = %q, want %q", got, want)
	}
}

package components

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeConfiguredDir_ResolvesDllParent(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	dll := filepath.Join(dir, "oci.dll")
	if err := os.WriteFile(dll, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := NormalizeConfiguredDir(dll); got != dir {
		t.Fatalf("dll parent: got %q want %q", got, dir)
	}
	if got := NormalizeConfiguredDir(dir); got != dir {
		t.Fatalf("dir: got %q want %q", got, dir)
	}
	if got := NormalizeConfiguredDir(""); got != "" {
		t.Fatalf("empty: got %q", got)
	}
}

func TestIsVersionProbeable_SkipsSharedLibraries(t *testing.T) {
	t.Parallel()
	if isVersionProbeable(`C:\oracle\oci.dll`) {
		t.Fatal("oci.dll should not be probeable")
	}
	if isVersionProbeable("/opt/oracle/libclntsh.so") {
		t.Fatal("libclntsh.so should not be probeable")
	}
	if isVersionProbeable("/opt/oracle/libclntsh.so.19.1") {
		t.Fatal("libclntsh.so.* should not be probeable")
	}
	if !isVersionProbeable(`C:\oracle\sqlplus.exe`) {
		t.Fatal("sqlplus.exe should be probeable")
	}
}

package supervisor

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFindServicesRoot_FromFlatBinLayout(t *testing.T) {
	t.Parallel()

	services := filepath.Join("..", "..", "..", "services")
	abs, err := filepath.Abs(services)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(abs, "manifests")); err != nil {
		t.Skip("services dir not available")
	}

	got, err := findServicesRoot(filepath.Join(abs, "bin"))
	if err != nil {
		t.Fatal(err)
	}
	want, err := filepath.Abs(abs)
	if err != nil {
		t.Fatal(err)
	}
	gotAbs, err := filepath.Abs(got)
	if err != nil {
		t.Fatal(err)
	}
	if gotAbs != want {
		t.Fatalf("findServicesRoot() = %q, want %q", gotAbs, want)
	}
}

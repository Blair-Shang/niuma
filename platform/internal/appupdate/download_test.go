package appupdate

import "testing"

func TestValidateDownloadURL(t *testing.T) {
	hosts := []string{"niuma007.com"}
	if err := ValidateDownloadURL("https://cdn.niuma007.com/a.exe", hosts); err != nil {
		t.Fatal(err)
	}
	if err := ValidateDownloadURL("https://evil.com/a.exe", hosts); err == nil {
		t.Fatal("want deny")
	}
	if err := ValidateDownloadURL("http://cdn.niuma007.com/a.exe", hosts); err == nil {
		t.Fatal("want https")
	}
	if err := ValidateDownloadURL("https://127.0.0.1/a.exe", hosts); err == nil {
		t.Fatal("want deny ip")
	}
}

func TestSafeFileName(t *testing.T) {
	n, err := safeFileName("https://cdn.niuma007.com/path/NiuMa-1.0.1-windows-x64-Setup.exe")
	if err != nil || n != "NiuMa-1.0.1-windows-x64-Setup.exe" {
		t.Fatalf("got %q %v", n, err)
	}
	if _, err := safeFileName("https://cdn.niuma007.com/evil.sh"); err == nil {
		t.Fatal("want ext deny")
	}
}

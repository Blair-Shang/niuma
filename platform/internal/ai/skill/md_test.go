package skill

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseSkillMD(t *testing.T) {
	raw := "---\nname: hello-world\ndescription: A greeting skill.\n---\n\n# Hello\n\nSay hi.\n"
	doc, err := parseSkillMD(raw)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Name != "hello-world" {
		t.Fatalf("name=%q", doc.Name)
	}
	if doc.Description != "A greeting skill." {
		t.Fatalf("desc=%q", doc.Description)
	}
	if !strings.Contains(doc.Body, "Say hi.") {
		t.Fatalf("body=%q", doc.Body)
	}
}

func TestSanitizeSkillCode(t *testing.T) {
	if got := sanitizeSkillCode("Hello World!"); got != "hello-world" {
		t.Fatalf("got %q", got)
	}
	if got := skillPackMCPServerID("hello-world"); got != "skillpack_hello_world" {
		t.Fatalf("mcp id=%q", got)
	}
}

func TestInstallAndExportSkillPack(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	src := filepath.Join(t.TempDir(), "hello-world")
	if err := os.MkdirAll(filepath.Join(src, "scripts"), 0o755); err != nil {
		t.Fatal(err)
	}
	md := "---\nname: hello-world\ndescription: Greeting\n---\n\nUse the greet script when asked.\n"
	if err := os.WriteFile(filepath.Join(src, "SKILL.md"), []byte(md), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "scripts", "greet.sh"), []byte("#!/bin/sh\necho hi\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	doc, err := parseSkillMD(md)
	if err != nil {
		t.Fatal(err)
	}
	if !skillPackHasScripts(src) {
		t.Fatal("expected scripts")
	}
	dest, err := SkillPackDir(doc.Name)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := copyDir(src, dest); err != nil {
		t.Fatal(err)
	}
	zipPath := filepath.Join(t.TempDir(), "hello-world.zip")
	if err := zipDir(dest, zipPath); err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(zipPath)
	if err != nil || st.Size() == 0 {
		t.Fatalf("zip missing: %v", err)
	}
}

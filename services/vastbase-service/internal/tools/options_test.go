package tools

import (
	"strings"
	"testing"
)

func TestDumpArgsDefaults(t *testing.T) {
	args, err := DumpArgs("127.0.0.1", "5432", "u", "db", "out.dump", DumpOptions{})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	for _, want := range []string{"-h 127.0.0.1", "-p 5432", "-U u", "-d db", "-F c", "-f out.dump", "--no-password"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in %v", want, args)
		}
	}
	if strings.Contains(joined, " -s") || strings.Contains(joined, " -a") {
		t.Fatalf("unexpected content mode in %v", args)
	}
}

func TestDumpArgsSchemaOnlyAndFilters(t *testing.T) {
	jobs := 4
	compress := 6
	args, err := DumpArgs("h", "1", "u", "db", "out", DumpOptions{
		Format:         DumpFormatDirectory,
		Mode:           ContentModeSchemaOnly,
		Schemas:        []string{"public", " app "},
		ExcludeSchemas: []string{"pg_catalog"},
		Tables:         []string{"public.t1"},
		ExcludeTables:  []string{"public.t2"},
		Jobs:           &jobs,
		Compress:       &compress,
		Clean:          true,
		Create:         true,
		NoOwner:        true,
		NoPrivileges:   true,
		Blobs:          true,
		Encoding:       "UTF8",
		Verbose:        true,
	})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	for _, want := range []string{
		"-F d", "-s", "-n public", "-n app", "-N pg_catalog",
		"-t public.t1", "-T public.t2", "-j 4", "-Z 6",
		"-c", "-C", "-O", "-x", "-b", "-E UTF8", "-v",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in %v", want, args)
		}
	}
}

func TestDumpArgsJobsRejectedForPlain(t *testing.T) {
	jobs := 2
	_, err := DumpArgs("h", "1", "u", "db", "out.sql", DumpOptions{
		Format: DumpFormatPlain,
		Jobs:   &jobs,
	})
	if err == nil {
		t.Fatal("expected jobs validation error")
	}
}

func TestRestoreArgsDefaults(t *testing.T) {
	args, err := RestoreArgs("h", "1", "u", "db", "in.dump", RestoreOptions{})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	for _, want := range []string{"-d db", "--clean", "--if-exists", "--no-password", "in.dump"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in %v", want, args)
		}
	}
}

func TestRestoreArgsOptions(t *testing.T) {
	jobs := 2
	clean := false
	ifExists := false
	args, err := RestoreArgs("h", "1", "u", "db", "in.dump", RestoreOptions{
		Format:            DumpFormatCustom,
		Mode:              ContentModeDataOnly,
		Schemas:           []string{"public"},
		Tables:            []string{"t1"},
		Jobs:              &jobs,
		Clean:             &clean,
		IfExists:          &ifExists,
		Create:            true,
		NoOwner:           true,
		NoPrivileges:      true,
		DisableTriggers:   true,
		SingleTransaction: true,
		Verbose:           true,
	})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	for _, want := range []string{
		"-F c", "-a", "-n public", "-t t1", "-j 2", "-C", "-O", "-x",
		"--disable-triggers", "--single-transaction", "-v",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in %v", want, args)
		}
	}
	if strings.Contains(joined, "--clean") || strings.Contains(joined, "--if-exists") {
		t.Fatalf("clean/if-exists should be off: %v", args)
	}
}

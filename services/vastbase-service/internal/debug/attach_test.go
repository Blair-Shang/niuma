package debug

import (
	"errors"
	"strings"
	"testing"
)

func TestClassifyAttachGiveUp(t *testing.T) {
	t.Parallel()
	last := errors.New("D0011: not running in expected way")

	err := classifyAttachGiveUp(false, last)
	if err == nil || !strings.Contains(err.Error(), "ERR_ATTACH_TIMEOUT") {
		t.Fatalf("want TIMEOUT, got %v", err)
	}

	err = classifyAttachGiveUp(true, last)
	if err == nil || !strings.Contains(err.Error(), "ERR_ATTACH_FINISHED_EARLY") {
		t.Fatalf("want FINISHED_EARLY, got %v", err)
	}

	err = classifyAttachGiveUp(false, nil)
	if err == nil || !strings.Contains(err.Error(), "ERR_ATTACH_TIMEOUT") {
		t.Fatalf("want TIMEOUT with nil last, got %v", err)
	}
}

func TestBuildDebugExecSQLMatchesCall(t *testing.T) {
	t.Parallel()
	proc := buildDebugExecSQL("procedure", "public", "new_procedure", "")
	if !strings.Contains(proc, `DBMS_OUTPUT.ENABLE(1000000)`) {
		t.Fatalf("procedure should ENABLE in-block: %s", proc)
	}
	if !strings.Contains(proc, "nm_dbms_warmup") {
		t.Fatalf("procedure should warmup PUT_LINE: %s", proc)
	}
	if strings.Contains(proc, "CALL ") {
		t.Fatalf("procedure block should not use CALL: %s", proc)
	}
	fn := buildDebugExecSQL("function", "public", "f", "1")
	if fn != `SELECT "public"."f"(1)` {
		t.Fatalf("function execSQL: %s", fn)
	}
}


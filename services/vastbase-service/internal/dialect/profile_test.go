package dialect

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestDefaultVastbaseHasPlsqlProcedure(t *testing.T) {
	t.Parallel()
	p := DefaultVastbase()
	if !Has(&p, CapProcPlsqlBare) {
		t.Fatal("expected proc.plsql_bare")
	}
	if Has(&p, CapProcPlpgsqlDollar) {
		t.Fatal("default must not enable plpgsql procedure dollar-quoting")
	}
	if !Has(&p, CapScriptOracleSlash) || !Has(&p, CapSplitPlsqlBlocks) {
		t.Fatal("expected slash + plsql split caps")
	}
}

type stubTx struct {
	execErr   error
	createErr error
	calls     []string
}

func (s *stubTx) Exec(ctx context.Context, sql string, arguments ...any) error {
	_ = ctx
	_ = arguments
	s.calls = append(s.calls, sql)
	upper := strings.ToUpper(sql)
	if strings.Contains(upper, "CREATE") {
		if s.createErr != nil {
			return s.createErr
		}
		return nil
	}
	if s.execErr != nil {
		return s.execErr
	}
	return nil
}

func (s *stubTx) Rollback(ctx context.Context) error {
	_ = ctx
	s.calls = append(s.calls, "ROLLBACK")
	return nil
}

func TestProbePlpgsqlProcedureSupport_ok(t *testing.T) {
	t.Parallel()
	tx := &stubTx{}
	ok := ProbePlpgsqlProcedureSupport(context.Background(), func(ctx context.Context) (txExec, error) {
		return tx, nil
	})
	if !ok {
		t.Fatal("expected support when CREATE succeeds")
	}
	joined := strings.Join(tx.calls, "\n")
	if !strings.Contains(joined, "SAVEPOINT") || !strings.Contains(strings.ToUpper(joined), "CREATE") {
		t.Fatalf("missing probe SQL: %v", tx.calls)
	}
	if !strings.Contains(joined, "ROLLBACK") {
		t.Fatal("expected rollback")
	}
}

func TestProbePlpgsqlProcedureSupport_createFails(t *testing.T) {
	t.Parallel()
	tx := &stubTx{createErr: errors.New("syntax error at or near LANGUAGE")}
	ok := ProbePlpgsqlProcedureSupport(context.Background(), func(ctx context.Context) (txExec, error) {
		return tx, nil
	})
	if ok {
		t.Fatal("expected false when CREATE fails")
	}
}

func TestProbePlpgsqlProcedureSupport_beginFails(t *testing.T) {
	t.Parallel()
	ok := ProbePlpgsqlProcedureSupport(context.Background(), func(ctx context.Context) (txExec, error) {
		return nil, errors.New("begin failed")
	})
	if ok {
		t.Fatal("expected false when begin fails")
	}
}

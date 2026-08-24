package session

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"niuma/pkg/common/id"
)

// RoutineCallArg 是 routine.call 的单个参数。
type RoutineCallArg struct {
	Name  string `json:"name"`
	Type  string `json:"type"`
	Mode  string `json:"mode"` // in / out / inout
	Value string `json:"value,omitempty"`
	IsNull bool  `json:"isNull,omitempty"`
}

// RoutineCallParams 在同一物理连接上调用过程并读回 OUT（Kingbase 要求 OUT 必须是变量）。
type RoutineCallParams struct {
	SessionID string           `json:"sessionId"`
	Database  string           `json:"database,omitempty"`
	Schema    string           `json:"schema"`
	Name      string           `json:"name"`
	Args      []RoutineCallArg `json:"args"`
	RequestID string           `json:"requestId"`
	TimeoutMS int              `json:"timeoutMs"`
}

func quoteIdentSQL(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func plLocalType(typ string) string {
	t := strings.TrimSpace(typ)
	if t == "" || strings.EqualFold(t, "unknown") {
		return "text"
	}
	lt := strings.ToLower(t)
	switch lt {
	case "varchar", "character varying", "nvarchar":
		return "varchar(4000)"
	case "char", "character", "nchar":
		return "char(1)"
	default:
		return t
	}
}

func sqlLiteral(value string, typ string, isNull bool) string {
	if isNull {
		return "NULL"
	}
	v := strings.TrimSpace(value)
	if v == "" || strings.EqualFold(v, "null") {
		t := strings.TrimSpace(typ)
		if t == "" {
			t = "text"
		}
		return "NULL::" + t
	}
	if (strings.HasPrefix(v, "'") && strings.HasSuffix(v, "'")) ||
		strings.Contains(v, "::") ||
		(strings.HasPrefix(v, "(") && strings.HasSuffix(v, ")")) {
		return v
	}
	lt := strings.ToLower(strings.TrimSpace(typ))
	if strings.Contains(lt, "int") || lt == "numeric" || lt == "decimal" || lt == "real" ||
		strings.HasPrefix(lt, "float") || lt == "double precision" || lt == "money" || lt == "oid" {
		if isNumericLiteral(v) {
			return v
		}
	}
	if lt == "boolean" || lt == "bool" {
		switch strings.ToLower(v) {
		case "true", "t", "yes", "1":
			return "TRUE"
		case "false", "f", "no", "0":
			return "FALSE"
		}
	}
	return "'" + strings.ReplaceAll(v, "'", "''") + "'"
}

func isNumericLiteral(v string) bool {
	if v == "" {
		return false
	}
	i := 0
	if v[0] == '-' || v[0] == '+' {
		i = 1
	}
	if i >= len(v) {
		return false
	}
	dot := false
	for ; i < len(v); i++ {
		c := v[i]
		if c >= '0' && c <= '9' {
			continue
		}
		if c == '.' && !dot {
			dot = true
			continue
		}
		return false
	}
	return true
}

func localVar(name string, ordinal int) string {
	raw := strings.TrimSpace(name)
	var b strings.Builder
	for _, r := range raw {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	cleaned := strings.Trim(b.String(), "_")
	if cleaned == "" {
		return fmt.Sprintf("v_p%d", ordinal)
	}
	if cleaned[0] >= '0' && cleaned[0] <= '9' {
		cleaned = "p_" + cleaned
	}
	return "v_" + cleaned
}

// CallRoutine 在给定连接池的一条连接上 CALL 过程，经临时表读回 OUT/INOUT，返回一行结果集。
// pool 通常为 sess.Pool；跨库时可为短连池。
func CallRoutine(ctx context.Context, sess *Session, pool *pgxpool.Pool, params RoutineCallParams) (*QueryExecResult, error) {
	if sess == nil {
		return nil, fmt.Errorf("postgres: session required")
	}
	if pool == nil {
		pool = sess.Pool
	}
	if pool == nil {
		return nil, fmt.Errorf("postgres: pool required")
	}
	schema := strings.TrimSpace(params.Schema)
	name := strings.TrimSpace(params.Name)
	if schema == "" || name == "" {
		return nil, fmt.Errorf("postgres: schema and name required")
	}

	hasOut := false
	for _, a := range params.Args {
		m := strings.ToLower(strings.TrimSpace(a.Mode))
		if m == "out" || m == "inout" {
			hasOut = true
			break
		}
	}
	if !hasOut {
		return nil, fmt.Errorf("postgres: routine.call requires at least one OUT/INOUT argument")
	}

	requestID := id.CoalesceID(params.RequestID, "rc")
	runCtx := ctx
	var cancelTimeout context.CancelFunc
	if params.TimeoutMS > 0 {
		runCtx, cancelTimeout = context.WithTimeout(ctx, time.Duration(params.TimeoutMS)*time.Millisecond)
		defer cancelTimeout()
	}
	qCtx, release := sess.RegisterQuery(runCtx, requestID)
	defer release()

	start := time.Now()
	conn, err := pool.Acquire(qCtx)
	if err != nil {
		return nil, fmt.Errorf("postgres: acquire: %w", err)
	}
	defer conn.Release()

	const outTable = "nm_call_out"
	qn := quoteIdentSQL(schema) + "." + quoteIdentSQL(name)

	var (
		decl      []string
		callArgs  []string
		outIdents []string
		outVars   []string
	)
	for i, a := range params.Args {
		display := strings.TrimSpace(a.Name)
		if display == "" {
			display = fmt.Sprintf("$%d", i+1)
		}
		mode := strings.ToLower(strings.TrimSpace(a.Mode))
		if mode == "" {
			mode = "in"
		}
		if mode == "out" || mode == "inout" {
			v := localVar(display, i+1)
			typ := plLocalType(a.Type)
			if mode == "inout" {
				decl = append(decl, fmt.Sprintf("  %s %s := %s; -- INOUT %s", v, typ, sqlLiteral(a.Value, a.Type, a.IsNull), display))
			} else {
				decl = append(decl, fmt.Sprintf("  %s %s; -- OUT %s", v, typ, display))
			}
			callArgs = append(callArgs, v)
			outIdents = append(outIdents, quoteIdentSQL(display))
			outVars = append(outVars, v+"::text")
			continue
		}
		callArgs = append(callArgs, fmt.Sprintf("%s /* %s */", sqlLiteral(a.Value, a.Type, a.IsNull), display))
	}

	colDefs := make([]string, len(outIdents))
	for i, idt := range outIdents {
		colDefs[i] = "  " + idt + " text"
	}

	dropSQL := fmt.Sprintf("DROP TABLE IF EXISTS pg_temp.%s", outTable)
	createSQL := fmt.Sprintf("CREATE TEMP TABLE %s (\n%s\n)", outTable, strings.Join(colDefs, ",\n"))

	var do strings.Builder
	do.WriteString("DO $$\nDECLARE\n")
	do.WriteString(strings.Join(decl, "\n"))
	do.WriteString("\nBEGIN\n  CALL ")
	do.WriteString(qn)
	do.WriteByte('(')
	if len(callArgs) == 1 {
		do.WriteString(callArgs[0])
	} else if len(callArgs) > 1 {
		do.WriteByte('\n')
		for i, arg := range callArgs {
			do.WriteString("    ")
			do.WriteString(arg)
			if i < len(callArgs)-1 {
				do.WriteByte(',')
			}
			do.WriteByte('\n')
		}
		do.WriteString("  ")
	}
	do.WriteString(");\n  INSERT INTO ")
	do.WriteString(outTable)
	do.WriteString(" (")
	do.WriteString(strings.Join(outIdents, ", "))
	do.WriteString(") VALUES (")
	do.WriteString(strings.Join(outVars, ", "))
	do.WriteString(");\nEND $$;")

	selectSQL := fmt.Sprintf("SELECT * FROM %s", outTable)

	for _, sqlText := range []string{dropSQL, createSQL, do.String()} {
		if _, err := conn.Exec(qCtx, sqlText); err != nil {
			return nil, fmt.Errorf("postgres: routine.call: %w", err)
		}
	}

	result, err := execOneOnConn(qCtx, conn, selectSQL, DefaultQueryLimit, requestID)
	if err != nil {
		return nil, err
	}
	result.DurationMS = time.Since(start).Milliseconds()
	return result, nil
}

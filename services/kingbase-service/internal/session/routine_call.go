package session

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"niuma/pkg/common/id"
)

const nmDebugGUC = "niuma.debug"

// RoutineCallArg 是 routine.call 的单个参数。
type RoutineCallArg struct {
	Name   string `json:"name"`
	Type   string `json:"type"`
	Mode   string `json:"mode"` // in / out / inout / variadic
	Value  string `json:"value,omitempty"`
	IsNull bool   `json:"isNull,omitempty"`
}

// RoutineCallParams 是专业化例程调用入参（对齐 Oracle / SQL Server routine.call）。
// 函数走绑定 SELECT（SETOF / TABLE 用 SELECT * FROM）；过程无 OUT 走 CALL；有 OUT 同连接临时表读回。
type RoutineCallParams struct {
	SessionID    string           `json:"sessionId"`
	Database     string           `json:"database,omitempty"`
	Schema       string           `json:"schema"`
	Name         string           `json:"name"`
	Kind         string           `json:"kind,omitempty"` // function | procedure
	OID          uint32           `json:"oid,omitempty"`
	Args         []RoutineCallArg `json:"args"`
	RequestID    string           `json:"requestId"`
	TimeoutMS    int              `json:"timeoutMs"`
	Limit        int              `json:"limit,omitempty"`
	DebugSession bool             `json:"debugSession,omitempty"`
}

type routineCallMeta struct {
	kind      string
	setRet    bool
	voidRet   bool
	composite bool
	pronargs  int
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

func argMode(a RoutineCallArg) string {
	m := strings.ToLower(strings.TrimSpace(a.Mode))
	if m == "" {
		return "in"
	}
	return m
}

func isOutOnly(a RoutineCallArg) bool {
	return argMode(a) == "out"
}

func hasOutArg(args []RoutineCallArg) bool {
	for _, a := range args {
		m := argMode(a)
		if m == "out" || m == "inout" {
			return true
		}
	}
	return false
}

func inputArgCount(args []RoutineCallArg) int {
	n := 0
	for _, a := range args {
		if !isOutOnly(a) {
			n++
		}
	}
	return n
}

func sanitizeCastType(typ string) string {
	t := strings.TrimSpace(typ)
	if t == "" || strings.EqualFold(t, "unknown") {
		return "text"
	}
	for _, r := range t {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			continue
		}
		switch r {
		case '_', ' ', '(', ')', '[', ']', ',', '.':
			continue
		default:
			return "text"
		}
	}
	return t
}

func bindArgValue(a RoutineCallArg) any {
	if a.IsNull {
		return nil
	}
	v := strings.TrimSpace(a.Value)
	if v == "" || strings.EqualFold(v, "null") {
		return nil
	}
	return v
}

func buildBoundArgSQL(args []RoutineCallArg, skipOutOnly bool) (placeholders []string, bind []any) {
	n := 0
	for _, a := range args {
		if skipOutOnly && isOutOnly(a) {
			continue
		}
		n++
		placeholders = append(placeholders, fmt.Sprintf("$%d::%s", n, sanitizeCastType(a.Type)))
		bind = append(bind, bindArgValue(a))
	}
	return placeholders, bind
}

func buildFunctionSelectSQL(qn string, args []RoutineCallArg, fromClause bool) (string, []any) {
	ph, bind := buildBoundArgSQL(args, true)
	argList := strings.Join(ph, ", ")
	if fromClause {
		return "SELECT * FROM " + qn + "(" + argList + ")", bind
	}
	return "SELECT " + qn + "(" + argList + ")", bind
}

func buildProcedureCallSQL(qn string, args []RoutineCallArg) (string, []any) {
	ph, bind := buildBoundArgSQL(args, false)
	return "CALL " + qn + "(" + strings.Join(ph, ", ") + ")", bind
}

func functionUsesFromClause(meta routineCallMeta) bool {
	if meta.voidRet {
		return false
	}
	if meta.setRet || meta.composite {
		return true
	}
	// 查找失败时默认 FROM，避免 RETURNS TABLE 被当成标量复合列。
	if meta.kind == "" {
		return true
	}
	return false
}

func normalizeKind(raw string, args []RoutineCallArg) string {
	kind := strings.ToLower(strings.TrimSpace(raw))
	if kind == "function" || kind == "procedure" {
		return kind
	}
	if hasOutArg(args) {
		return "procedure"
	}
	return ""
}

func lookupRoutineCallMeta(
	ctx context.Context,
	conn *pgxpool.Conn,
	schema, name string,
	oid uint32,
	hintKind string,
	inArgs int,
) (routineCallMeta, error) {
	const cols = `
SELECT p.oid,
       CASE p.prokind
         WHEN 'p' THEN 'procedure'
         WHEN 'f' THEN 'function'
         ELSE p.prokind::text
       END,
       p.proretset,
       COALESCE(t.typname, ''),
       COALESCE(t.typtype::text, ''),
       p.pronargs
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
LEFT JOIN pg_catalog.pg_type t ON t.oid = p.prorettype
`
	type row struct {
		oid      uint32
		kind     string
		setRet   bool
		typname  string
		typtype  string
		pronargs int32
	}
	scanRow := func(s interface{ Scan(dest ...any) error }) (row, error) {
		var r row
		err := s.Scan(&r.oid, &r.kind, &r.setRet, &r.typname, &r.typtype, &r.pronargs)
		return r, err
	}
	toMeta := func(r row) routineCallMeta {
		tn := strings.ToLower(strings.TrimSpace(r.typname))
		return routineCallMeta{
			kind:      r.kind,
			setRet:    r.setRet,
			voidRet:   tn == "void",
			composite: r.typtype == "c" || tn == "record",
			pronargs:  int(r.pronargs),
		}
	}

	if oid > 0 {
		r, err := scanRow(conn.QueryRow(ctx, cols+` WHERE p.oid = $1`, oid))
		if err != nil {
			return routineCallMeta{}, err
		}
		return toMeta(r), nil
	}

	schema = strings.TrimSpace(schema)
	name = strings.TrimSpace(name)
	rows, err := conn.Query(ctx, cols+` WHERE n.nspname = $1 AND p.proname = $2 ORDER BY p.oid`, schema, name)
	if err != nil {
		return routineCallMeta{}, err
	}
	defer rows.Close()

	var matches []row
	for rows.Next() {
		r, err := scanRow(rows)
		if err != nil {
			return routineCallMeta{}, err
		}
		matches = append(matches, r)
	}
	if err := rows.Err(); err != nil {
		return routineCallMeta{}, err
	}
	if len(matches) == 0 {
		return routineCallMeta{}, pgx.ErrNoRows
	}
	if len(matches) == 1 {
		return toMeta(matches[0]), nil
	}

	best := matches[0]
	bestScore := -1
	for _, m := range matches {
		score := 0
		if hintKind != "" && m.kind == hintKind {
			score += 2
		}
		if int(m.pronargs) == inArgs {
			score += 1
		}
		if score > bestScore {
			bestScore = score
			best = m
		}
	}
	return toMeta(best), nil
}

func applyDebugSessionGUC(ctx context.Context, conn *pgxpool.Conn, enable bool) {
	if conn == nil || !enable {
		return
	}
	_, _ = conn.Exec(ctx, "SELECT set_config('"+nmDebugGUC+"', '1', false)")
	_, _ = conn.Exec(ctx, "SET client_min_messages TO NOTICE")
}

func clearDebugSessionGUC(ctx context.Context, conn *pgxpool.Conn) {
	if conn == nil {
		return
	}
	_, _ = conn.Exec(ctx, "SELECT set_config('"+nmDebugGUC+"', '', false)")
}

func attachNotices(sess *Session, result *QueryExecResult) {
	if sess == nil || result == nil || sess.Notices == nil {
		return
	}
	result.Notices = sess.Notices.Take()
}

func clampRoutineLimit(n int) int {
	if n <= 0 {
		return DefaultQueryLimit
	}
	if n > MaxQueryLimit {
		return MaxQueryLimit
	}
	return n
}

// CallRoutine 在同一物理连接上调用函数或过程，不走 query.exec。
// pool 通常为 sess.Pool；跨库时可为短连池。
func CallRoutine(ctx context.Context, sess *Session, pool *pgxpool.Pool, params RoutineCallParams) (*QueryExecResult, error) {
	if sess == nil {
		return nil, fmt.Errorf("kingbase: session required")
	}
	if pool == nil {
		pool = sess.Pool
	}
	if pool == nil {
		return nil, fmt.Errorf("kingbase: pool required")
	}
	schema := strings.TrimSpace(params.Schema)
	name := strings.TrimSpace(params.Name)
	if schema == "" || name == "" {
		return nil, fmt.Errorf("kingbase: schema and name required")
	}

	kind := normalizeKind(params.Kind, params.Args)
	requestID := id.CoalesceID(params.RequestID, "rc")
	limit := clampRoutineLimit(params.Limit)
	runCtx := ctx
	var cancelTimeout context.CancelFunc
	if params.TimeoutMS > 0 {
		runCtx, cancelTimeout = context.WithTimeout(ctx, time.Duration(params.TimeoutMS)*time.Millisecond)
		defer cancelTimeout()
	}
	qCtx, release := sess.RegisterQuery(runCtx, requestID)
	defer release()

	if sess.Notices != nil {
		sess.Notices.Clear()
	}

	start := time.Now()
	conn, err := pool.Acquire(qCtx)
	if err != nil {
		return nil, fmt.Errorf("kingbase: acquire: %w", err)
	}
	defer conn.Release()

	applyDebugSessionGUC(qCtx, conn, params.DebugSession)
	if params.DebugSession {
		defer clearDebugSessionGUC(context.WithoutCancel(qCtx), conn)
	}

	meta, metaErr := lookupRoutineCallMeta(qCtx, conn, schema, name, params.OID, kind, inputArgCount(params.Args))
	if metaErr == nil {
		if meta.kind == "function" || meta.kind == "procedure" {
			kind = meta.kind
		}
	}
	if kind == "" {
		kind = "procedure"
	}

	qn := quoteIdentSQL(schema) + "." + quoteIdentSQL(name)
	var result *QueryExecResult
	if kind == "function" {
		sqlText, bind := buildFunctionSelectSQL(qn, params.Args, functionUsesFromClause(meta))
		result, err = execOneOnConnArgs(qCtx, conn, sqlText, bind, limit, requestID)
	} else if hasOutArg(params.Args) {
		result, err = callProcedureWithOut(qCtx, conn, qn, params.Args, limit, requestID)
	} else {
		sqlText, bind := buildProcedureCallSQL(qn, params.Args)
		result, err = execOneOnConnArgs(qCtx, conn, sqlText, bind, limit, requestID)
	}
	if err != nil {
		return nil, fmt.Errorf("kingbase: routine.call: %w", err)
	}
	result.DurationMS = time.Since(start).Milliseconds()
	attachNotices(sess, result)
	return result, nil
}

func callProcedureWithOut(
	ctx context.Context,
	conn *pgxpool.Conn,
	qn string,
	args []RoutineCallArg,
	limit int,
	requestID string,
) (*QueryExecResult, error) {
	const outTable = "nm_call_out"

	var (
		decl      []string
		callArgs  []string
		outIdents []string
		outVars   []string
	)
	for i, a := range args {
		display := strings.TrimSpace(a.Name)
		if display == "" {
			display = fmt.Sprintf("$%d", i+1)
		}
		mode := argMode(a)
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

	if len(outIdents) == 0 {
		return nil, fmt.Errorf("kingbase: routine.call requires at least one OUT/INOUT argument")
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
		if _, err := conn.Exec(ctx, sqlText); err != nil {
			return nil, err
		}
	}

	return execOneOnConn(ctx, conn, selectSQL, limit, requestID)
}

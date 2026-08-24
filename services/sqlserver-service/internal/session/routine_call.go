package session

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	mssql "github.com/microsoft/go-mssqldb"

	"niuma/pkg/common/id"
)

// CallRoutine 执行存储过程（TDS RPC + 命名参数 / OUTPUT / ReturnStatus）或函数（绑定参数的 SELECT）。
// 不走 query.exec 的语言批（DECLARE+EXEC+SELECT），OUTPUT 由协议回填。
func CallRoutine(ctx context.Context, sess *Session, db *sql.DB, params RoutineCallParams) (*QueryExecResult, error) {
	if sess == nil {
		return nil, fmt.Errorf("sqlserver: session required")
	}
	if db == nil {
		db = sess.DB
	}
	if db == nil {
		return nil, fmt.Errorf("sqlserver: db required")
	}

	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		schema = "dbo"
	}
	name := strings.TrimSpace(params.Name)
	if name == "" {
		return nil, fmt.Errorf("sqlserver: routine name required")
	}
	kind := strings.ToLower(strings.TrimSpace(params.Kind))
	if kind == "" {
		kind = "procedure"
	}
	if kind != "procedure" && kind != "function" {
		return nil, fmt.Errorf("sqlserver: kind must be procedure or function")
	}

	queryText, args, slots, captureReturn, err := buildRoutineInvocation(schema, name, kind, params.IsTableValued, params.Args)
	if err != nil {
		return nil, err
	}

	requestID := id.CoalesceID(params.RequestID, "rc")
	pageSize := clampPageSize(params.Limit)

	rsCtx, cancelRS := context.WithCancel(context.WithoutCancel(ctx))
	entry := &queryCancel{cancel: cancelRS}
	sess.mu.Lock()
	if prev, ok := sess.inflight[requestID]; ok {
		prev.cancel()
	}
	sess.inflight[requestID] = entry
	sess.mu.Unlock()

	cleanup := func() {
		sess.mu.Lock()
		if cur, ok := sess.inflight[requestID]; ok && cur == entry {
			delete(sess.inflight, requestID)
		}
		sess.mu.Unlock()
		cancelRS()
	}
	defer cleanup()

	var firstPageTimer *time.Timer
	if params.TimeoutMS > 0 {
		firstPageTimer = time.AfterFunc(time.Duration(params.TimeoutMS)*time.Millisecond, cancelRS)
		defer firstPageTimer.Stop()
	}

	start := time.Now()
	conn, err := db.Conn(rsCtx)
	if err != nil {
		return nil, fmt.Errorf("sqlserver: acquire: %w", err)
	}
	defer conn.Close()

	if err := sess.ensureConnDatabase(rsCtx, conn, params.Database); err != nil {
		return nil, err
	}

	var returnStatus mssql.ReturnStatus
	queryArgs := args
	if captureReturn {
		queryArgs = append([]any{&returnStatus}, args...)
	}

	rows, err := conn.QueryContext(rsCtx, queryText, queryArgs...)
	if err != nil {
		return nil, fmt.Errorf("sqlserver: routine.call: %w", err)
	}

	sets, rerr := collectResultSets(rows, pageSize)
	_ = rows.Close()
	if rerr != nil {
		return nil, rerr
	}

	var outputs []RoutineOutput
	for _, slot := range slots {
		outputs = append(outputs, RoutineOutput{
			Name:     slot.display,
			Value:    encodeOutDest(slot.dest, slot.dataType),
			DataType: slot.dataType,
		})
	}

	var retPtr *int32
	if captureReturn {
		v := int32(returnStatus)
		retPtr = &v
	}

	outSet := outputResultSet(outputs, retPtr)
	if len(outSet.Columns) > 0 {
		sets = append(sets, outSet)
	}

	tag := "RPC"
	if kind == "function" {
		tag = "SELECT"
	}

	result := &QueryExecResult{
		RequestID:   requestID,
		DurationMS:  time.Since(start).Milliseconds(),
		CommandTag:  tag,
		Outputs:     outputs,
		ReturnValue: retPtr,
	}
	if len(sets) == 0 {
		return result, nil
	}
	result.Columns = sets[0].Columns
	result.Rows = sets[0].Rows
	result.RowCount = sets[0].RowCount
	result.FetchedCount = sets[0].RowCount
	result.ResultSets = withResultSets(sets[0], sets[1:])
	return result, nil
}

func collectResultSets(rows *sql.Rows, limit int) ([]QueryResultSet, error) {
	cols, err := skipEmptyLeadingSets(rows)
	if err != nil {
		return nil, err
	}
	var sets []QueryResultSet
	if len(cols) > 0 {
		page, err := readAllRows(rows, cols, limit)
		if err != nil {
			return nil, err
		}
		sets = append(sets, QueryResultSet{Columns: cols, Rows: page, RowCount: len(page)})
	}
	extra, err := drainFollowingResultSets(rows, limit)
	if err != nil {
		return sets, err
	}
	return append(sets, extra...), nil
}

func buildRoutineInvocation(
	schema, name, kind string,
	tableValued bool,
	args []RoutineCallArg,
) (queryText string, queryArgs []any, slots []outSlot, captureReturn bool, err error) {
	qn, err := qualifiedRoutineName(schema, name)
	if err != nil {
		return "", nil, nil, false, err
	}
	if kind == "function" {
		sqlText, bindArgs, err := buildFunctionCallQuery(qn, tableValued, args)
		return sqlText, bindArgs, nil, false, err
	}
	rpcArgs, slots, err := buildProcedureRPCArgs(args)
	if err != nil {
		return "", nil, nil, false, err
	}
	return qn, rpcArgs, slots, true, nil
}

func qualifiedRoutineName(schema, name string) (string, error) {
	s, err := QuoteIdent(schema)
	if err != nil {
		return "", err
	}
	n, err := QuoteIdent(name)
	if err != nil {
		return "", err
	}
	return s + "." + n, nil
}

func buildProcedureRPCArgs(args []RoutineCallArg) ([]any, []outSlot, error) {
	queryArgs := make([]any, 0, len(args))
	var slots []outSlot
	for i, a := range args {
		if err := rejectUnsupportedArg(a); err != nil {
			return nil, nil, err
		}
		if skipOptionalIn(a) {
			continue
		}
		ordinal := a.Ordinal
		if ordinal <= 0 {
			ordinal = i + 1
		}
		pname := rpcParamName(a.Name, ordinal)
		if !isSafeParamIdent(pname) {
			return nil, nil, fmt.Errorf("sqlserver: unsafe parameter name %q", a.Name)
		}
		display := strings.TrimSpace(a.Name)
		if display == "" {
			display = "@" + pname
		}
		dataType := a.typeLabel()
		kind := a.typeKey()

		if isOutputMode(a.Mode) {
			dest := newOutDest(kind)
			in := false
			if a.IsNull {
				in = true
			} else if strings.TrimSpace(a.Value) != "" {
				parsed, err := parseBindValue(a.Value, dataType, false, false)
				if err != nil {
					return nil, nil, err
				}
				if err := seedOutDest(dest, parsed); err != nil {
					return nil, nil, err
				}
				in = parsed != nil
			}
			queryArgs = append(queryArgs, sql.Named(pname, sql.Out{Dest: dest, In: in}))
			slots = append(slots, outSlot{name: pname, display: display, dataType: dataType, dest: dest})
			continue
		}

		parsed, err := parseBindValue(a.Value, dataType, a.IsNull, true)
		if err != nil {
			return nil, nil, err
		}
		queryArgs = append(queryArgs, sql.Named(pname, parsed))
	}
	return queryArgs, slots, nil
}

func buildFunctionCallQuery(qn string, tableValued bool, args []RoutineCallArg) (string, []any, error) {
	placeholders := make([]string, 0, len(args))
	queryArgs := make([]any, 0, len(args))
	for i, a := range args {
		if err := rejectUnsupportedArg(a); err != nil {
			return "", nil, err
		}
		if skipOptionalIn(a) {
			placeholders = append(placeholders, "DEFAULT")
			continue
		}
		ordinal := a.Ordinal
		if ordinal <= 0 {
			ordinal = i + 1
		}
		pname := rpcParamName(a.Name, ordinal)
		if !isSafeParamIdent(pname) {
			return "", nil, fmt.Errorf("sqlserver: unsafe parameter name %q", a.Name)
		}
		parsed, err := parseBindValue(a.Value, a.typeLabel(), a.IsNull, true)
		if err != nil {
			return "", nil, err
		}
		placeholders = append(placeholders, "@"+pname)
		queryArgs = append(queryArgs, sql.Named(pname, parsed))
	}
	argList := strings.Join(placeholders, ", ")
	if tableValued {
		return "SELECT * FROM " + qn + "(" + argList + ")", queryArgs, nil
	}
	return "SELECT " + qn + "(" + argList + ") AS [result]", queryArgs, nil
}

func displayArgName(a RoutineCallArg, index int) string {
	if s := strings.TrimSpace(a.Name); s != "" {
		return s
	}
	return fmt.Sprintf("@p%d", index+1)
}

func rejectUnsupportedArg(a RoutineCallArg) error {
	label := displayArgName(a, a.Ordinal)
	if a.IsCursor {
		return fmt.Errorf("sqlserver: cursor parameter %s is not supported via RPC", label)
	}
	if a.IsTableType {
		return fmt.Errorf("sqlserver: table-valued parameter %s is not bound via RPC; copy the T-SQL script and INSERT rows before EXEC", label)
	}
	switch a.typeKey() {
	case "GEOGRAPHY", "GEOMETRY", "HIERARCHYID":
		return fmt.Errorf("sqlserver: parameter %s type %s is not supported via RPC", label, a.typeLabel())
	}
	return nil
}

package dataio

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"niuma/services/sqlserver-service/internal/meta"
	"niuma/services/sqlserver-service/internal/tree"
)

const dumpFormatVersion = "niuma-sqlserver-dump/2"

type dumpTarget struct {
	Schema string
	Name   string
	Type   string // table | view | synonym | procedure | function | sequence
}

func dumpSql(ctx context.Context, db *sql.DB, taskID string, m *Manager, params DumpParams) error {
	schemas, err := resolveDumpSchemas(ctx, db, params)
	if err != nil {
		return err
	}
	if len(schemas) == 0 {
		return fmt.Errorf("sqlserver: no schemas to dump")
	}

	targets, err := listDumpTargets(ctx, db, params, schemas)
	if err != nil {
		return err
	}

	includeStructure := params.Mode == DumpStructureAndData || params.Mode == DumpStructureOnly
	includeData := params.Mode == DumpStructureAndData || params.Mode == DumpDataOnly
	wantCreateSchema := includeStructure && dumpWantCreateSchema(params)
	if len(targets) == 0 && !(wantCreateSchema && hasCreatableSchema(schemas)) {
		return fmt.Errorf("sqlserver: no objects to dump")
	}

	f, err := os.Create(params.OutputPath)
	if err != nil {
		return fmt.Errorf("sqlserver: create dump file: %w", err)
	}
	defer f.Close()

	bw := bufio.NewWriterSize(f, 256*1024)
	defer func() { _ = bw.Flush() }()

	cw := &countingWriter{w: bw, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("wrote %d bytes", n))
	}}

	schemaField, schemasLine := dumpSchemaHeaderFields(params, schemas)
	header := fmt.Sprintf(
		"-- NiuMa SQL Server dump\n-- format: %s\n-- database: %s\n-- schema: %s\n%s-- generated: %s\n-- mode: %s\n-- dropIfExists: %v\n-- truncateBeforeData: %v\n-- excludeSystem: %v\n-- createSchema: %v\n-- note: GO is a client batch separator; do not send GO to the server\n\nSET NOCOUNT ON;\nSET XACT_ABORT ON;\nGO\nUSE %s;\nGO\n\n",
		dumpFormatVersion,
		params.Database,
		schemaField,
		schemasLine,
		time.Now().UTC().Format(time.RFC3339),
		params.Mode,
		params.DropIfExists,
		params.TruncateBeforeData,
		dumpWantExcludeSystem(params),
		dumpWantCreateSchema(params),
		quoteIdent(params.Database),
	)
	if _, err := cw.Write([]byte(header)); err != nil {
		return err
	}

	if wantCreateSchema {
		if err := writeSchemaDDL(cw, schemas); err != nil {
			return err
		}
	}

	for i, t := range targets {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		m.emitProgress(taskID, PhaseRunning, cw.n, int64(i),
			fmt.Sprintf("dumping %s.%s (%d/%d)", t.Schema, t.Name, i+1, len(targets)))

		qn := qualifiedName(t.Schema, t.Name)
		isTable := t.Type == "table"

		if includeStructure {
			if params.DropIfExists {
				drop := dropStatement(t)
				if _, err := cw.Write([]byte(drop + "\nGO\n")); err != nil {
					return err
				}
			}
			ddlStr, err := fetchDumpDDL(ctx, db, t)
			if err != nil {
				return err
			}
			ddlStr = strings.TrimRight(ddlStr, "; \n\t")
			block := fmt.Sprintf("-- Object: %s.%s (%s)\n%s\nGO\n\n", t.Schema, t.Name, t.Type, ddlStr)
			if _, err := cw.Write([]byte(block)); err != nil {
				return err
			}
		}

		if includeData && isTable {
			if params.TruncateBeforeData {
				if _, err := cw.Write([]byte("TRUNCATE TABLE " + qn + ";\nGO\n")); err != nil {
					return err
				}
			}
			if err := writeInsertData(ctx, db, cw, taskID, m, t.Schema, t.Name); err != nil {
				return err
			}
		}
	}

	m.emitProgress(taskID, PhaseRunning, cw.n, int64(len(targets)),
		fmt.Sprintf("dumped %d object(s)", len(targets)))
	return nil
}

func dropStatement(t dumpTarget) string {
	qn := qualifiedName(t.Schema, t.Name)
	switch t.Type {
	case "view":
		return "DROP VIEW IF EXISTS " + qn + ";"
	case "procedure":
		return "DROP PROCEDURE IF EXISTS " + qn + ";"
	case "function":
		return "DROP FUNCTION IF EXISTS " + qn + ";"
	case "sequence":
		return "DROP SEQUENCE IF EXISTS " + qn + ";"
	case "synonym":
		return "DROP SYNONYM IF EXISTS " + qn + ";"
	default:
		return "DROP TABLE IF EXISTS " + qn + ";"
	}
}

func fetchDumpDDL(ctx context.Context, db *sql.DB, t dumpTarget) (string, error) {
	switch t.Type {
	case "procedure", "function", "sequence", "view":
		src, err := meta.GetRoutineSource(ctx, db, meta.RoutineRef{
			Schema: t.Schema,
			Name:   t.Name,
			Kind:   t.Type,
		})
		if err != nil {
			return "", fmt.Errorf("sqlserver: dump %s %s.%s: %w", t.Type, t.Schema, t.Name, err)
		}
		return src.Definition, nil
	default:
		ddl, err := meta.GetDDL(ctx, db, meta.RelationRef{Schema: t.Schema, Name: t.Name})
		if err != nil {
			return "", fmt.Errorf("sqlserver: dump ddl %s.%s: %w", t.Schema, t.Name, err)
		}
		return ddl.DDL, nil
	}
}

func dumpSchemaHeaderFields(params DumpParams, schemas []string) (schemaField, schemasLine string) {
	if strings.TrimSpace(params.Schema) != "" {
		return params.Schema, ""
	}
	return "*", "-- schemas: " + strings.Join(schemas, ", ") + "\n"
}

func shouldEmitCreateSchema(name string) bool {
	n := strings.TrimSpace(name)
	if n == "" || strings.EqualFold(n, "dbo") || tree.IsSystemSchema(n) {
		return false
	}
	return true
}

func hasCreatableSchema(schemas []string) bool {
	for _, s := range schemas {
		if shouldEmitCreateSchema(s) {
			return true
		}
	}
	return false
}

func createSchemaBlock(schema string) string {
	return fmt.Sprintf(
		"IF SCHEMA_ID(%s) IS NULL\n  EXEC(N'CREATE SCHEMA %s');\nGO\n",
		quoteLiteral(schema),
		quoteIdent(schema),
	)
}

func writeSchemaDDL(w *countingWriter, schemas []string) error {
	wrote := false
	for _, s := range schemas {
		if !shouldEmitCreateSchema(s) {
			continue
		}
		if _, err := w.Write([]byte(createSchemaBlock(s))); err != nil {
			return err
		}
		wrote = true
	}
	if wrote {
		if _, err := w.Write([]byte("\n")); err != nil {
			return err
		}
	}
	return nil
}

func resolveDumpSchemas(ctx context.Context, db *sql.DB, params DumpParams) ([]string, error) {
	schema := strings.TrimSpace(params.Schema)
	if schema != "" {
		return []string{schema}, nil
	}
	res, err := tree.ListSchemas(ctx, db, tree.ListParams{
		ExcludeSystem: dumpWantExcludeSystem(params),
		Limit:         tree.MaxLimit,
	})
	if err != nil {
		return nil, err
	}
	if res.Truncated {
		return nil, fmt.Errorf("sqlserver: too many schemas to dump (limit %d)", tree.MaxLimit)
	}
	out := make([]string, 0, len(res.Schemas))
	for _, s := range res.Schemas {
		name := strings.TrimSpace(s.Name)
		if name == "" {
			continue
		}
		out = append(out, name)
	}
	return out, nil
}

func listDumpTargets(ctx context.Context, db *sql.DB, params DumpParams, schemas []string) ([]dumpTarget, error) {
	if len(schemas) == 0 {
		return nil, nil
	}
	wanted := map[string]struct{}{}
	for _, name := range params.Tables {
		name = strings.TrimSpace(name)
		if name != "" {
			wanted[strings.ToLower(name)] = struct{}{}
		}
	}

	pholders := make([]string, len(schemas))
	args := make([]any, 0, len(schemas))
	for i, s := range schemas {
		pholders[i] = fmt.Sprintf("@p%d", i+1)
		args = append(args, s)
	}

	q := fmt.Sprintf(`
SELECT s.name, o.name, o.type
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE s.name IN (%s) AND o.is_ms_shipped = 0
  AND o.type IN (N'U', N'V', N'SN', N'P', N'PC', N'FN', N'IF', N'TF', N'FS', N'FT', N'SO')
ORDER BY s.name,
  CASE o.type
    WHEN N'U' THEN 1
    WHEN N'SN' THEN 2
    WHEN N'V' THEN 3
    WHEN N'SO' THEN 4
    WHEN N'P' THEN 5
    WHEN N'PC' THEN 5
    ELSE 6
  END, o.name`, strings.Join(pholders, ", "))

	rows, err := db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("sqlserver: list dump objects: %w", err)
	}
	defer rows.Close()

	var out []dumpTarget
	for rows.Next() {
		var sch, name, typ string
		if err := rows.Scan(&sch, &name, &typ); err != nil {
			return nil, err
		}
		kind := objectTypeFromSys(typ)
		if kind == "" || !includeDumpKind(params, kind) {
			continue
		}
		if len(wanted) > 0 {
			if _, ok := wanted[strings.ToLower(name)]; !ok {
				continue
			}
		}
		out = append(out, dumpTarget{Schema: sch, Name: name, Type: kind})
	}
	return out, rows.Err()
}

func objectTypeFromSys(typ string) string {
	switch strings.ToUpper(strings.TrimSpace(typ)) {
	case "U":
		return "table"
	case "V":
		return "view"
	case "SN":
		return "synonym"
	case "P", "PC":
		return "procedure"
	case "FN", "IF", "TF", "FS", "FT":
		return "function"
	case "SO":
		return "sequence"
	default:
		return ""
	}
}

func includeDumpKind(params DumpParams, kind string) bool {
	switch kind {
	case "table":
		return params.IncludeTables
	case "view":
		return params.IncludeViews
	case "procedure":
		return params.IncludeProcedures
	case "function":
		return params.IncludeFunctions
	case "synonym":
		return params.IncludeSynonyms
	case "sequence":
		return params.IncludeSequences
	default:
		return false
	}
}

func writeInsertData(
	ctx context.Context,
	db *sql.DB,
	cw *countingWriter,
	taskID string,
	m *Manager,
	schema, table string,
) error {
	qn := qualifiedName(schema, table)
	hasIdentity, err := tableHasIdentity(ctx, db, schema, table)
	if err != nil {
		return err
	}

	rows, err := db.QueryContext(ctx, "SELECT * FROM "+qn)
	if err != nil {
		return fmt.Errorf("sqlserver: dump select %s: %w", qn, err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return err
	}
	if len(cols) == 0 {
		return nil
	}
	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return err
	}
	typeNames := make([]string, len(colTypes))
	for i, ct := range colTypes {
		typeNames[i] = strings.ToUpper(strings.TrimSpace(ct.DatabaseTypeName()))
	}

	quotedCols := make([]string, len(cols))
	for i, c := range cols {
		quotedCols[i] = quoteIdent(c)
	}
	colList := strings.Join(quotedCols, ", ")

	if hasIdentity {
		if _, err := cw.Write([]byte("SET IDENTITY_INSERT " + qn + " ON;\nGO\n")); err != nil {
			return err
		}
	}

	raw := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range raw {
		ptrs[i] = &raw[i]
	}

	const batchSize = 50
	var (
		batch    [][]string
		rowCount int64
	)

	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		var sb strings.Builder
		sb.WriteString("INSERT INTO ")
		sb.WriteString(qn)
		sb.WriteString(" (")
		sb.WriteString(colList)
		sb.WriteString(") VALUES\n")
		for i, row := range batch {
			if i > 0 {
				sb.WriteString(",\n")
			}
			sb.WriteString("(")
			sb.WriteString(strings.Join(row, ", "))
			sb.WriteString(")")
		}
		sb.WriteString(";\nGO\n")
		if _, err := cw.Write([]byte(sb.String())); err != nil {
			return err
		}
		batch = batch[:0]
		m.emitProgress(taskID, PhaseRunning, cw.n, rowCount,
			fmt.Sprintf("dumped %s: %d rows", table, rowCount))
		return nil
	}

	for rows.Next() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if err := rows.Scan(ptrs...); err != nil {
			return err
		}
		vals := make([]string, len(cols))
		for i, v := range raw {
			vals[i] = sqlLiteral(v, typeNames[i])
		}
		batch = append(batch, vals)
		rowCount++
		if len(batch) >= batchSize {
			if err := flush(); err != nil {
				return err
			}
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := flush(); err != nil {
		return err
	}
	if hasIdentity {
		if _, err := cw.Write([]byte("SET IDENTITY_INSERT " + qn + " OFF;\nGO\n")); err != nil {
			return err
		}
	}
	return nil
}

func sqlLiteral(v interface{}, dbType string) string {
	if v == nil {
		return "NULL"
	}
	switch t := v.(type) {
	case []byte:
		if utf8.Valid(t) {
			return quoteLiteral(string(t))
		}
		return "0x" + fmt.Sprintf("%x", t)
	case string:
		return quoteLiteral(t)
	case time.Time:
		return quoteLiteral(formatTemporalCSV(t, dbType))
	case bool:
		if t {
			return "1"
		}
		return "0"
	case int, int32, int64, float32, float64:
		return fmt.Sprint(t)
	default:
		return quoteLiteral(fmt.Sprint(t))
	}
}

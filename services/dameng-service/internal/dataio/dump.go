package dataio

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"niuma/services/dameng-service/internal/meta"
)

type dumpObject struct {
	Name   string
	Type   string // table | view | procedure | function | package | synonym | trigger | sequence
	Blocks []string
}

func dumpSql(
	ctx context.Context,
	db *sql.DB,
	taskID string,
	m *Manager,
	params DumpParams,
) error {
	schema := strings.TrimSpace(params.Schema)
	objects, err := resolveDumpObjects(ctx, db, schema, params)
	if err != nil {
		return err
	}
	if len(objects) == 0 {
		return fmt.Errorf("dameng: no objects to dump")
	}

	f, err := os.Create(params.OutputPath)
	if err != nil {
		return fmt.Errorf("dameng: create dump file: %w", err)
	}
	defer f.Close()

	bw := bufio.NewWriterSize(f, 256*1024)

	cw := &countingWriter{w: bw, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("wrote %d bytes", n))
	}}

	header := fmt.Sprintf(
		"-- NiuMa Dameng dump\n-- format: niuma-dameng-dump/3\n-- schema: %s\n-- generated: %s\n-- mode: %s\n-- dropIfExists: %v\n-- truncateBeforeData: %v\n-- note: object names are unqualified so restore can target another schema via CURRENT_SCHEMA\n-- note: PL/SQL units (procedure/function/package/trigger) are terminated with a lone /\n\n",
		schema,
		time.Now().UTC().Format(time.RFC3339),
		params.Mode,
		params.DropIfExists,
		params.TruncateBeforeData,
	)
	if _, err := cw.Write([]byte(header)); err != nil {
		return err
	}

	includeStructure := params.Mode == DumpStructureAndData || params.Mode == DumpStructureOnly
	includeData := params.Mode == DumpStructureAndData || params.Mode == DumpDataOnly

	// 按依赖友好顺序排序：创建与 DROP 反向。
	sort.SliceStable(objects, func(i, j int) bool {
		ri, rj := createRank(objects[i].Type), createRank(objects[j].Type)
		if ri != rj {
			return ri < rj
		}
		return objects[i].Name < objects[j].Name
	})

	if includeStructure && params.DropIfExists {
		if _, err := cw.Write([]byte("-- Drops (dependency-safe order)\n")); err != nil {
			return err
		}
		for i := len(objects) - 1; i >= 0; i-- {
			obj := objects[i]
			drop := dropStatement(obj.Type, quoteIdent(obj.Name))
			if drop == "" {
				continue
			}
			if _, err := cw.Write([]byte(drop)); err != nil {
				return err
			}
		}
		if _, err := cw.Write([]byte("\n")); err != nil {
			return err
		}
	}

	total := len(objects)
	for i, obj := range objects {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		m.emitProgress(taskID, PhaseRunning, cw.n, int64(i+1),
			fmt.Sprintf("dumping %s (%d/%d)", obj.Name, i+1, total))

		isTable := obj.Type == "table"
		srcQN := qualifiedName(schema, obj.Name)
		destQN := quoteIdent(obj.Name)

		if includeStructure {
			for bi, block := range obj.Blocks {
				ddl := strings.TrimSpace(stripSchemaQualifier(block, schema))
				ddl = trimPlsqlTerminators(ddl)
				if ddl == "" {
					continue
				}
				label := obj.Name
				if len(obj.Blocks) > 1 {
					label = fmt.Sprintf("%s#%d", obj.Name, bi+1)
				}
				var chunk string
				if isPlsqlObjectType(obj.Type) {
					chunk = fmt.Sprintf("-- Object: %s (%s)\n%s\n/\n\n", label, obj.Type, ddl)
				} else {
					chunk = fmt.Sprintf("-- Object: %s (%s)\n%s;\n\n", label, obj.Type, ddl)
				}
				if _, err := cw.Write([]byte(chunk)); err != nil {
					return err
				}
			}
		}

		if includeData && isTable {
			if params.TruncateBeforeData {
				trunc := fmt.Sprintf("DELETE FROM %s;\n", destQN)
				if _, err := cw.Write([]byte(trunc)); err != nil {
					return err
				}
			}
			if err := writeInsertData(ctx, db, cw, taskID, m, srcQN, destQN, obj.Name); err != nil {
				return err
			}
		}
	}

	// 先落盘再发完成进度，避免 Flush 堵在「dumped」之后导致 UI 一直运行中
	if err := bw.Flush(); err != nil {
		return fmt.Errorf("dameng: flush dump file: %w", err)
	}
	m.emitProgress(taskID, PhaseRunning, cw.n, int64(total),
		fmt.Sprintf("dumped %d object(s)", total))
	return nil
}

func createRank(objType string) int {
	switch objType {
	case "sequence":
		return 1
	case "table":
		return 2
	case "view":
		return 3
	case "synonym":
		return 4
	case "procedure":
		return 5
	case "function":
		return 6
	case "package":
		return 7
	case "trigger":
		return 8
	default:
		return 9
	}
}

func isPlsqlObjectType(objType string) bool {
	switch objType {
	case "procedure", "function", "package", "trigger":
		return true
	default:
		return false
	}
}

func dropStatement(objType, qn string) string {
	switch objType {
	case "table":
		return fmt.Sprintf("DROP TABLE IF EXISTS %s;\n", qn)
	case "view":
		return fmt.Sprintf("DROP VIEW IF EXISTS %s;\n", qn)
	case "procedure":
		return fmt.Sprintf("DROP PROCEDURE IF EXISTS %s;\n", qn)
	case "function":
		return fmt.Sprintf("DROP FUNCTION IF EXISTS %s;\n", qn)
	case "package":
		return fmt.Sprintf("DROP PACKAGE IF EXISTS %s;\n", qn)
	case "synonym":
		return fmt.Sprintf("DROP SYNONYM IF EXISTS %s;\n", qn)
	case "trigger":
		return fmt.Sprintf("DROP TRIGGER IF EXISTS %s;\n", qn)
	case "sequence":
		return fmt.Sprintf("DROP SEQUENCE IF EXISTS %s;\n", qn)
	default:
		return ""
	}
}

func resolveDumpObjects(ctx context.Context, db *sql.DB, schema string, params DumpParams) ([]dumpObject, error) {
	want := make(map[string]struct{}, len(params.Tables))
	for _, t := range params.Tables {
		t = strings.TrimSpace(t)
		if t != "" {
			want[strings.ToUpper(t)] = struct{}{}
			want[t] = struct{}{}
		}
	}
	// Tables 来自 UI 对象列表：schema 整库转储时只列了表/视图名。
	// 若把该列表当成全局名称过滤，过程/函数/包/同义词/触发器/序列会被全部丢掉。
	// 仅当同时包含表或视图时，名称过滤只作用于 table/view；
	// 单对象/分类转储（未包含表视图）时，Tables 仍作为当前类型的名称过滤。
	nameFilterTablesViewsOnly := len(want) > 0 && (params.IncludeTables || params.IncludeViews)

	typeSpecs := make([]string, 0, 8)
	if params.IncludeTables {
		typeSpecs = append(typeSpecs, "TABLE")
	}
	if params.IncludeViews {
		typeSpecs = append(typeSpecs, "VIEW")
	}
	if params.IncludeProcedures {
		typeSpecs = append(typeSpecs, "PROCEDURE")
	}
	if params.IncludeFunctions {
		typeSpecs = append(typeSpecs, "FUNCTION")
	}
	if params.IncludePackages {
		typeSpecs = append(typeSpecs, "PACKAGE")
	}
	if params.IncludeTriggers {
		typeSpecs = append(typeSpecs, "TRIGGER")
	}
	if params.IncludeSequences {
		typeSpecs = append(typeSpecs, "SEQUENCE")
	}
	includeSynonyms := params.IncludeSynonyms
	if len(typeSpecs) == 0 && !includeSynonyms {
		return nil, nil
	}

	var out []dumpObject
	appendObject := func(name, typ string) error {
		name = strings.TrimSpace(name)
		typ = strings.ToUpper(strings.TrimSpace(typ))
		objType := dumpObjectType(typ)
		if len(want) > 0 && !dumpObjectNameAllowed(objType, name, want, nameFilterTablesViewsOnly) {
			return nil
		}
		blocks, err := loadObjectDDLBlocks(ctx, db, schema, name, typ)
		if err != nil {
			return err
		}
		if len(blocks) == 0 {
			return nil
		}
		out = append(out, dumpObject{Name: name, Type: objType, Blocks: blocks})
		return nil
	}

	if len(typeSpecs) > 0 {
		placeholders := make([]string, len(typeSpecs))
		args := make([]any, 0, 1+len(typeSpecs))
		args = append(args, schema)
		for i, t := range typeSpecs {
			placeholders[i] = "?"
			args = append(args, t)
		}
		q := fmt.Sprintf(`
SELECT OBJECT_NAME, OBJECT_TYPE
FROM ALL_OBJECTS
WHERE OWNER = ? AND OBJECT_TYPE IN (%s)
ORDER BY OBJECT_NAME`, strings.Join(placeholders, ", "))

		rows, err := db.QueryContext(ctx, q, args...)
		if err != nil {
			return nil, fmt.Errorf("dameng: list dump objects: %w", err)
		}
		for rows.Next() {
			var name, typ string
			if err := rows.Scan(&name, &typ); err != nil {
				rows.Close()
				return nil, err
			}
			if err := appendObject(name, typ); err != nil {
				rows.Close()
				return nil, err
			}
		}
		errRows := rows.Err()
		_ = rows.Close()
		if errRows != nil {
			return nil, errRows
		}
	}

	// 同义词：优先 SYSOBJECTS(SYNOM)，再 ALL_SYNONYMS
	if includeSynonyms {
		names, err := listDumpSynonymNames(ctx, db, schema)
		if err != nil {
			return nil, err
		}
		for _, name := range names {
			if err := appendObject(name, "SYNONYM"); err != nil {
				return nil, err
			}
		}
	}
	return out, nil
}

func listDumpSynonymNames(ctx context.Context, db *sql.DB, schema string) ([]string, error) {
	rows, err := db.QueryContext(ctx, `
SELECT o.NAME
FROM SYSOBJECTS o
INNER JOIN SYSOBJECTS s ON o.SCHID = s.ID AND s.TYPE$ = 'SCH'
WHERE UPPER(s.NAME) = UPPER(?)
  AND o.TYPE$ = 'SCHOBJ'
  AND o.SUBTYPE$ = 'SYNOM'
ORDER BY o.NAME`, schema)
	if err != nil {
		rows, err = db.QueryContext(ctx,
			`SELECT SYNONYM_NAME FROM ALL_SYNONYMS WHERE UPPER(OWNER) = UPPER(?) ORDER BY SYNONYM_NAME`,
			schema)
		if err != nil {
			return nil, fmt.Errorf("dameng: list dump synonyms: %w", err)
		}
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}

// dumpObjectNameAllowed 判断对象是否通过 Tables 名称过滤。
func dumpObjectNameAllowed(
	objType, name string,
	want map[string]struct{},
	tablesViewsOnly bool,
) bool {
	if len(want) == 0 {
		return true
	}
	if tablesViewsOnly && objType != "table" && objType != "view" {
		return true
	}
	if _, ok := want[name]; ok {
		return true
	}
	_, ok := want[strings.ToUpper(name)]
	return ok
}

func dumpObjectType(objectType string) string {
	switch strings.ToUpper(objectType) {
	case "TABLE":
		return "table"
	case "VIEW":
		return "view"
	case "PROCEDURE":
		return "procedure"
	case "FUNCTION":
		return "function"
	case "PACKAGE", "PACKAGE BODY":
		return "package"
	case "SYNONYM":
		return "synonym"
	case "TRIGGER":
		return "trigger"
	case "SEQUENCE":
		return "sequence"
	default:
		return strings.ToLower(objectType)
	}
}

func loadObjectDDLBlocks(ctx context.Context, db *sql.DB, schema, name, objectType string) ([]string, error) {
	switch objectType {
	case "TABLE", "VIEW", "TRIGGER", "SEQUENCE":
		ddl, err := meta.GetMetadataDDL(ctx, db, objectType, schema, name)
		if err != nil {
			return nil, err
		}
		return []string{ddl}, nil
	case "SYNONYM":
		ddl, err := meta.GetMetadataDDL(ctx, db, "SYNONYM", schema, name)
		if err != nil {
			res, err2 := meta.GetDDL(ctx, db, meta.RelationRef{Schema: schema, Name: name})
			if err2 != nil {
				return nil, err
			}
			ddl = res.DDL
		}
		return []string{ddl}, nil
	case "PROCEDURE", "FUNCTION":
		kind := "procedure"
		if objectType == "FUNCTION" {
			kind = "function"
		}
		res, err := meta.GetRoutineSource(ctx, db, meta.RoutineRef{
			Schema: schema,
			Name:   name,
			Kind:   kind,
		})
		if err != nil {
			return nil, err
		}
		return []string{ensureCreateOrReplace(res.Definition, objectType)}, nil
	case "PACKAGE":
		blocks, err := loadPackageDDLBlocks(ctx, db, schema, name)
		if err != nil {
			return nil, err
		}
		return blocks, nil
	default:
		return nil, nil
	}
}

// loadPackageDDLBlocks 分别取出包头与包体，避免 PACKAGE 合并 DDL 导致执行 -2007。
func loadPackageDDLBlocks(ctx context.Context, db *sql.DB, schema, name string) ([]string, error) {
	var (
		spec string
		body string
	)

	if s, err := meta.GetMetadataDDL(ctx, db, "PKG_SPEC", schema, name); err == nil {
		spec = s
	}
	if b, err := meta.GetMetadataDDL(ctx, db, "PKG_BODY", schema, name); err == nil {
		body = b
	}
	if body == "" {
		if b, err := meta.GetMetadataDDL(ctx, db, "PACKAGE BODY", schema, name); err == nil {
			body = b
		}
	}

	if spec == "" {
		raw, err := meta.GetMetadataDDL(ctx, db, "PACKAGE", schema, name)
		if err != nil {
			return nil, err
		}
		var fromBody string
		spec, fromBody = splitPackageSpecBody(raw)
		if body == "" {
			body = fromBody
		}
	} else {
		// PKG_SPEC 偶发仍带包体
		s2, b2 := splitPackageSpecBody(spec)
		spec = s2
		if body == "" {
			body = b2
		}
	}

	spec = trimPlsqlTerminators(spec)
	body = trimPlsqlTerminators(body)
	if strings.TrimSpace(spec) == "" {
		return nil, fmt.Errorf("dameng: package ddl not found: %s.%s", schema, name)
	}

	blocks := []string{ensureCreateOrReplace(spec, "PACKAGE")}
	if strings.TrimSpace(body) != "" {
		blocks = append(blocks, ensureCreateOrReplace(body, "PACKAGE BODY"))
	}
	return blocks, nil
}

// ensureCreateOrReplace 保证 ALL_SOURCE 回退文本可执行（补 CREATE OR REPLACE）。
func ensureCreateOrReplace(ddl, objectType string) string {
	s := strings.TrimSpace(ddl)
	if s == "" {
		return s
	}
	upper := strings.ToUpper(s)
	if strings.HasPrefix(upper, "CREATE") {
		if strings.HasPrefix(upper, "CREATE OR REPLACE") {
			return s
		}
		return "CREATE OR REPLACE " + strings.TrimSpace(s[len("CREATE"):])
	}
	// ALL_SOURCE 常见以 PROCEDURE/FUNCTION/PACKAGE 开头
	ot := strings.ToUpper(strings.TrimSpace(objectType))
	switch {
	case strings.HasPrefix(upper, "PROCEDURE"),
		strings.HasPrefix(upper, "FUNCTION"),
		strings.HasPrefix(upper, "PACKAGE"):
		return "CREATE OR REPLACE " + s
	case ot != "":
		return "CREATE OR REPLACE " + ot + " " + s
	default:
		return "CREATE OR REPLACE " + s
	}
}

// stripSchemaQualifier 去掉 DDL / DML 中的 "schema". 前缀，便于还原到另一 schema。
// 仅匹配双引号限定形式（与 quoteIdent 一致）。注意：字面量中若出现同形 `"schema".` 也会被替换。
func stripSchemaQualifier(sqlText, schema string) string {
	schema = strings.TrimSpace(schema)
	if schema == "" || sqlText == "" {
		return sqlText
	}
	prefix := quoteIdent(schema) + "."
	return strings.ReplaceAll(sqlText, prefix, "")
}

func writeInsertData(
	ctx context.Context,
	db *sql.DB,
	cw *countingWriter,
	taskID string,
	m *Manager,
	srcTable, destTable, tableName string,
) error {
	rows, err := db.QueryContext(ctx, "SELECT * FROM "+srcTable)
	if err != nil {
		return fmt.Errorf("dameng: dump select %s: %w", tableName, err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return err
	}
	if len(cols) == 0 {
		return nil
	}

	quotedCols := make([]string, len(cols))
	for i, c := range cols {
		quotedCols[i] = quoteIdent(c)
	}
	colList := strings.Join(quotedCols, ", ")

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
		sb.WriteString(destTable)
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
		sb.WriteString(";\n")
		if _, err := cw.Write([]byte(sb.String())); err != nil {
			return err
		}
		batch = batch[:0]
		m.emitProgress(taskID, PhaseRunning, cw.n, rowCount,
			fmt.Sprintf("dumped %s: %d rows", tableName, rowCount))
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
			vals[i] = sqlLiteral(v)
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
	return flush()
}

func sqlLiteral(v interface{}) string {
	if v == nil {
		return "NULL"
	}
	switch t := v.(type) {
	case []byte:
		if len(t) == 0 {
			return "''"
		}
		allPrintable := true
		for _, b := range t {
			if b < 0x20 && b != '\t' && b != '\n' && b != '\r' {
				allPrintable = false
				break
			}
		}
		if allPrintable {
			return quoteLiteral(string(t))
		}
		return fmt.Sprintf("HEXTORAW('%x')", t)
	case string:
		return quoteLiteral(t)
	case int64:
		return fmt.Sprintf("%d", t)
	case float64:
		return fmt.Sprintf("%g", t)
	case bool:
		if t {
			return "1"
		}
		return "0"
	case time.Time:
		return quoteLiteral(t.Format("2006-01-02 15:04:05.999999"))
	default:
		return quoteLiteral(fmt.Sprint(t))
	}
}

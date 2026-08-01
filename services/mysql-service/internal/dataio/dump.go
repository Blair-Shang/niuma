package dataio

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

// dumpTarget 描述单个待转储表/视图。
type dumpTarget struct {
	Name string
	Type string // "BASE TABLE" 或 "VIEW"
}

// dumpRoutine 描述单个待转储例程。
type dumpRoutine struct {
	Name string
	Kind string // "PROCEDURE" 或 "FUNCTION"
}

// dumpSql 生成 MySQL 数据库的结构/数据转储文件（纯 Go 实现，不依赖 mysqldump CLI）。
// 对齐 Navicat / DBeaver / mysqldump：表·视图·过程·函数·触发器·事件；可选 CREATE DATABASE。
func dumpSql(
	ctx context.Context,
	db *sql.DB,
	taskID string,
	m *Manager,
	params DumpParams,
) error {
	targets, err := resolveDumpTargets(ctx, db, params)
	if err != nil {
		return err
	}
	routines, err := resolveDumpRoutines(ctx, db, params)
	if err != nil {
		return err
	}
	triggers, err := resolveDumpTriggers(ctx, db, params)
	if err != nil {
		return err
	}
	events, err := resolveDumpEvents(ctx, db, params)
	if err != nil {
		return err
	}
	if len(targets) == 0 && len(routines) == 0 && len(triggers) == 0 && len(events) == 0 {
		return fmt.Errorf("mysql: no objects to dump")
	}

	f, err := os.Create(params.OutputPath)
	if err != nil {
		return fmt.Errorf("mysql: create dump file: %w", err)
	}
	defer f.Close()

	// 256KiB 缓冲：避免逐行 syscall，也避免把整表攒在内存里
	bw := bufio.NewWriterSize(f, 256*1024)
	defer func() { _ = bw.Flush() }()

	cw := &countingWriter{w: bw, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("wrote %d bytes", n))
	}}

	header := fmt.Sprintf(
		"-- NiuMa MySQL dump\n-- format: niuma-mysql-dump/4\n-- database: %s\n-- generated: %s\n-- mode: %s\n-- dropIfExists: %v\n-- truncateBeforeData: %v\n-- includeCreateDatabase: %v\n-- includeProcedures: %v\n-- includeFunctions: %v\n-- includeTriggers: %v\n-- includeEvents: %v\n-- note: object names are unqualified so restore can target another database\n\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\nSET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n\n",
		params.Database,
		time.Now().UTC().Format(time.RFC3339),
		params.Mode,
		params.DropIfExists,
		params.TruncateBeforeData,
		params.IncludeCreateDatabase,
		params.IncludeProcedures,
		params.IncludeFunctions,
		params.IncludeTriggers,
		params.IncludeEvents,
	)
	if _, err := cw.Write([]byte(header)); err != nil {
		return err
	}

	includeStructure := params.Mode == DumpStructureAndData || params.Mode == DumpStructureOnly
	includeData := params.Mode == DumpStructureAndData || params.Mode == DumpDataOnly

	if includeStructure && params.IncludeCreateDatabase && len(params.Tables) == 0 {
		if err := writeCreateDatabase(ctx, db, cw, params.Database); err != nil {
			return err
		}
	}

	total := len(targets) + len(routines) + len(triggers) + len(events)
	done := 0

	for _, t := range targets {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		done++
		m.emitProgress(taskID, PhaseRunning, cw.n, int64(done),
			fmt.Sprintf("dumping %s (%d/%d)", t.Name, done, total))

		// 落盘用无库名限定名，便于还原到另一库；读源库仍用 db.table。
		obj := quoteIdent(t.Name)
		isTable := t.Type == "BASE TABLE"

		if includeStructure {
			if params.DropIfExists {
				kw := "TABLE"
				if !isTable {
					kw = "VIEW"
				}
				drop := fmt.Sprintf("DROP %s IF EXISTS %s;\n", kw, obj)
				if _, err := cw.Write([]byte(drop)); err != nil {
					return err
				}
			}

			ddlStr, err := fetchCreateSQL(ctx, db, params.Database, t.Name, isTable)
			if err != nil {
				return err
			}
			ddlStr = stripDatabaseQualifier(ddlStr, params.Database)
			block := fmt.Sprintf("-- Object: %s\n%s;\n\n", t.Name, strings.TrimRight(ddlStr, "; \n\t"))
			if _, err := cw.Write([]byte(block)); err != nil {
				return err
			}
		}

		if includeData && isTable {
			if params.TruncateBeforeData {
				trunc := fmt.Sprintf("TRUNCATE TABLE %s;\n", obj)
				if _, err := cw.Write([]byte(trunc)); err != nil {
					return err
				}
			}
			if err := writeInsertData(ctx, db, cw, taskID, m, params.Database, t.Name); err != nil {
				return err
			}
		}
	}

	if includeStructure && len(routines) > 0 {
		if err := writeDelimitedObjects(ctx, db, cw, taskID, m, params, routines, &done, total, "Routines"); err != nil {
			return err
		}
	}

	if includeStructure && len(triggers) > 0 {
		if err := writeDelimitedNamed(ctx, db, cw, taskID, m, params, triggers, &done, total, "TRIGGER", "Triggers", fetchCreateTriggerSQL); err != nil {
			return err
		}
	}

	if includeStructure && len(events) > 0 {
		if err := writeDelimitedNamed(ctx, db, cw, taskID, m, params, events, &done, total, "EVENT", "Events", fetchCreateEventSQL); err != nil {
			return err
		}
	}

	footer := "SET FOREIGN_KEY_CHECKS=1;\n"
	if _, err := cw.Write([]byte(footer)); err != nil {
		return err
	}

	m.emitProgress(taskID, PhaseRunning, cw.n, int64(total),
		fmt.Sprintf("dumped %d object(s)", total))
	return nil
}

// writeCreateDatabase 写入 CREATE DATABASE IF NOT EXISTS + USE。
func writeCreateDatabase(ctx context.Context, db *sql.DB, cw *countingWriter, database string) error {
	row := db.QueryRowContext(ctx,
		`SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`,
		database)
	var charset, collation string
	if err := row.Scan(&charset, &collation); err != nil {
		charset, collation = "utf8mb4", "utf8mb4_general_ci"
	}
	qn := quoteIdent(database)
	block := fmt.Sprintf(
		"-- Database\nCREATE DATABASE IF NOT EXISTS %s DEFAULT CHARACTER SET %s COLLATE %s;\nUSE %s;\n\n",
		qn, charset, collation, qn,
	)
	_, err := cw.Write([]byte(block))
	return err
}

func writeDelimitedObjects(
	ctx context.Context,
	db *sql.DB,
	cw *countingWriter,
	taskID string,
	m *Manager,
	params DumpParams,
	routines []dumpRoutine,
	done *int,
	total int,
	section string,
) error {
	if _, err := cw.Write([]byte(fmt.Sprintf("\n-- %s\nDELIMITER ;;\n\n", section))); err != nil {
		return err
	}
	for _, rt := range routines {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		*done++
		m.emitProgress(taskID, PhaseRunning, cw.n, int64(*done),
			fmt.Sprintf("dumping %s %s (%d/%d)", strings.ToLower(rt.Kind), rt.Name, *done, total))

		obj := quoteIdent(rt.Name)
		if params.DropIfExists {
			drop := fmt.Sprintf("DROP %s IF EXISTS %s;;\n", rt.Kind, obj)
			if _, err := cw.Write([]byte(drop)); err != nil {
				return err
			}
		}
		ddlStr, err := fetchCreateRoutineSQL(ctx, db, params.Database, rt.Name, rt.Kind)
		if err != nil {
			return err
		}
		ddlStr = stripDatabaseQualifier(ddlStr, params.Database)
		block := fmt.Sprintf("-- %s: %s\n%s;;\n\n", rt.Kind, rt.Name, strings.TrimRight(ddlStr, "; \n\t"))
		if _, err := cw.Write([]byte(block)); err != nil {
			return err
		}
	}
	_, err := cw.Write([]byte("DELIMITER ;\n\n"))
	return err
}

func writeDelimitedNamed(
	ctx context.Context,
	db *sql.DB,
	cw *countingWriter,
	taskID string,
	m *Manager,
	params DumpParams,
	names []string,
	done *int,
	total int,
	kind, section string,
	fetch func(context.Context, *sql.DB, string, string) (string, error),
) error {
	if _, err := cw.Write([]byte(fmt.Sprintf("\n-- %s\nDELIMITER ;;\n\n", section))); err != nil {
		return err
	}
	for _, name := range names {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		*done++
		m.emitProgress(taskID, PhaseRunning, cw.n, int64(*done),
			fmt.Sprintf("dumping %s %s (%d/%d)", strings.ToLower(kind), name, *done, total))

		obj := quoteIdent(name)
		if params.DropIfExists {
			drop := fmt.Sprintf("DROP %s IF EXISTS %s;;\n", kind, obj)
			if _, err := cw.Write([]byte(drop)); err != nil {
				return err
			}
		}
		ddlStr, err := fetch(ctx, db, params.Database, name)
		if err != nil {
			return err
		}
		ddlStr = stripDatabaseQualifier(ddlStr, params.Database)
		block := fmt.Sprintf("-- %s: %s\n%s;;\n\n", kind, name, strings.TrimRight(ddlStr, "; \n\t"))
		if _, err := cw.Write([]byte(block)); err != nil {
			return err
		}
	}
	_, err := cw.Write([]byte("DELIMITER ;\n\n"))
	return err
}

// stripDatabaseQualifier 去掉 DDL 中的 `database`. 前缀，便于还原到另一库。
// 仅匹配反引号限定形式（与 quoteIdent 一致），不会误伤字符串字面量。
func stripDatabaseQualifier(sqlText, database string) string {
	db := strings.TrimSpace(database)
	if db == "" || sqlText == "" {
		return sqlText
	}
	prefix := quoteIdent(db) + "."
	return strings.ReplaceAll(sqlText, prefix, "")
}

// fetchCreateSQL 获取表或视图的 CREATE 语句。
func fetchCreateSQL(ctx context.Context, db *sql.DB, database, name string, isTable bool) (string, error) {
	qn := quoteIdent(database) + "." + quoteIdent(name)
	if isTable {
		row := db.QueryRowContext(ctx, "SHOW CREATE TABLE "+qn)
		var tblName, createSQL string
		if err := row.Scan(&tblName, &createSQL); err != nil {
			return "", fmt.Errorf("mysql: show create table %s: %w", name, err)
		}
		return createSQL, nil
	}
	row := db.QueryRowContext(ctx, "SHOW CREATE VIEW "+qn)
	var viewName, createSQL, charSet, collation string
	if err := row.Scan(&viewName, &createSQL, &charSet, &collation); err != nil {
		return "", fmt.Errorf("mysql: show create view %s: %w", name, err)
	}
	return createSQL, nil
}

// fetchCreateRoutineSQL 获取过程或函数的 CREATE 语句。
func fetchCreateRoutineSQL(ctx context.Context, db *sql.DB, database, name, kind string) (string, error) {
	qn := quoteIdent(database) + "." + quoteIdent(name)
	if kind == "FUNCTION" {
		row := db.QueryRowContext(ctx, "SHOW CREATE FUNCTION "+qn)
		var fnName, sqlMode, createSQL, charSet, collation, dbCollation string
		if err := row.Scan(&fnName, &sqlMode, &createSQL, &charSet, &collation, &dbCollation); err != nil {
			return "", fmt.Errorf("mysql: show create function %s: %w", name, err)
		}
		return createSQL, nil
	}
	row := db.QueryRowContext(ctx, "SHOW CREATE PROCEDURE "+qn)
	var procName, sqlMode, createSQL, charSet, collation, dbCollation string
	if err := row.Scan(&procName, &sqlMode, &createSQL, &charSet, &collation, &dbCollation); err != nil {
		return "", fmt.Errorf("mysql: show create procedure %s: %w", name, err)
	}
	return createSQL, nil
}

// writeInsertData 将表数据以 INSERT INTO ... VALUES (...) 形式写入。
//
// 内存策略（对齐 mysqldump 思路，远低于「攒满再 Join」）：
//   - 按行数与估算字节双阈值结束一条 INSERT（默认 ≤100 行或 ≤1MiB）
//   - 元组边转义边写入 bufio，不在内存里保留历史行
//   - []byte 列按字节转义，避免 string([]byte) 再拷一份
const (
	batchInsertMaxRows  = 100
	batchInsertMaxBytes = 1 << 20 // 1 MiB，接近 mysqldump --net-buffer-length 默认量级
)

func writeInsertData(
	ctx context.Context,
	db *sql.DB,
	cw *countingWriter,
	taskID string,
	m *Manager,
	database, table string,
) error {
	src := quoteIdent(database) + "." + quoteIdent(table)
	rows, err := db.QueryContext(ctx, "SELECT * FROM "+src)
	if err != nil {
		return fmt.Errorf("mysql: dump select %s: %w", table, err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return fmt.Errorf("mysql: dump columns %s: %w", table, err)
	}
	if len(cols) == 0 {
		return nil
	}

	quotedCols := make([]string, len(cols))
	for i, c := range cols {
		quotedCols[i] = quoteIdent(c)
	}
	colList := strings.Join(quotedCols, ", ")
	// INSERT 无库名，跟随执行连接的当前库（跨库还原）。
	prefix := fmt.Sprintf("INSERT INTO %s (%s) VALUES\n", quoteIdent(table), colList)

	vals := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}

	var (
		rowCount     int64
		rowsInBatch  int
		bytesInBatch int
		lastProgress time.Time
		rowBuf       strings.Builder
	)
	rowBuf.Grow(4 * 1024)

	endStatement := func() error {
		if rowsInBatch == 0 {
			return nil
		}
		if _, err := io.WriteString(cw, ";\n"); err != nil {
			return err
		}
		rowsInBatch = 0
		bytesInBatch = 0
		return nil
	}

	if _, err := cw.Write([]byte(fmt.Sprintf("-- Data: %s\n", table))); err != nil {
		return err
	}

	for rows.Next() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if err := rows.Scan(ptrs...); err != nil {
			return fmt.Errorf("mysql: dump scan %s: %w", table, err)
		}

		rowBuf.Reset()
		rowBuf.WriteByte('(')
		for i, v := range vals {
			if i > 0 {
				rowBuf.WriteString(", ")
			}
			writeMysqlValueLiteral(&rowBuf, v)
		}
		rowBuf.WriteByte(')')
		tuple := rowBuf.String()

		// 当前语句已达上限则先封口，再开新 INSERT
		if rowsInBatch > 0 && (rowsInBatch >= batchInsertMaxRows || bytesInBatch+len(tuple)+2 >= batchInsertMaxBytes) {
			if err := endStatement(); err != nil {
				return err
			}
			if time.Since(lastProgress) >= 500*time.Millisecond {
				lastProgress = time.Now()
				m.emitProgress(taskID, PhaseRunning, cw.n, rowCount,
					fmt.Sprintf("dumped %d rows from %s", rowCount, table))
			}
		}

		if rowsInBatch == 0 {
			if _, err := io.WriteString(cw, prefix); err != nil {
				return err
			}
			bytesInBatch = len(prefix)
		} else {
			if _, err := io.WriteString(cw, ",\n"); err != nil {
				return err
			}
			bytesInBatch += 2
		}
		if _, err := io.WriteString(cw, tuple); err != nil {
			return err
		}
		bytesInBatch += len(tuple)
		rowsInBatch++
		rowCount++
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("mysql: dump rows %s: %w", table, err)
	}
	if err := endStatement(); err != nil {
		return err
	}
	if rowCount > 0 {
		m.emitProgress(taskID, PhaseRunning, cw.n, rowCount,
			fmt.Sprintf("dumped %d rows from %s", rowCount, table))
	}
	if _, err := cw.Write([]byte("\n")); err != nil {
		return err
	}
	return nil
}

// resolveDumpTargets 根据 DumpParams 解析待转储的表/视图列表。
func resolveDumpTargets(ctx context.Context, db *sql.DB, params DumpParams) ([]dumpTarget, error) {
	var typeFilter []string
	if params.IncludeTables {
		typeFilter = append(typeFilter, "'BASE TABLE'")
	}
	if params.IncludeViews {
		typeFilter = append(typeFilter, "'VIEW'")
	}
	if len(typeFilter) == 0 {
		return nil, nil
	}

	wantNames := make(map[string]bool)
	for _, n := range params.Tables {
		if n = strings.TrimSpace(n); n != "" {
			wantNames[n] = true
		}
	}

	// BASE TABLE 先于 VIEW，避免还原时视图依赖的基表尚未创建。
	query := fmt.Sprintf(
		"SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE IN (%s) ORDER BY CASE TABLE_TYPE WHEN 'BASE TABLE' THEN 0 WHEN 'VIEW' THEN 1 ELSE 2 END, TABLE_NAME",
		strings.Join(typeFilter, ", "),
	)
	rows, err := db.QueryContext(ctx, query, params.Database)
	if err != nil {
		return nil, fmt.Errorf("mysql: list tables: %w", err)
	}
	defer rows.Close()

	var out []dumpTarget
	for rows.Next() {
		var name, tableType string
		if err := rows.Scan(&name, &tableType); err != nil {
			return nil, err
		}
		if len(wantNames) > 0 && !wantNames[name] {
			continue
		}
		out = append(out, dumpTarget{Name: name, Type: tableType})
	}
	return out, rows.Err()
}

// resolveDumpRoutines 解析待转储的过程/函数列表。
// 表/视图对象级转储（Tables 非空且包含表或视图）不导出例程；
// 仅例程转储时 Tables 可作为例程名过滤。
func resolveDumpRoutines(ctx context.Context, db *sql.DB, params DumpParams) ([]dumpRoutine, error) {
	if !params.IncludeProcedures && !params.IncludeFunctions {
		return nil, nil
	}
	if len(params.Tables) > 0 && (params.IncludeTables || params.IncludeViews) {
		return nil, nil
	}

	var typeFilter []string
	if params.IncludeProcedures {
		typeFilter = append(typeFilter, "'PROCEDURE'")
	}
	if params.IncludeFunctions {
		typeFilter = append(typeFilter, "'FUNCTION'")
	}

	wantNames := make(map[string]bool)
	for _, n := range params.Tables {
		if n = strings.TrimSpace(n); n != "" {
			wantNames[n] = true
		}
	}

	query := fmt.Sprintf(
		"SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE IN (%s) ORDER BY ROUTINE_TYPE, ROUTINE_NAME",
		strings.Join(typeFilter, ", "),
	)
	rows, err := db.QueryContext(ctx, query, params.Database)
	if err != nil {
		return nil, fmt.Errorf("mysql: list routines: %w", err)
	}
	defer rows.Close()

	var out []dumpRoutine
	for rows.Next() {
		var name, kind string
		if err := rows.Scan(&name, &kind); err != nil {
			return nil, err
		}
		if len(wantNames) > 0 && !wantNames[name] {
			continue
		}
		out = append(out, dumpRoutine{Name: name, Kind: kind})
	}
	return out, rows.Err()
}

// resolveDumpTriggers 解析触发器；表级转储时仅包含所选表上的触发器。
// 仅例程转储（无表/视图）时跳过触发器过滤语义，直接不导出（由 IncludeTriggers 控制）。
func resolveDumpTriggers(ctx context.Context, db *sql.DB, params DumpParams) ([]string, error) {
	if !params.IncludeTriggers {
		return nil, nil
	}
	// 例程名列表不应当作表名过滤触发器
	if len(params.Tables) > 0 && !params.IncludeTables && !params.IncludeViews {
		return nil, nil
	}
	query := `SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME`
	rows, err := db.QueryContext(ctx, query, params.Database)
	if err != nil {
		return nil, fmt.Errorf("mysql: list triggers: %w", err)
	}
	defer rows.Close()

	wantTables := make(map[string]bool)
	for _, n := range params.Tables {
		if n = strings.TrimSpace(n); n != "" {
			wantTables[n] = true
		}
	}

	var out []string
	for rows.Next() {
		var name, table string
		if err := rows.Scan(&name, &table); err != nil {
			return nil, err
		}
		if len(wantTables) > 0 && !wantTables[table] {
			continue
		}
		out = append(out, name)
	}
	return out, rows.Err()
}

// resolveDumpEvents 解析事件（仅整库转储）。
func resolveDumpEvents(ctx context.Context, db *sql.DB, params DumpParams) ([]string, error) {
	if !params.IncludeEvents || len(params.Tables) > 0 {
		return nil, nil
	}
	rows, err := db.QueryContext(ctx,
		`SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ? ORDER BY EVENT_NAME`,
		params.Database)
	if err != nil {
		return nil, fmt.Errorf("mysql: list events: %w", err)
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	return out, rows.Err()
}

// fetchCreateTriggerSQL 获取触发器 CREATE 语句。
func fetchCreateTriggerSQL(ctx context.Context, db *sql.DB, database, name string) (string, error) {
	qn := quoteIdent(database) + "." + quoteIdent(name)
	row := db.QueryRowContext(ctx, "SHOW CREATE TRIGGER "+qn)
	// Trigger, sql_mode, SQL Original Statement, character_set_client, collation_connection, Database Collation
	var trgName, sqlMode, createSQL, charSet, collation, dbCollation string
	if err := row.Scan(&trgName, &sqlMode, &createSQL, &charSet, &collation, &dbCollation); err != nil {
		return "", fmt.Errorf("mysql: show create trigger %s: %w", name, err)
	}
	return createSQL, nil
}

// fetchCreateEventSQL 获取事件 CREATE 语句。
func fetchCreateEventSQL(ctx context.Context, db *sql.DB, database, name string) (string, error) {
	qn := quoteIdent(database) + "." + quoteIdent(name)
	row := db.QueryRowContext(ctx, "SHOW CREATE EVENT "+qn)
	// Event, sql_mode, time_zone, Create Event, character_set_client, collation_connection, Database Collation
	var evName, sqlMode, timeZone, createSQL, charSet, collation, dbCollation string
	if err := row.Scan(&evName, &sqlMode, &timeZone, &createSQL, &charSet, &collation, &dbCollation); err != nil {
		return "", fmt.Errorf("mysql: show create event %s: %w", name, err)
	}
	return createSQL, nil
}

// mysqlValueLiteral 将 Go 值转换为 MySQL INSERT 值字面量。
func mysqlValueLiteral(v interface{}) string {
	var b strings.Builder
	writeMysqlValueLiteral(&b, v)
	return b.String()
}

// writeMysqlValueLiteral 将值字面量直接写入 Builder，减少大字段临时 string 拷贝。
func writeMysqlValueLiteral(b *strings.Builder, v interface{}) {
	if v == nil {
		b.WriteString("NULL")
		return
	}
	switch val := v.(type) {
	case []byte:
		writeMysqlQuotedBytes(b, val)
	case string:
		writeMysqlQuotedString(b, val)
	case int64:
		fmt.Fprintf(b, "%d", val)
	case uint64:
		fmt.Fprintf(b, "%d", val)
	case float32:
		fmt.Fprintf(b, "%g", val)
	case float64:
		fmt.Fprintf(b, "%g", val)
	case bool:
		if val {
			b.WriteByte('1')
		} else {
			b.WriteByte('0')
		}
	case time.Time:
		b.WriteByte('\'')
		b.WriteString(val.Format("2006-01-02 15:04:05"))
		b.WriteByte('\'')
	default:
		writeMysqlQuotedString(b, fmt.Sprintf("%v", v))
	}
}

// writeMysqlQuotedString 按字节转义字符串（不经 []byte 拷贝）。
func writeMysqlQuotedString(b *strings.Builder, s string) {
	b.WriteByte('\'')
	for i := 0; i < len(s); i++ {
		switch c := s[i]; c {
		case '\'':
			b.WriteString(`\'`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case 0:
			b.WriteString(`\0`)
		case 0x1a:
			b.WriteString(`\Z`)
		default:
			b.WriteByte(c)
		}
	}
	b.WriteByte('\'')
}

// writeMysqlQuotedBytes 按字节转义并包裹单引号（ASCII 特殊字符；UTF-8 多字节原样写入）。
func writeMysqlQuotedBytes(b *strings.Builder, data []byte) {
	b.WriteByte('\'')
	for i := 0; i < len(data); i++ {
		switch c := data[i]; c {
		case '\'':
			b.WriteString(`\'`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case 0:
			b.WriteString(`\0`)
		case 0x1a:
			b.WriteString(`\Z`)
		default:
			b.WriteByte(c)
		}
	}
	b.WriteByte('\'')
}

// mysqlQuoteString 将字符串转义并包裹为 MySQL 单引号字面量。
func mysqlQuoteString(s string) string {
	var b strings.Builder
	writeMysqlQuotedString(&b, s)
	return b.String()
}

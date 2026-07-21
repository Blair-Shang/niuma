package dataio

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"
)

// dumpTarget 描述单个待转储对象。
type dumpTarget struct {
	Name string
	Type string // "BASE TABLE" 或 "VIEW"
}

// dumpSql 生成 MySQL 数据库的结构/数据转储文件（纯 Go 实现，不依赖 mysqldump CLI）。
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
	if len(targets) == 0 {
		return fmt.Errorf("mysql: no objects to dump")
	}

	f, err := os.Create(params.OutputPath)
	if err != nil {
		return fmt.Errorf("mysql: create dump file: %w", err)
	}
	defer f.Close()

	cw := &countingWriter{w: f, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("wrote %d bytes", n))
	}}

	header := fmt.Sprintf(
		"-- NiuMa MySQL dump\n-- format: niuma-mysql-dump/1\n-- database: %s\n-- generated: %s\n-- mode: %s\n-- dropIfExists: %v\n-- truncateBeforeData: %v\n\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n\n",
		params.Database,
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

	for i, t := range targets {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		m.emitProgress(taskID, PhaseRunning, cw.n, int64(i),
			fmt.Sprintf("dumping %s (%d/%d)", t.Name, i+1, len(targets)))

		qn := quoteIdent(params.Database) + "." + quoteIdent(t.Name)
		isTable := t.Type == "BASE TABLE"

		if includeStructure {
			if params.DropIfExists {
				kw := "TABLE"
				if !isTable {
					kw = "VIEW"
				}
				drop := fmt.Sprintf("DROP %s IF EXISTS %s;\n", kw, qn)
				if _, err := cw.Write([]byte(drop)); err != nil {
					return err
				}
			}

			ddlStr, err := fetchCreateSQL(ctx, db, params.Database, t.Name, isTable)
			if err != nil {
				return err
			}
			block := fmt.Sprintf("-- Object: %s\n%s;\n\n", t.Name, strings.TrimRight(ddlStr, "; \n\t"))
			if _, err := cw.Write([]byte(block)); err != nil {
				return err
			}
		}

		if includeData && isTable {
			if params.TruncateBeforeData {
				trunc := fmt.Sprintf("TRUNCATE TABLE %s;\n", qn)
				if _, err := cw.Write([]byte(trunc)); err != nil {
					return err
				}
			}
			if err := writeInsertData(ctx, db, cw, taskID, m, params.Database, t.Name); err != nil {
				return err
			}
		}
	}

	footer := "SET FOREIGN_KEY_CHECKS=1;\n"
	if _, err := cw.Write([]byte(footer)); err != nil {
		return err
	}

	m.emitProgress(taskID, PhaseRunning, cw.n, int64(len(targets)),
		fmt.Sprintf("dumped %d object(s)", len(targets)))
	return nil
}

// fetchCreateSQL 获取表或视图的 CREATE 语句。
func fetchCreateSQL(ctx context.Context, db *sql.DB, database, name string, isTable bool) (string, error) {
	qn := quoteIdent(database) + "." + quoteIdent(name)
	if isTable {
		// SHOW CREATE TABLE 返回两列：Table, Create Table
		row := db.QueryRowContext(ctx, "SHOW CREATE TABLE "+qn)
		var tblName, createSQL string
		if err := row.Scan(&tblName, &createSQL); err != nil {
			return "", fmt.Errorf("mysql: show create table %s: %w", name, err)
		}
		return createSQL, nil
	}
	// SHOW CREATE VIEW 返回四列：View, Create View, character_set_client, collation_connection
	row := db.QueryRowContext(ctx, "SHOW CREATE VIEW "+qn)
	var viewName, createSQL, charSet, collation string
	if err := row.Scan(&viewName, &createSQL, &charSet, &collation); err != nil {
		return "", fmt.Errorf("mysql: show create view %s: %w", name, err)
	}
	return createSQL, nil
}

// writeInsertData 将表数据以 INSERT INTO ... VALUES (...) 形式写入。
// 每批 batchInsertSize 行合并为一条 INSERT。
const batchInsertSize = 100

func writeInsertData(
	ctx context.Context,
	db *sql.DB,
	cw *countingWriter,
	taskID string,
	m *Manager,
	database, table string,
) error {
	qn := quoteIdent(database) + "." + quoteIdent(table)
	rows, err := db.QueryContext(ctx, "SELECT * FROM "+qn)
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
	prefix := fmt.Sprintf("INSERT INTO %s (%s) VALUES\n", qn, colList)

	vals := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}

	var (
		rowCount   int64
		batchLines []string
	)

	flush := func() error {
		if len(batchLines) == 0 {
			return nil
		}
		block := prefix + strings.Join(batchLines, ",\n") + ";\n"
		_, werr := cw.Write([]byte(block))
		batchLines = batchLines[:0]
		return werr
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
		parts := make([]string, len(cols))
		for i, v := range vals {
			parts[i] = mysqlValueLiteral(v)
		}
		batchLines = append(batchLines, "("+strings.Join(parts, ", ")+")")
		rowCount++

		if len(batchLines) >= batchInsertSize {
			if err := flush(); err != nil {
				return err
			}
			m.emitProgress(taskID, PhaseRunning, cw.n, rowCount,
				fmt.Sprintf("dumped %d rows from %s", rowCount, table))
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("mysql: dump rows %s: %w", table, err)
	}
	if err := flush(); err != nil {
		return err
	}
	if _, err := cw.Write([]byte("\n")); err != nil {
		return err
	}
	return nil
}

// resolveDumpTargets 根据 DumpParams 解析待转储的表/视图列表。
func resolveDumpTargets(ctx context.Context, db *sql.DB, params DumpParams) ([]dumpTarget, error) {
	// 构建 TABLE_TYPE 过滤条件
	var typeFilter []string
	if params.IncludeTables {
		typeFilter = append(typeFilter, "'BASE TABLE'")
	}
	if params.IncludeViews {
		typeFilter = append(typeFilter, "'VIEW'")
	}
	if len(typeFilter) == 0 {
		return nil, fmt.Errorf("mysql: no object types selected")
	}

	wantNames := make(map[string]bool)
	for _, n := range params.Tables {
		if n = strings.TrimSpace(n); n != "" {
			wantNames[n] = true
		}
	}

	query := fmt.Sprintf(
		"SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE IN (%s) ORDER BY TABLE_NAME",
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

// mysqlValueLiteral 将 Go 值转换为 MySQL INSERT 值字面量。
func mysqlValueLiteral(v interface{}) string {
	if v == nil {
		return "NULL"
	}
	switch val := v.(type) {
	case []byte:
		return mysqlQuoteString(string(val))
	case string:
		return mysqlQuoteString(val)
	case int64:
		return fmt.Sprintf("%d", val)
	case uint64:
		return fmt.Sprintf("%d", val)
	case float32:
		return fmt.Sprintf("%g", val)
	case float64:
		return fmt.Sprintf("%g", val)
	case bool:
		if val {
			return "1"
		}
		return "0"
	case time.Time:
		return "'" + val.Format("2006-01-02 15:04:05") + "'"
	default:
		return mysqlQuoteString(fmt.Sprintf("%v", v))
	}
}

// mysqlQuoteString 将字符串转义并包裹为 MySQL 单引号字面量。
func mysqlQuoteString(s string) string {
	var b strings.Builder
	b.WriteByte('\'')
	for _, r := range s {
		switch r {
		case '\'':
			b.WriteString("\\'")
		case '\\':
			b.WriteString("\\\\")
		case '\n':
			b.WriteString("\\n")
		case '\r':
			b.WriteString("\\r")
		case 0:
			b.WriteString("\\0")
		case '\x1a':
			b.WriteString("\\Z")
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('\'')
	return b.String()
}

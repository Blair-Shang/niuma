package dataio

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"niuma/services/postgres-service/internal/meta"
	"niuma/services/postgres-service/internal/tree"
)

type dumpTarget struct {
	Schema string
	Name   string
	Type   string // table | view | materialized_view | sequence | function | procedure | trigger
	Args   string
	OID    uint32
	Table  string // trigger：所属表名
}

func dumpSql(ctx context.Context, pool *pgxpool.Pool, taskID string, m *Manager, params DumpParams) error {
	normalizeDumpParams(&params)

	targets, err := resolveDumpTargets(ctx, pool, params)
	if err != nil {
		return err
	}
	if len(targets) == 0 {
		return fmt.Errorf("postgres: no objects to dump")
	}

	ordered, err := orderDumpTargets(ctx, pool, targets)
	if err != nil {
		return err
	}
	targets = ordered

	f, err := os.Create(params.OutputPath)
	if err != nil {
		return fmt.Errorf("postgres: create dump file: %w", err)
	}
	defer f.Close()

	w := &countingWriter{w: f, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("wrote %d bytes", n))
	}}

	header := fmt.Sprintf(
		"-- NiuMa PostgreSQL dump\n-- format: niuma-postgres-dump/1\n-- database: %s\n-- generated: %s\n-- mode: %s\n-- dropIfExists: %v\n-- createSchema: %v\n-- truncateBeforeData: %v\n-- note: no CREATE DATABASE; restore into a prepared target DB\n-- note: includes sequences / functions / procedures / triggers when selected\n\nSET client_encoding = 'UTF8';\n\n",
		params.Database,
		time.Now().UTC().Format(time.RFC3339),
		params.Mode,
		params.DropIfExists,
		dumpWantCreateSchema(params),
		params.TruncateBeforeData,
	)
	if _, err := w.Write([]byte(header)); err != nil {
		return err
	}

	includeStructure := params.Mode == DumpStructureAndData || params.Mode == DumpStructureOnly
	includeData := params.Mode == DumpStructureAndData || params.Mode == DumpDataOnly

	if includeStructure && params.DropIfExists {
		if err := writeDropStatements(w, targets); err != nil {
			return err
		}
	}

	if includeStructure && dumpWantCreateSchema(params) {
		if err := writeSchemaDDL(w, targets); err != nil {
			return err
		}
	}

	var sequenceTargets []dumpTarget

	for i, t := range targets {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		m.emitProgress(taskID, PhaseRunning, w.n, int64(i), fmt.Sprintf("dumping %s.%s (%d/%d)", t.Schema, t.Name, i+1, len(targets)))

		if t.Type == "sequence" {
			sequenceTargets = append(sequenceTargets, t)
		}

		if includeStructure {
			if isRecycleBinName(t.Name) {
				m.emitProgress(taskID, PhaseRunning, w.n, int64(i),
					fmt.Sprintf("skip %s.%s: recycle bin object", t.Schema, t.Name))
				continue
			}
			if err := writeStructureBlock(ctx, pool, w, t); err != nil {
				if isPermissionDenied(err) || isUndefinedTable(err) {
					m.emitProgress(taskID, PhaseRunning, w.n, int64(i),
						fmt.Sprintf("skip structure %s.%s: %s", t.Schema, t.Name, shortDumpErr(err)))
				} else {
					return err
				}
			}
		}

		if includeData && t.Type == "table" {
			if isRecycleBinName(t.Name) {
				continue
			}
			canUse, err := schemaHasUsage(ctx, pool, t.Schema)
			if err != nil {
				return err
			}
			canSelect, err := relationHasSelect(ctx, pool, t.Schema, t.Name)
			if err != nil {
				return err
			}
			if !canUse || !canSelect {
				m.emitProgress(taskID, PhaseRunning, w.n, int64(i),
					fmt.Sprintf("skip data %s.%s: permission denied", t.Schema, t.Name))
				continue
			}
			if params.TruncateBeforeData {
				if _, err := w.Write([]byte(fmt.Sprintf("TRUNCATE TABLE %s;\n", qualified(t.Schema, t.Name)))); err != nil {
					return err
				}
			}
			if err := writeCopyDataBlock(ctx, pool, w, t.Schema, t.Name); err != nil {
				if isPermissionDenied(err) || isUndefinedTable(err) {
					m.emitProgress(taskID, PhaseRunning, w.n, int64(i),
						fmt.Sprintf("skip data %s.%s: %s", t.Schema, t.Name, shortDumpErr(err)))
					continue
				}
				return err
			}
		}
	}

	if includeData && len(sequenceTargets) > 0 {
		if err := writeSequenceSetvals(ctx, pool, w, m, taskID, sequenceTargets); err != nil {
			return err
		}
	}

	m.emitProgress(taskID, PhaseRunning, w.n, int64(len(targets)), fmt.Sprintf("dumped %d object(s)", len(targets)))
	return nil
}

func writeStructureBlock(ctx context.Context, pool *pgxpool.Pool, w *countingWriter, t dumpTarget) error {
	switch t.Type {
	case "function", "procedure":
		src, err := meta.GetRoutineSource(ctx, pool, meta.RoutineRef{
			Schema: t.Schema,
			Name:   t.Name,
			Args:   t.Args,
			OID:    t.OID,
		})
		if err != nil {
			return fmt.Errorf("postgres: routine ddl %s.%s: %w", t.Schema, t.Name, err)
		}
		body := strings.TrimRight(src.Definition, "; \n\t")
		block := fmt.Sprintf("-- Structure: %s.%s (%s)\n%s;\n\n", t.Schema, t.Name, t.Type, body)
		_, err = w.Write([]byte(block))
		return err
	case "trigger":
		src, err := meta.GetTriggerDDL(ctx, pool, meta.TriggerRef{
			Schema:    t.Schema,
			Name:      t.Name,
			TableName: t.Table,
			OID:       t.OID,
		})
		if err != nil {
			return fmt.Errorf("postgres: trigger ddl %s.%s: %w", t.Schema, t.Name, err)
		}
		block := fmt.Sprintf(
			"-- Structure: %s.%s ON %s.%s (trigger)\n%s;\n\n",
			t.Schema, t.Name, t.Schema, t.Table, src.Definition,
		)
		_, err = w.Write([]byte(block))
		return err
	default:
		ref := meta.RelationRef{Schema: t.Schema, Name: t.Name}
		ddl, err := meta.GetDDL(ctx, pool, ref)
		if err != nil {
			return fmt.Errorf("postgres: ddl %s.%s: %w", t.Schema, t.Name, err)
		}
		block := fmt.Sprintf("-- Structure: %s.%s\n%s;\n\n", t.Schema, t.Name, strings.TrimRight(ddl.DDL, "; \n\t"))
		_, err = w.Write([]byte(block))
		return err
	}
}

func writeSequenceSetvals(
	ctx context.Context,
	pool *pgxpool.Pool,
	w *countingWriter,
	m *Manager,
	taskID string,
	sequences []dumpTarget,
) error {
	if _, err := w.Write([]byte("-- Sequence values\n")); err != nil {
		return err
	}
	for _, t := range sequences {
		ref := meta.RelationRef{Schema: t.Schema, Name: t.Name}
		state, err := meta.GetSequenceState(ctx, pool, ref)
		if err != nil {
			if isPermissionDenied(err) {
				m.emitProgress(taskID, PhaseRunning, w.n, 0,
					fmt.Sprintf("skip setval %s.%s: permission denied", t.Schema, t.Name))
				continue
			}
			return err
		}
		line := meta.FormatSetval(ref, *state) + ";\n"
		if _, err := w.Write([]byte(line)); err != nil {
			return err
		}
	}
	if _, err := w.Write([]byte("\n")); err != nil {
		return err
	}
	return nil
}

func writeDropStatements(w *countingWriter, targets []dumpTarget) error {
	// DROP 与创建相反：触发器 → 过程/函数 → 视图 → 表（逆 FK 序）→ 序列
	var triggers, routines, views, tables, sequences []dumpTarget
	for _, t := range targets {
		switch t.Type {
		case "trigger":
			triggers = append(triggers, t)
		case "function", "procedure":
			routines = append(routines, t)
		case "view", "materialized_view":
			views = append(views, t)
		case "table":
			tables = append(tables, t)
		case "sequence":
			sequences = append(sequences, t)
		}
	}

	for _, t := range triggers {
		line := meta.FormatDropTrigger(t.Schema, t.Table, t.Name) + ";\n"
		if _, err := w.Write([]byte(line)); err != nil {
			return err
		}
	}
	for _, t := range routines {
		kw := "FUNCTION"
		if t.Type == "procedure" {
			kw = "PROCEDURE"
		}
		sig := qualified(t.Schema, t.Name)
		if strings.TrimSpace(t.Args) != "" {
			sig = fmt.Sprintf("%s(%s)", sig, t.Args)
		} else {
			sig = fmt.Sprintf("%s()", sig)
		}
		line := fmt.Sprintf("DROP %s IF EXISTS %s CASCADE;\n", kw, sig)
		if _, err := w.Write([]byte(line)); err != nil {
			return err
		}
	}
	for _, t := range views {
		kw := "VIEW"
		if t.Type == "materialized_view" {
			kw = "MATERIALIZED VIEW"
		}
		line := fmt.Sprintf("DROP %s IF EXISTS %s CASCADE;\n", kw, qualified(t.Schema, t.Name))
		if _, err := w.Write([]byte(line)); err != nil {
			return err
		}
	}
	for i := len(tables) - 1; i >= 0; i-- {
		t := tables[i]
		line := fmt.Sprintf("DROP TABLE IF EXISTS %s CASCADE;\n", qualified(t.Schema, t.Name))
		if _, err := w.Write([]byte(line)); err != nil {
			return err
		}
	}
	for _, t := range sequences {
		line := fmt.Sprintf("DROP SEQUENCE IF EXISTS %s CASCADE;\n", qualified(t.Schema, t.Name))
		if _, err := w.Write([]byte(line)); err != nil {
			return err
		}
	}
	if len(triggers)+len(routines)+len(views)+len(tables)+len(sequences) > 0 {
		if _, err := w.Write([]byte("\n")); err != nil {
			return err
		}
	}
	return nil
}

func writeSchemaDDL(w *countingWriter, targets []dumpTarget) error {
	seen := make(map[string]bool)
	schemas := make([]string, 0)
	for _, t := range targets {
		s := strings.TrimSpace(t.Schema)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		schemas = append(schemas, s)
	}
	sort.Strings(schemas)
	for _, s := range schemas {
		line := fmt.Sprintf("CREATE SCHEMA IF NOT EXISTS %s;\n", quoteIdent(s))
		if _, err := w.Write([]byte(line)); err != nil {
			return err
		}
	}
	if len(schemas) > 0 {
		if _, err := w.Write([]byte("\n")); err != nil {
			return err
		}
	}
	return nil
}

func resolveDumpTargets(ctx context.Context, pool *pgxpool.Pool, params DumpParams) ([]dumpTarget, error) {
	wantNames := make(map[string]bool)
	for _, name := range params.Tables {
		name = strings.TrimSpace(name)
		if name != "" {
			wantNames[name] = true
		}
	}
	// Tables 来自 UI 表/视图勾选或单对象转储；序列与例程不受该名称列表过滤
	//（单对象场景由前端关闭 IncludeSequences/Functions/Procedures）。
	// 触发器：若勾选了表名列表，则只导出落在这些表上的触发器。
	nameFilterRelationsOnly := len(wantNames) > 0 &&
		(params.IncludeTables || params.IncludeViews || params.IncludeMatViews)

	relTypes := dumpRelationTypes(params)
	if len(relTypes) == 0 &&
		!params.IncludeSequences &&
		!params.IncludeFunctions &&
		!params.IncludeProcedures &&
		!params.IncludeTriggers {
		return nil, fmt.Errorf("postgres: no object types selected")
	}

	schemas, err := resolveDumpSchemas(ctx, pool, params)
	if err != nil {
		return nil, err
	}

	var out []dumpTarget
	for _, sch := range schemas {
		if len(relTypes) > 0 {
			res, err := tree.ListTables(ctx, pool, tree.ListParams{
				Schema: sch,
				Types:  relTypes,
				Limit:  tree.MaxLimit,
			})
			if err != nil {
				return nil, err
			}
			for _, t := range res.Tables {
				if nameFilterRelationsOnly && !wantNames[t.Name] {
					continue
				}
				out = append(out, dumpTarget{Schema: sch, Name: t.Name, Type: t.Type})
			}
		}

		if params.IncludeSequences {
			res, err := tree.ListSequences(ctx, pool, tree.ListParams{
				Schema: sch,
				Limit:  tree.MaxLimit,
			})
			if err != nil {
				return nil, err
			}
			for _, s := range res.Sequences {
				out = append(out, dumpTarget{Schema: sch, Name: s.Name, Type: "sequence"})
			}
		}

		kinds := make([]string, 0, 2)
		if params.IncludeFunctions {
			kinds = append(kinds, "function")
		}
		if params.IncludeProcedures {
			kinds = append(kinds, "procedure")
		}
		if len(kinds) > 0 {
			res, err := tree.ListRoutines(ctx, pool, tree.ListParams{
				Schema:       sch,
				RoutineKinds: kinds,
				Limit:        tree.MaxLimit,
			})
			if err != nil {
				return nil, err
			}
			for _, r := range res.Routines {
				if r.Kind != "function" && r.Kind != "procedure" {
					continue
				}
				extOwned, err := routineIsExtensionOwned(ctx, pool, r.OID)
				if err != nil {
					return nil, err
				}
				if extOwned {
					continue
				}
				out = append(out, dumpTarget{
					Schema: sch,
					Name:   r.Name,
					Type:   r.Kind,
					Args:   r.Args,
					OID:    r.OID,
				})
			}
		}

		if params.IncludeTriggers {
			res, err := tree.ListTriggers(ctx, pool, tree.ListParams{
				Schema: sch,
				Limit:  tree.MaxLimit,
			})
			if err != nil {
				return nil, err
			}
			for _, tr := range res.Triggers {
				if nameFilterRelationsOnly && !wantNames[tr.TableName] {
					continue
				}
				out = append(out, dumpTarget{
					Schema: sch,
					Name:   tr.Name,
					Type:   "trigger",
					OID:    tr.OID,
					Table:  tr.TableName,
				})
			}
		}
	}
	return out, nil
}

func resolveDumpSchemas(ctx context.Context, pool *pgxpool.Pool, params DumpParams) ([]string, error) {
	schema := strings.TrimSpace(params.Schema)
	if schema != "" {
		return []string{schema}, nil
	}
	res, err := tree.ListSchemas(ctx, pool, tree.ListParams{
		ExcludeSystem: dumpWantExcludeSystem(params),
		Limit:         tree.MaxLimit,
	})
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(res.Schemas))
	for _, s := range res.Schemas {
		ok, err := schemaHasUsage(ctx, pool, s.Name)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		out = append(out, s.Name)
	}
	return out, nil
}

func routineIsExtensionOwned(ctx context.Context, pool *pgxpool.Pool, oid uint32) (bool, error) {
	if oid == 0 {
		return false, nil
	}
	var owned bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS (
  SELECT 1 FROM pg_catalog.pg_depend d
  WHERE d.objid = $1 AND d.deptype = 'e'
)`, oid).Scan(&owned)
	if err != nil {
		return false, fmt.Errorf("postgres: check extension-owned routine: %w", err)
	}
	return owned, nil
}

func writeCopyDataBlock(ctx context.Context, pool *pgxpool.Pool, w *countingWriter, schema, table string) error {
	qn := qualified(schema, table)
	if _, err := w.Write([]byte(fmt.Sprintf("-- Data: %s.%s\nCOPY %s FROM STDIN WITH (FORMAT csv, HEADER true);\n", schema, table, qn))); err != nil {
		return err
	}

	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	sql := fmt.Sprintf("COPY %s TO STDOUT WITH (FORMAT csv, HEADER true)", qn)
	_, err = conn.Conn().PgConn().CopyTo(ctx, w, sql)
	if err != nil {
		return fmt.Errorf("postgres: dump data %s: %w", qn, err)
	}
	if _, err := w.Write([]byte("\\.\n\n")); err != nil {
		return err
	}
	return nil
}

func schemaHasUsage(ctx context.Context, pool *pgxpool.Pool, schema string) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `SELECT has_schema_privilege($1::text, 'USAGE')`, schema).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("postgres: check schema usage %s: %w", schema, err)
	}
	return ok, nil
}

func relationHasSelect(ctx context.Context, pool *pgxpool.Pool, schema, name string) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT COALESCE(has_table_privilege(c.oid, 'SELECT'), false)
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1
  AND c.relname = $2
  AND c.relkind IN ('r', 'p', 'f')
LIMIT 1`, schema, name).Scan(&ok)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("postgres: check select %s.%s: %w", schema, name, err)
	}
	return ok, nil
}

func isPermissionDenied(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "permission denied") || strings.Contains(msg, "sqlstate 42501")
}

// isUndefinedTable 覆盖回收站 BIN$$ 对象等：仍在 pg_class，但 COPY/SELECT 报不存在。
func isUndefinedTable(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "does not exist") ||
		strings.Contains(msg, "sqlstate 42p01") ||
		strings.Contains(msg, "undefined_table")
}

func isRecycleBinName(name string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(name)), "bin$$")
}

func shortDumpErr(err error) string {
	msg := err.Error()
	lower := strings.ToLower(msg)
	switch {
	case strings.Contains(lower, "permission denied"):
		return "permission denied"
	case strings.Contains(lower, "does not exist"):
		return "relation missing (recycle bin or dropped)"
	default:
		if len(msg) > 120 {
			return msg[:120] + "…"
		}
		return msg
	}
}

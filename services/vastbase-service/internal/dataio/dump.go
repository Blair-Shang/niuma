package dataio

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"niuma/services/vastbase-service/internal/meta"
	"niuma/services/vastbase-service/internal/tree"
)

type dumpTarget struct {
	Schema string
	Name   string
	Type   string
}

func dumpSql(ctx context.Context, pool *pgxpool.Pool, taskID string, m *Manager, params DumpParams) error {
	normalizeDumpParams(&params)

	targets, err := resolveDumpTargets(ctx, pool, params)
	if err != nil {
		return err
	}
	if len(targets) == 0 {
		return fmt.Errorf("vastbase: no objects to dump")
	}

	ordered, err := orderDumpTargets(ctx, pool, targets)
	if err != nil {
		return err
	}
	targets = ordered

	f, err := os.Create(params.OutputPath)
	if err != nil {
		return fmt.Errorf("vastbase: create dump file: %w", err)
	}
	defer f.Close()

	w := &countingWriter{w: f, onProgress: func(n int64) {
		m.emitProgress(taskID, PhaseRunning, n, 0, fmt.Sprintf("wrote %d bytes", n))
	}}

	header := fmt.Sprintf(
		"-- NiuMa Vastbase dump\n-- format: niuma-vastbase-dump/1\n-- database: %s\n-- generated: %s\n-- mode: %s\n-- dropIfExists: %v\n-- createSchema: %v\n-- truncateBeforeData: %v\n\nSET client_encoding = 'UTF8';\n\n",
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

	for i, t := range targets {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		m.emitProgress(taskID, PhaseRunning, w.n, int64(i), fmt.Sprintf("dumping %s.%s (%d/%d)", t.Schema, t.Name, i+1, len(targets)))

		ref := meta.RelationRef{Schema: t.Schema, Name: t.Name}
		if includeStructure {
			ddl, err := meta.GetDDL(ctx, pool, ref)
			if err != nil {
				return fmt.Errorf("vastbase: ddl %s.%s: %w", t.Schema, t.Name, err)
			}
			block := fmt.Sprintf("-- Structure: %s.%s\n%s;\n\n", t.Schema, t.Name, strings.TrimRight(ddl.DDL, "; \n\t"))
			if _, err := w.Write([]byte(block)); err != nil {
				return err
			}
		}

		if includeData && t.Type == "table" {
			if params.TruncateBeforeData {
				if _, err := w.Write([]byte(fmt.Sprintf("TRUNCATE TABLE %s;\n", qualified(t.Schema, t.Name)))); err != nil {
					return err
				}
			}
			if err := writeCopyDataBlock(ctx, pool, w, t.Schema, t.Name); err != nil {
				return err
			}
		}
	}

	m.emitProgress(taskID, PhaseRunning, w.n, int64(len(targets)), fmt.Sprintf("dumped %d object(s)", len(targets)))
	return nil
}

func writeDropStatements(w *countingWriter, targets []dumpTarget) error {
	var views, tables []dumpTarget
	for _, t := range targets {
		if t.Type == "table" {
			tables = append(tables, t)
		} else {
			views = append(views, t)
		}
	}
	// 先丢依赖方（视图），再按创建序逆序丢表，降低外键阻挡概率
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
	if len(views)+len(tables) > 0 {
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
	types := dumpRelationTypes(params)
	if len(types) == 0 {
		return nil, fmt.Errorf("vastbase: no object types selected")
	}

	schema := strings.TrimSpace(params.Schema)
	wantNames := make(map[string]bool)
	for _, name := range params.Tables {
		name = strings.TrimSpace(name)
		if name != "" {
			wantNames[name] = true
		}
	}

	schemas := []string{}
	if schema != "" {
		schemas = []string{schema}
	} else {
		res, err := tree.ListSchemas(ctx, pool, tree.ListParams{
			ExcludeSystem: dumpWantExcludeSystem(params),
			Limit:         tree.MaxLimit,
		})
		if err != nil {
			return nil, err
		}
		for _, s := range res.Schemas {
			schemas = append(schemas, s.Name)
		}
	}

	var out []dumpTarget
	for _, sch := range schemas {
		res, err := tree.ListTables(ctx, pool, tree.ListParams{
			Schema: sch,
			Types:  types,
			Limit:  tree.MaxLimit,
		})
		if err != nil {
			return nil, err
		}
		for _, t := range res.Tables {
			if len(wantNames) > 0 && !wantNames[t.Name] {
				continue
			}
			out = append(out, dumpTarget{Schema: sch, Name: t.Name, Type: t.Type})
		}
	}
	return out, nil
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
		return fmt.Errorf("vastbase: dump data %s: %w", qn, err)
	}
	if _, err := w.Write([]byte("\\.\n\n")); err != nil {
		return err
	}
	return nil
}

package dataio

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

func relationKey(schema, name string) string {
	return schema + "." + name
}

// orderDumpTargets 表按外键依赖拓扑排序（父表在前），视图/物化视图置于表之后。
func orderDumpTargets(ctx context.Context, pool *pgxpool.Pool, targets []dumpTarget) ([]dumpTarget, error) {
	tables := make([]dumpTarget, 0, len(targets))
	rest := make([]dumpTarget, 0)
	for _, t := range targets {
		if t.Type == "table" {
			tables = append(tables, t)
		} else {
			rest = append(rest, t)
		}
	}
	if len(tables) <= 1 {
		return append(tables, rest...), nil
	}

	edges, err := loadTableFKEdges(ctx, pool, tables)
	if err != nil {
		return nil, err
	}
	ordered := topoSortTables(tables, edges)
	return append(ordered, rest...), nil
}

// loadTableFKEdges 返回 [parent, child]：child 的外键引用 parent，故 parent 须先于 child。
func loadTableFKEdges(ctx context.Context, pool *pgxpool.Pool, tables []dumpTarget) ([][2]string, error) {
	inSet := make(map[string]bool, len(tables))
	for _, t := range tables {
		inSet[relationKey(t.Schema, t.Name)] = true
	}

	const q = `
SELECT n.nspname, c.relname, n2.nspname, c2.relname
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_class c2 ON c2.oid = con.confrelid
JOIN pg_catalog.pg_namespace n2 ON n2.oid = c2.relnamespace
WHERE con.contype = 'f'`

	rows, err := pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("vastbase: list fk edges for dump order: %w", err)
	}
	defer rows.Close()

	var edges [][2]string
	for rows.Next() {
		var childSchema, childName, parentSchema, parentName string
		if err := rows.Scan(&childSchema, &childName, &parentSchema, &parentName); err != nil {
			return nil, fmt.Errorf("vastbase: fk edge scan: %w", err)
		}
		child := relationKey(childSchema, childName)
		parent := relationKey(parentSchema, parentName)
		if !inSet[child] || !inSet[parent] || child == parent {
			continue
		}
		edges = append(edges, [2]string{parent, child})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return edges, nil
}

func topoSortTables(tables []dumpTarget, edges [][2]string) []dumpTarget {
	index := make(map[string]dumpTarget, len(tables))
	order0 := make([]string, 0, len(tables))
	indeg := make(map[string]int, len(tables))
	succ := make(map[string][]string, len(tables))

	for _, t := range tables {
		k := relationKey(t.Schema, t.Name)
		if _, ok := index[k]; ok {
			continue
		}
		index[k] = t
		order0 = append(order0, k)
		indeg[k] = 0
	}

	seenEdge := make(map[string]bool)
	for _, e := range edges {
		parent, child := e[0], e[1]
		if _, ok := index[parent]; !ok {
			continue
		}
		if _, ok := index[child]; !ok {
			continue
		}
		ek := parent + "->" + child
		if seenEdge[ek] {
			continue
		}
		seenEdge[ek] = true
		succ[parent] = append(succ[parent], child)
		indeg[child]++
	}

	queue := make([]string, 0, len(order0))
	for _, k := range order0 {
		if indeg[k] == 0 {
			queue = append(queue, k)
		}
	}

	out := make([]dumpTarget, 0, len(tables))
	placed := make(map[string]bool, len(tables))
	for len(queue) > 0 {
		k := queue[0]
		queue = queue[1:]
		if placed[k] {
			continue
		}
		placed[k] = true
		out = append(out, index[k])
		for _, child := range succ[k] {
			indeg[child]--
			if indeg[child] == 0 {
				queue = append(queue, child)
			}
		}
	}

	for _, k := range order0 {
		if !placed[k] {
			out = append(out, index[k])
		}
	}
	return out
}

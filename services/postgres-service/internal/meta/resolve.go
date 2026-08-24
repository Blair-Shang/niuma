package meta

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// defaultRelkinds 是表 / 视图类对象（不含索引、序列、复合类型）。
var defaultRelkinds = []string{"r", "p", "v", "m", "f"}

// ResolveRelationOID 按 schema+name 解析 pg_class.oid。
//
// Kingbase 在部分兼容模式下会对标识符做大小写折叠；DDL 侧又常双引号保案。
// 因此查找时优先精确匹配，再尝试 lower / upper，避免创建后立刻读元数据失败。
func ResolveRelationOID(ctx context.Context, pool *pgxpool.Pool, ref RelationRef, relkinds ...string) (uint32, error) {
	if err := requireRelation(ref); err != nil {
		return 0, err
	}
	kinds := relkinds
	if len(kinds) == 0 {
		kinds = defaultRelkinds
	}
	const q = `
SELECT c.oid
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1
  AND c.relkind::text = ANY($3::text[])
  AND (c.relname = $2 OR c.relname = lower($2) OR c.relname = upper($2))
ORDER BY
  CASE
    WHEN c.relname = $2 THEN 0
    WHEN c.relname = lower($2) THEN 1
    ELSE 2
  END,
  c.oid
LIMIT 1`
	var oid uint32
	if err := pool.QueryRow(ctx, q, ref.Schema, ref.Name, kinds).Scan(&oid); err != nil {
		return 0, err
	}
	return oid, nil
}

// tryResolveRelationOID 在关系不存在时返回 ok=false（不报错）。
func tryResolveRelationOID(ctx context.Context, pool *pgxpool.Pool, ref RelationRef) (uint32, bool, error) {
	oid, err := ResolveRelationOID(ctx, pool, ref)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, false, nil
		}
		return 0, false, fmt.Errorf("postgres: resolve relation: %w", err)
	}
	return oid, true, nil
}

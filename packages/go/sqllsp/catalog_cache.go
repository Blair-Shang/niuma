package sqllsp

import (
	"context"
	"strings"
	"sync"
	"time"
)

// CatalogCacheTTL 进程内 catalog 短缓存默认 TTL（对齐前端遗留 catalog cache）。
const CatalogCacheTTL = 45 * time.Second

type catalogCacheEntry[T any] struct {
	value     T
	truncated  bool
	expiresAt time.Time
}

// CachingCatalog 对 Catalog 做会话级短缓存 + 同 key 飞行去重。
// 列/表/库按「无前缀全量（上限 MaxCatalogLimit）」缓存，请求侧再按 Prefix/Limit 过滤，
// 避免敲字时每次打字典、也避免诊断与补全重复查同一张表。
//
// 缓存键含 SessionID + Database + Schema/Table，避免同 session 多库互相覆盖。
// 有前缀时：若已有未截断暖缓存则本地过滤；截断或未命中仍直查（与旧行为兼容，不漏名）。
type CachingCatalog struct {
	inner Catalog
	ttl   time.Duration

	mu       sync.Mutex
	schemas  map[string]catalogCacheEntry[[]SchemaHit]
	tables   map[string]catalogCacheEntry[[]TableHit]
	columns  map[string]catalogCacheEntry[[]ColumnHit]
	inflight map[string]*sync.WaitGroup
}

// NewCachingCatalog 包装 inner；ttl<=0 时用 CatalogCacheTTL。
func NewCachingCatalog(inner Catalog, ttl time.Duration) *CachingCatalog {
	if ttl <= 0 {
		ttl = CatalogCacheTTL
	}
	return &CachingCatalog{
		inner:    inner,
		ttl:      ttl,
		schemas:  make(map[string]catalogCacheEntry[[]SchemaHit]),
		tables:   make(map[string]catalogCacheEntry[[]TableHit]),
		columns:  make(map[string]catalogCacheEntry[[]ColumnHit]),
		inflight: make(map[string]*sync.WaitGroup),
	}
}

// Invalidate 清空全部缓存（手动刷新元数据时可调）。
func (c *CachingCatalog) Invalidate() {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	clear(c.schemas)
	clear(c.tables)
	clear(c.columns)
}

func (c *CachingCatalog) ListSchemas(ctx context.Context, p CatalogParams) ([]SchemaHit, bool, error) {
	if c == nil || c.inner == nil {
		return nil, false, nil
	}
	limit := normalizeCacheLimit(p.Limit)
	prefix := strings.TrimSpace(p.Prefix)
	database := strings.TrimSpace(p.Database)
	key := "s|" + strings.TrimSpace(p.SessionID) + "|" + strings.ToLower(database) + "|" + boolKey(p.ExcludeSystem)

	if prefix != "" {
		if hits, trunc, ok := peekCached(c, key, c.schemas); ok && !trunc {
			out, outTrunc := filterSchemas(hits, prefix, limit)
			return out, outTrunc, nil
		}
		// 未命中或截断：直查前缀，避免 MaxCatalogLimit 截断后漏名（兼容旧路径）。
		return c.inner.ListSchemas(ctx, CatalogParams{
			SessionID:     p.SessionID,
			Database:      database,
			ExcludeSystem: p.ExcludeSystem,
			Prefix:        prefix,
			Limit:         limit,
		})
	}

	hits, trunc, err := loadCached(c, key, &c.schemas, func() ([]SchemaHit, bool, error) {
		return c.inner.ListSchemas(ctx, CatalogParams{
			SessionID:     p.SessionID,
			Database:      database,
			ExcludeSystem: p.ExcludeSystem,
			Limit:         MaxCatalogLimit,
		})
	})
	if err != nil {
		return nil, false, err
	}
	out, outTrunc := filterSchemas(hits, "", limit)
	if trunc {
		outTrunc = true
	}
	return out, outTrunc, nil
}

func (c *CachingCatalog) ListTables(ctx context.Context, p CatalogParams) ([]TableHit, bool, error) {
	if c == nil || c.inner == nil {
		return nil, false, nil
	}
	schema := coalesceSchema(p.Schema, p.Database)
	database := resolveCatalogDatabase(p.Database, schema)
	limit := normalizeCacheLimit(p.Limit)
	prefix := strings.TrimSpace(p.Prefix)
	key := "t|" + strings.TrimSpace(p.SessionID) + "|" + strings.ToLower(database) + "|" + strings.ToLower(schema)

	if prefix != "" {
		if hits, trunc, ok := peekCached(c, key, c.tables); ok && !trunc {
			out, outTrunc := filterTables(hits, prefix, limit)
			return out, outTrunc, nil
		}
		// 未命中或截断：直查前缀，避免大库截断后漏表（兼容旧路径）。
		return c.inner.ListTables(ctx, CatalogParams{
			SessionID: p.SessionID,
			Database:  database,
			Schema:    schema,
			Prefix:    prefix,
			Limit:     limit,
		})
	}

	hits, trunc, err := loadCached(c, key, &c.tables, func() ([]TableHit, bool, error) {
		return c.inner.ListTables(ctx, CatalogParams{
			SessionID: p.SessionID,
			Database:  database,
			Schema:    schema,
			Limit:     MaxCatalogLimit,
		})
	})
	if err != nil {
		return nil, false, err
	}
	out, outTrunc := filterTables(hits, "", limit)
	if trunc {
		outTrunc = true
	}
	return out, outTrunc, nil
}

func (c *CachingCatalog) ListColumns(ctx context.Context, p CatalogParams) ([]ColumnHit, bool, error) {
	if c == nil || c.inner == nil {
		return nil, false, nil
	}
	schema := coalesceSchema(p.Schema, p.Database)
	database := resolveCatalogDatabase(p.Database, schema)
	table := strings.TrimSpace(p.Table)
	key := "c|" + strings.TrimSpace(p.SessionID) + "|" + strings.ToLower(database) + "|" + strings.ToLower(schema) + "|" + strings.ToLower(table)
	hits, trunc, err := loadCached(c, key, &c.columns, func() ([]ColumnHit, bool, error) {
		return c.inner.ListColumns(ctx, CatalogParams{
			SessionID: p.SessionID,
			Database:  database,
			Schema:    schema,
			Table:     table,
			Limit:     MaxCatalogLimit,
		})
	})
	if err != nil {
		return nil, false, err
	}
	out, outTrunc := filterColumns(hits, p.Prefix, normalizeCacheLimit(p.Limit))
	if trunc {
		outTrunc = true
	}
	return out, outTrunc, nil
}

// resolveCatalogDatabase 保留调用方传入的 Database；空时回退 schema（MySQL 库=schema 兼容）。
func resolveCatalogDatabase(database, schema string) string {
	if db := strings.TrimSpace(database); db != "" {
		return db
	}
	return strings.TrimSpace(schema)
}

func peekCached[T any](c *CachingCatalog, key string, store map[string]catalogCacheEntry[T]) (T, bool, bool) {
	var zero T
	if c == nil {
		return zero, false, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	ent, ok := store[key]
	if !ok || !time.Now().Before(ent.expiresAt) {
		return zero, false, false
	}
	return ent.value, ent.truncated, true
}

func loadCached[T any](
	c *CachingCatalog,
	key string,
	store *map[string]catalogCacheEntry[T],
	fetch func() (T, bool, error),
) (T, bool, error) {
	for {
		c.mu.Lock()
		if ent, ok := (*store)[key]; ok && time.Now().Before(ent.expiresAt) {
			val, trunc := ent.value, ent.truncated
			c.mu.Unlock()
			return val, trunc, nil
		}
		if wg, busy := c.inflight[key]; busy {
			c.mu.Unlock()
			wg.Wait()
			continue
		}
		wg := &sync.WaitGroup{}
		wg.Add(1)
		c.inflight[key] = wg
		c.mu.Unlock()

		val, trunc, err := fetch()

		c.mu.Lock()
		delete(c.inflight, key)
		if err == nil {
			(*store)[key] = catalogCacheEntry[T]{
				value:     val,
				truncated:  trunc,
				expiresAt: time.Now().Add(c.ttl),
			}
		}
		c.mu.Unlock()
		wg.Done()
		return val, trunc, err
	}
}

func normalizeCacheLimit(limit int) int {
	if limit <= 0 {
		return DefaultCatalogLimit
	}
	if limit > MaxCatalogLimit {
		return MaxCatalogLimit
	}
	return limit
}

func boolKey(v bool) string {
	if v {
		return "1"
	}
	return "0"
}

func filterSchemas(hits []SchemaHit, prefix string, limit int) ([]SchemaHit, bool) {
	prefix = strings.ToLower(strings.TrimSpace(prefix))
	out := make([]SchemaHit, 0, min(len(hits), limit))
	truncated := false
	for _, h := range hits {
		if prefix != "" && !strings.HasPrefix(strings.ToLower(h.Name), prefix) {
			continue
		}
		if len(out) >= limit {
			truncated = true
			break
		}
		out = append(out, h)
	}
	return out, truncated
}

func filterTables(hits []TableHit, prefix string, limit int) ([]TableHit, bool) {
	prefix = strings.ToLower(strings.TrimSpace(prefix))
	out := make([]TableHit, 0, min(len(hits), limit))
	truncated := false
	for _, h := range hits {
		if prefix != "" && !strings.HasPrefix(strings.ToLower(h.Name), prefix) {
			continue
		}
		if len(out) >= limit {
			truncated = true
			break
		}
		out = append(out, h)
	}
	return out, truncated
}

func filterColumns(hits []ColumnHit, prefix string, limit int) ([]ColumnHit, bool) {
	prefix = strings.ToLower(strings.TrimSpace(prefix))
	out := make([]ColumnHit, 0, min(len(hits), limit))
	truncated := false
	for _, h := range hits {
		if prefix != "" && !strings.HasPrefix(strings.ToLower(h.Name), prefix) {
			continue
		}
		if len(out) >= limit {
			truncated = true
			break
		}
		out = append(out, h)
	}
	return out, truncated
}

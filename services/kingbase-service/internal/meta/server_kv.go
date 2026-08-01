package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ServerKVItem 是 Variables / Status 的一行键值。
type ServerKVItem struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// ServerKVResult 是 meta.serverVariables / meta.serverStatus 返回。
type ServerKVResult struct {
	Items     []ServerKVItem `json:"items"`
	Truncated bool           `json:"truncated,omitempty"`
	Limit     int            `json:"limit,omitempty"`
}

const serverKVFetchLimit = 2000

// ListServerVariables 读取 pg_settings（对齐 MySQL SHOW GLOBAL VARIABLES）。
// like 为子串过滤（大小写不敏感）；空字符串表示不过滤。
func ListServerVariables(ctx context.Context, pool *pgxpool.Pool, like string) (*ServerKVResult, error) {
	if pool == nil {
		return nil, fmt.Errorf("kingbase: server variables: nil pool")
	}
	like = clampLike(like)

	// setting 在部分 Kingbase（含空串=NULL 的 Oracle 兼容模式）下可为 NULL；
	// COALESCE(setting,'') 仍可能得到 NULL，故用 NullString 扫描，NULL 视为空串。
	rows, err := pool.Query(ctx, `
SELECT name::text,
       setting::text AS value
FROM pg_catalog.pg_settings
WHERE ($1 = '' OR name ILIKE '%' || $1 || '%' OR setting::text ILIKE '%' || $1 || '%')
ORDER BY name
`, like)
	if err != nil {
		return nil, fmt.Errorf("kingbase: server variables: %w", err)
	}
	defer rows.Close()

	out := &ServerKVResult{Items: make([]ServerKVItem, 0, 256), Limit: serverKVFetchLimit}
	for rows.Next() {
		var name sql.NullString
		var value sql.NullString
		if err := rows.Scan(&name, &value); err != nil {
			return nil, fmt.Errorf("kingbase: scan server variables: %w", err)
		}
		if !name.Valid || name.String == "" {
			continue
		}
		out.Items = append(out.Items, ServerKVItem{Name: name.String, Value: value.String})
		if len(out.Items) > serverKVFetchLimit {
			out.Truncated = true
			out.Items = out.Items[:serverKVFetchLimit]
			break
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// ListServerStatus 扁平化 pg_stat_* 计数器（对齐 MySQL SHOW GLOBAL STATUS）。
// 优先聚合 pg_stat_database；可用时追加 pg_stat_bgwriter；列缺失时逐级回退。
func ListServerStatus(ctx context.Context, pool *pgxpool.Pool, like string) (*ServerKVResult, error) {
	if pool == nil {
		return nil, fmt.Errorf("kingbase: server status: nil pool")
	}
	like = clampLike(like)

	items, err := listDatabaseStatus(ctx, pool)
	if err != nil {
		return nil, err
	}
	if bg, bgErr := listBgwriterStatus(ctx, pool); bgErr == nil {
		items = append(items, bg...)
	}

	out := &ServerKVResult{Items: make([]ServerKVItem, 0, len(items)), Limit: serverKVFetchLimit}
	likeLower := strings.ToLower(like)
	for _, item := range items {
		if likeLower != "" {
			if !strings.Contains(strings.ToLower(item.Name), likeLower) &&
				!strings.Contains(strings.ToLower(item.Value), likeLower) {
				continue
			}
		}
		out.Items = append(out.Items, item)
		if len(out.Items) > serverKVFetchLimit {
			out.Truncated = true
			out.Items = out.Items[:serverKVFetchLimit]
			break
		}
	}
	return out, nil
}

func clampLike(like string) string {
	like = strings.TrimSpace(like)
	if len(like) > 128 {
		return like[:128]
	}
	return like
}

func listDatabaseStatus(ctx context.Context, pool *pgxpool.Pool) ([]ServerKVItem, error) {
	items, err := queryDatabaseStatusRich(ctx, pool)
	if err != nil && isUndefinedColumn(err) {
		items, err = queryDatabaseStatusCore(ctx, pool)
	}
	if err != nil && isUndefinedColumn(err) {
		items, err = queryDatabaseStatusMinimal(ctx, pool)
	}
	if err != nil {
		return nil, fmt.Errorf("kingbase: server status database: %w", err)
	}
	return items, nil
}

func appendHitRatio(items []ServerKVItem, blksRead, blksHit int64) []ServerKVItem {
	total := blksRead + blksHit
	ratio := "0"
	if total > 0 {
		ratio = strconv.FormatFloat(float64(blksHit)*100/float64(total), 'f', 2, 64)
	}
	return append(items, ServerKVItem{Name: "blks_hit_ratio", Value: ratio})
}

func kvInt(name string, v int64) ServerKVItem {
	return ServerKVItem{Name: name, Value: strconv.FormatInt(v, 10)}
}

func kvFloat(name string, v float64) ServerKVItem {
	if v == float64(int64(v)) {
		return ServerKVItem{Name: name, Value: strconv.FormatInt(int64(v), 10)}
	}
	return ServerKVItem{Name: name, Value: strconv.FormatFloat(v, 'f', 3, 64)}
}

func queryDatabaseStatusRich(ctx context.Context, pool *pgxpool.Pool) ([]ServerKVItem, error) {
	var (
		xactCommit, xactRollback                   int64
		blksRead, blksHit                          int64
		tupReturned, tupFetched                    int64
		tupInserted, tupUpdated, tupDeleted        int64
		conflicts, tempFiles, tempBytes, deadlocks int64
		blkReadTime, blkWriteTime                  float64
		sessions, sessionsAbandoned                int64
		sessionsFatal, sessionsKilled              int64
	)
	err := pool.QueryRow(ctx, `
SELECT
  COALESCE(SUM(xact_commit), 0)::bigint,
  COALESCE(SUM(xact_rollback), 0)::bigint,
  COALESCE(SUM(blks_read), 0)::bigint,
  COALESCE(SUM(blks_hit), 0)::bigint,
  COALESCE(SUM(tup_returned), 0)::bigint,
  COALESCE(SUM(tup_fetched), 0)::bigint,
  COALESCE(SUM(tup_inserted), 0)::bigint,
  COALESCE(SUM(tup_updated), 0)::bigint,
  COALESCE(SUM(tup_deleted), 0)::bigint,
  COALESCE(SUM(conflicts), 0)::bigint,
  COALESCE(SUM(temp_files), 0)::bigint,
  COALESCE(SUM(temp_bytes), 0)::bigint,
  COALESCE(SUM(deadlocks), 0)::bigint,
  COALESCE(SUM(blk_read_time), 0)::float8,
  COALESCE(SUM(blk_write_time), 0)::float8,
  COALESCE(SUM(sessions), 0)::bigint,
  COALESCE(SUM(sessions_abandoned), 0)::bigint,
  COALESCE(SUM(sessions_fatal), 0)::bigint,
  COALESCE(SUM(sessions_killed), 0)::bigint
FROM pg_catalog.pg_stat_database
WHERE datname IS NOT NULL
`).Scan(
		&xactCommit, &xactRollback, &blksRead, &blksHit,
		&tupReturned, &tupFetched, &tupInserted, &tupUpdated, &tupDeleted,
		&conflicts, &tempFiles, &tempBytes, &deadlocks,
		&blkReadTime, &blkWriteTime,
		&sessions, &sessionsAbandoned, &sessionsFatal, &sessionsKilled,
	)
	if err != nil {
		return nil, err
	}
	items := []ServerKVItem{
		kvInt("xact_commit", xactCommit),
		kvInt("xact_rollback", xactRollback),
		kvInt("blks_read", blksRead),
		kvInt("blks_hit", blksHit),
		kvInt("tup_returned", tupReturned),
		kvInt("tup_fetched", tupFetched),
		kvInt("tup_inserted", tupInserted),
		kvInt("tup_updated", tupUpdated),
		kvInt("tup_deleted", tupDeleted),
		kvInt("conflicts", conflicts),
		kvInt("temp_files", tempFiles),
		kvInt("temp_bytes", tempBytes),
		kvInt("deadlocks", deadlocks),
		kvFloat("blk_read_time", blkReadTime),
		kvFloat("blk_write_time", blkWriteTime),
		kvInt("sessions", sessions),
		kvInt("sessions_abandoned", sessionsAbandoned),
		kvInt("sessions_fatal", sessionsFatal),
		kvInt("sessions_killed", sessionsKilled),
	}
	return appendHitRatio(items, blksRead, blksHit), nil
}

func queryDatabaseStatusCore(ctx context.Context, pool *pgxpool.Pool) ([]ServerKVItem, error) {
	var (
		xactCommit, xactRollback                   int64
		blksRead, blksHit                          int64
		tupReturned, tupFetched                    int64
		tupInserted, tupUpdated, tupDeleted        int64
		conflicts, tempFiles, tempBytes, deadlocks int64
		blkReadTime, blkWriteTime                  float64
	)
	err := pool.QueryRow(ctx, `
SELECT
  COALESCE(SUM(xact_commit), 0)::bigint,
  COALESCE(SUM(xact_rollback), 0)::bigint,
  COALESCE(SUM(blks_read), 0)::bigint,
  COALESCE(SUM(blks_hit), 0)::bigint,
  COALESCE(SUM(tup_returned), 0)::bigint,
  COALESCE(SUM(tup_fetched), 0)::bigint,
  COALESCE(SUM(tup_inserted), 0)::bigint,
  COALESCE(SUM(tup_updated), 0)::bigint,
  COALESCE(SUM(tup_deleted), 0)::bigint,
  COALESCE(SUM(conflicts), 0)::bigint,
  COALESCE(SUM(temp_files), 0)::bigint,
  COALESCE(SUM(temp_bytes), 0)::bigint,
  COALESCE(SUM(deadlocks), 0)::bigint,
  COALESCE(SUM(blk_read_time), 0)::float8,
  COALESCE(SUM(blk_write_time), 0)::float8
FROM pg_catalog.pg_stat_database
WHERE datname IS NOT NULL
`).Scan(
		&xactCommit, &xactRollback, &blksRead, &blksHit,
		&tupReturned, &tupFetched, &tupInserted, &tupUpdated, &tupDeleted,
		&conflicts, &tempFiles, &tempBytes, &deadlocks,
		&blkReadTime, &blkWriteTime,
	)
	if err != nil {
		return nil, err
	}
	items := []ServerKVItem{
		kvInt("xact_commit", xactCommit),
		kvInt("xact_rollback", xactRollback),
		kvInt("blks_read", blksRead),
		kvInt("blks_hit", blksHit),
		kvInt("tup_returned", tupReturned),
		kvInt("tup_fetched", tupFetched),
		kvInt("tup_inserted", tupInserted),
		kvInt("tup_updated", tupUpdated),
		kvInt("tup_deleted", tupDeleted),
		kvInt("conflicts", conflicts),
		kvInt("temp_files", tempFiles),
		kvInt("temp_bytes", tempBytes),
		kvInt("deadlocks", deadlocks),
		kvFloat("blk_read_time", blkReadTime),
		kvFloat("blk_write_time", blkWriteTime),
	}
	return appendHitRatio(items, blksRead, blksHit), nil
}

func queryDatabaseStatusMinimal(ctx context.Context, pool *pgxpool.Pool) ([]ServerKVItem, error) {
	var (
		xactCommit, xactRollback            int64
		blksRead, blksHit                   int64
		tupReturned, tupFetched             int64
		tupInserted, tupUpdated, tupDeleted int64
	)
	err := pool.QueryRow(ctx, `
SELECT
  COALESCE(SUM(xact_commit), 0)::bigint,
  COALESCE(SUM(xact_rollback), 0)::bigint,
  COALESCE(SUM(blks_read), 0)::bigint,
  COALESCE(SUM(blks_hit), 0)::bigint,
  COALESCE(SUM(tup_returned), 0)::bigint,
  COALESCE(SUM(tup_fetched), 0)::bigint,
  COALESCE(SUM(tup_inserted), 0)::bigint,
  COALESCE(SUM(tup_updated), 0)::bigint,
  COALESCE(SUM(tup_deleted), 0)::bigint
FROM pg_catalog.pg_stat_database
WHERE datname IS NOT NULL
`).Scan(
		&xactCommit, &xactRollback, &blksRead, &blksHit,
		&tupReturned, &tupFetched, &tupInserted, &tupUpdated, &tupDeleted,
	)
	if err != nil {
		return nil, err
	}
	items := []ServerKVItem{
		kvInt("xact_commit", xactCommit),
		kvInt("xact_rollback", xactRollback),
		kvInt("blks_read", blksRead),
		kvInt("blks_hit", blksHit),
		kvInt("tup_returned", tupReturned),
		kvInt("tup_fetched", tupFetched),
		kvInt("tup_inserted", tupInserted),
		kvInt("tup_updated", tupUpdated),
		kvInt("tup_deleted", tupDeleted),
	}
	return appendHitRatio(items, blksRead, blksHit), nil
}

func listBgwriterStatus(ctx context.Context, pool *pgxpool.Pool) ([]ServerKVItem, error) {
	items, err := queryBgwriterModern(ctx, pool)
	if err != nil && isUndefinedColumn(err) {
		items, err = queryBgwriterLegacy(ctx, pool)
	}
	if err != nil {
		return nil, err
	}
	return items, nil
}

func queryBgwriterModern(ctx context.Context, pool *pgxpool.Pool) ([]ServerKVItem, error) {
	var (
		checkpointsTimed, checkpointsReq                  int64
		checkpointWriteTime, checkpointSyncTime           float64
		buffersCheckpoint, buffersClean, maxwrittenClean  int64
		buffersBackend, buffersBackendFsync, buffersAlloc int64
	)
	err := pool.QueryRow(ctx, `
SELECT
  checkpoints_timed::bigint,
  checkpoints_req::bigint,
  COALESCE(checkpoint_write_time, 0)::float8,
  COALESCE(checkpoint_sync_time, 0)::float8,
  buffers_checkpoint::bigint,
  buffers_clean::bigint,
  maxwritten_clean::bigint,
  buffers_backend::bigint,
  buffers_backend_fsync::bigint,
  buffers_alloc::bigint
FROM pg_catalog.pg_stat_bgwriter
`).Scan(
		&checkpointsTimed, &checkpointsReq,
		&checkpointWriteTime, &checkpointSyncTime,
		&buffersCheckpoint, &buffersClean, &maxwrittenClean,
		&buffersBackend, &buffersBackendFsync, &buffersAlloc,
	)
	if err != nil {
		return nil, err
	}
	return []ServerKVItem{
		kvInt("checkpoints_timed", checkpointsTimed),
		kvInt("checkpoints_req", checkpointsReq),
		kvFloat("checkpoint_write_time", checkpointWriteTime),
		kvFloat("checkpoint_sync_time", checkpointSyncTime),
		kvInt("buffers_checkpoint", buffersCheckpoint),
		kvInt("buffers_clean", buffersClean),
		kvInt("maxwritten_clean", maxwrittenClean),
		kvInt("buffers_backend", buffersBackend),
		kvInt("buffers_backend_fsync", buffersBackendFsync),
		kvInt("buffers_alloc", buffersAlloc),
	}, nil
}

func queryBgwriterLegacy(ctx context.Context, pool *pgxpool.Pool) ([]ServerKVItem, error) {
	var (
		checkpointsTimed, checkpointsReq                  int64
		buffersCheckpoint, buffersClean, maxwrittenClean  int64
		buffersBackend, buffersBackendFsync, buffersAlloc int64
	)
	err := pool.QueryRow(ctx, `
SELECT
  checkpoints_timed::bigint,
  checkpoints_req::bigint,
  buffers_checkpoint::bigint,
  buffers_clean::bigint,
  maxwritten_clean::bigint,
  buffers_backend::bigint,
  buffers_backend_fsync::bigint,
  buffers_alloc::bigint
FROM pg_catalog.pg_stat_bgwriter
`).Scan(
		&checkpointsTimed, &checkpointsReq,
		&buffersCheckpoint, &buffersClean, &maxwrittenClean,
		&buffersBackend, &buffersBackendFsync, &buffersAlloc,
	)
	if err != nil {
		return nil, err
	}
	return []ServerKVItem{
		kvInt("checkpoints_timed", checkpointsTimed),
		kvInt("checkpoints_req", checkpointsReq),
		kvInt("buffers_checkpoint", buffersCheckpoint),
		kvInt("buffers_clean", buffersClean),
		kvInt("maxwritten_clean", maxwrittenClean),
		kvInt("buffers_backend", buffersBackend),
		kvInt("buffers_backend_fsync", buffersBackendFsync),
		kvInt("buffers_alloc", buffersAlloc),
	}, nil
}

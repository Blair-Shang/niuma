package debug

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Vastbase A 兼容（sql_compatibility=A）：
//   - 用户过程用 DBMS_OUTPUT.PUT_LINE（包过程，不是 schema）
//   - dbe_output / gms_output 在本实例不存在（会报 schema does not exist）
//   - 以 BEGIN 开头的语句须走 SimpleProtocol，否则易被当成开事务
//   - ENABLE 成功即可；探针失败不应阻断（PUT/GET 形态可能不同）

const (
	helperEnableProc   = "nm_niuma_dbms_enable"
	helperDrainProc    = "nm_niuma_dbms_drain"
	helperPutProc      = "nm_niuma_dbms_put"
	helperDrainTable   = "nm_niuma_dbms_drain_lines"
	helperCaptureTable = "nm_niuma_dbms_capture"
)

// NoticeSink 收集 NOTICE。
type NoticeSink struct {
	mu    sync.Mutex
	lines []string
}

func (s *NoticeSink) Handler() func(*pgconn.PgConn, *pgconn.Notice) {
	return func(_ *pgconn.PgConn, n *pgconn.Notice) {
		if s == nil || n == nil {
			return
		}
		msg := strings.TrimRight(n.Message, "\r\n")
		if msg == "" {
			return
		}
		s.mu.Lock()
		s.lines = append(s.lines, msg)
		if len(s.lines) > 5000 {
			s.lines = s.lines[len(s.lines)-5000:]
		}
		s.mu.Unlock()
	}
}

func (s *NoticeSink) Take() []string {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.lines) == 0 {
		return nil
	}
	out := make([]string, len(s.lines))
	copy(out, s.lines)
	s.lines = s.lines[:0]
	return out
}

type enableResult struct {
	Pkg  string
	Diag string
}

func enableServerOutput(ctx context.Context, conn *pgx.Conn) enableResult {
	if conn == nil {
		return enableResult{Diag: "conn nil"}
	}

	var compat string
	_ = conn.QueryRow(ctx, `SELECT current_setting('sql_compatibility'::text)`).Scan(&compat)
	slog.Info("debug.dbms_output.compat", "sql_compatibility", compat)

	var errs []string
	note := func(step string, err error) {
		if err == nil {
			return
		}
		errs = append(errs, step+": "+err.Error())
		slog.Debug("debug.dbms_output.step_fail", "step", step, "err", err.Error())
		_, _ = conn.Exec(ctx, `ROLLBACK`)
	}

	// 优先匿名 ENABLE（无 CREATE）；helper 过程放最后，避免调试会话里 DDL 干扰缓冲
	candidates := []struct {
		name string
		sql  string
	}{
		{"oneline_enable_1m", `begin DBMS_OUTPUT.ENABLE(1000000); end;`},
		{"oneline_enable_20k", `begin DBMS_OUTPUT.ENABLE(20000); end;`},
		{"oneline_enable_null", `begin DBMS_OUTPUT.ENABLE(NULL); end;`},
		{"declare_enable_1m", `DECLARE
BEGIN
  DBMS_OUTPUT.ENABLE(1000000);
END;`},
		{"declare_enable_null", `DECLARE
BEGIN
  DBMS_OUTPUT.ENABLE(NULL);
END;`},
		{"oneline_enable_bare", `begin DBMS_OUTPUT.ENABLE; end;`},
		{"helper_proc", ""},
	}

	for _, c := range candidates {
		var err error
		if c.name == "helper_proc" {
			err = ensureHelperEnableProc(ctx, conn)
			if err != nil {
				note(c.name+"_create", err)
				continue
			}
			_, err = execSimple(ctx, conn, `CALL `+helperEnableProc+`()`)
			if err != nil {
				note(c.name+"_call", err)
				continue
			}
		} else {
			_, err = execSimple(ctx, conn, c.sql)
			if err != nil {
				note(c.name, err)
				continue
			}
		}

		if !connHealthy(ctx, conn) {
			note(c.name+"_txn", fmt.Errorf("connection unhealthy after enable (rolled back)"))
			continue
		}

		// ENABLE 成功即采用。勿在此处 probe（PUT+drain 会建 helper，易与 turn_on/CALL 互相干扰）
		slog.Info("debug.dbms_output.enable_ok", "via", c.name)
		return enableResult{Pkg: "DBMS_OUTPUT"}
	}

	diag := "ENABLE 失败（sql_compatibility=" + compat + "）"
	if len(errs) > 0 {
		start := len(errs) - 4
		if start < 0 {
			start = 0
		}
		diag += "；" + strings.Join(errs[start:], " | ")
	}
	slog.Warn("debug.dbms_output.enable_failed", "diag", diag)
	return enableResult{Diag: diag}
}

func connHealthy(ctx context.Context, conn *pgx.Conn) bool {
	if _, err := conn.Exec(ctx, `SELECT 1`); err != nil {
		_, _ = conn.Exec(ctx, `ROLLBACK`)
		return false
	}
	return true
}

func ensureHelperEnableProc(ctx context.Context, conn *pgx.Conn) error {
	sql := fmt.Sprintf(`CREATE OR REPLACE PROCEDURE %s()
AS
BEGIN
  DBMS_OUTPUT.ENABLE(NULL);
EXCEPTION WHEN OTHERS THEN
  DBMS_OUTPUT.ENABLE(1000000);
END;`, helperEnableProc)
	_, err := execSimple(ctx, conn, sql)
	return err
}

func ensureHelperPutProc(ctx context.Context, conn *pgx.Conn) error {
	sql := fmt.Sprintf(`CREATE OR REPLACE PROCEDURE %s(p_msg IN VARCHAR2)
AS
BEGIN
  DBMS_OUTPUT.PUT_LINE(p_msg);
END;`, helperPutProc)
	_, err := execSimple(ctx, conn, sql)
	return err
}

func ensureHelperDrain(ctx context.Context, conn *pgx.Conn) error {
	// 只用 TEMP 表，禁止落成持久表污染业务库
	if _, err := execSimple(ctx, conn, fmt.Sprintf(
		`CREATE TEMP TABLE IF NOT EXISTS %s (ord serial, line text)`, helperDrainTable,
	)); err != nil {
		return err
	}
	sql := fmt.Sprintf(`CREATE OR REPLACE PROCEDURE %s()
AS
DECLARE
  v_line VARCHAR2(32767);
  v_status INTEGER := 1;
  v_n INTEGER := 0;
BEGIN
  DELETE FROM %s;
  LOOP
    v_status := 1;
    v_line := NULL;
    DBMS_OUTPUT.GET_LINE(v_line, v_status);
    EXIT WHEN v_status <> 0;
    INSERT INTO %s(line) VALUES (coalesce(v_line, ''));
    v_n := v_n + 1;
    EXIT WHEN v_n >= 5000;
  END LOOP;
END;`, helperDrainProc, helperDrainTable, helperDrainTable)
	_, err := execSimple(ctx, conn, sql)
	return err
}

// refreshServerOutputEnable 在 turn_on 之后再次 ENABLE，防止调试会话重置缓冲开关。
// 注意：不得在 PUT_LINE 之后、GET_LINE 之前调用（ENABLE 会清空已有缓冲）。
func refreshServerOutputEnable(ctx context.Context, conn *pgx.Conn) {
	if conn == nil {
		return
	}
	// 优先固定大小；Vastbase/openGauss 上 NULL 可能无效
	if _, err := execSimple(ctx, conn, `begin DBMS_OUTPUT.ENABLE(1000000); end;`); err == nil && connHealthy(ctx, conn) {
		return
	}
	_, _ = conn.Exec(ctx, `ROLLBACK`)
	_, _ = execSimple(ctx, conn, `begin DBMS_OUTPUT.ENABLE(20000); end;`)
}

// ensureCaptureTable 创建 TEMP 表，供调试执行块内同步落库 DBMS_OUTPUT。
func ensureCaptureTable(ctx context.Context, conn *pgx.Conn) error {
	_, err := execSimple(ctx, conn, fmt.Sprintf(
		`CREATE TEMP TABLE IF NOT EXISTS %s (ord serial, line text)`, helperCaptureTable,
	))
	return err
}

func readCaptureTable(ctx context.Context, conn *pgx.Conn) []string {
	if conn == nil {
		return nil
	}
	rows, err := conn.Query(ctx, fmt.Sprintf(`SELECT line FROM %s ORDER BY ord`, helperCaptureTable))
	if err != nil {
		slog.Warn("debug.dbms_output.capture_read", "err", err.Error())
		return nil
	}
	defer rows.Close()
	raw := make([]string, 0, 32)
	for rows.Next() {
		var line string
		if rows.Scan(&line) == nil {
			raw = append(raw, line)
		}
	}
	_, _ = execSimple(ctx, conn, fmt.Sprintf(`DELETE FROM %s`, helperCaptureTable))
	trimmed := trimOutputLines(raw)
	if len(trimmed) > 0 {
		return trimmed
	}
	// 仅有内部探针：说明 ENABLE/GET 通，例程侧 PUT_LINE 未进同一缓冲
	for _, line := range raw {
		if strings.Contains(line, "nm_enable_ok") {
			return []string{"# DBMS_OUTPUT：ENABLE/GET_LINE 正常，但例程 PUT_LINE 未写入同一缓冲（常见于调试会话隔离）"}
		}
		if strings.HasPrefix(strings.TrimSpace(line), "# DBMS_OUTPUT capture:") {
			return []string{strings.TrimRight(line, "\r\n")}
		}
	}
	return nil
}

// prepareConnForDrain 在拉取缓冲前尽量让连接回到可用态；不调用 ENABLE。
func prepareConnForDrain(ctx context.Context, conn *pgx.Conn) {
	if conn == nil {
		return
	}
	if _, err := conn.Exec(ctx, `SELECT 1`); err != nil {
		_, _ = conn.Exec(ctx, `ROLLBACK`)
		_, _ = conn.Exec(ctx, `SELECT 1`)
	}
}

// cleanupDbmsHelpers 在调试结束时尽量清理本会话创建的辅助对象（过程；TEMP 表随连接关闭消失）。
func cleanupDbmsHelpers(ctx context.Context, conn *pgx.Conn) {
	if conn == nil {
		return
	}
	for _, name := range []string{helperEnableProc, helperDrainProc, helperPutProc} {
		_, _ = execSimple(ctx, conn, fmt.Sprintf(`DROP PROCEDURE IF EXISTS %s`, name))
		_, _ = execSimple(ctx, conn, fmt.Sprintf(`DROP PROCEDURE IF EXISTS %s()`, name))
	}
}

func probeOK(ctx context.Context, conn *pgx.Conn) bool {
	marker := "nm_dbms_probe"
	if err := ensureHelperPutProc(ctx, conn); err == nil {
		if _, err := execSimple(ctx, conn, fmt.Sprintf(`CALL %s('%s')`, helperPutProc, marker)); err != nil {
			slog.Warn("debug.dbms_output.probe_put", "err", err.Error())
			return false
		}
	} else {
		put := fmt.Sprintf(`DECLARE
BEGIN
  DBMS_OUTPUT.PUT_LINE('%s');
END;`, marker)
		if _, err := execSimple(ctx, conn, put); err != nil {
			slog.Warn("debug.dbms_output.probe_put_anon", "err", err.Error())
			return false
		}
	}
	raw := drainServerOutput(ctx, conn)
	for _, line := range raw {
		if strings.Contains(line, marker) {
			return true
		}
	}
	return false
}

func drainViaAnon(ctx context.Context, conn *pgx.Conn) []string {
	_, _ = execSimple(ctx, conn, `CREATE TEMP TABLE IF NOT EXISTS nm_dbms_output_drain (ord serial, line text)`)
	_, _ = execSimple(ctx, conn, `TRUNCATE nm_dbms_output_drain`)
	// 与 GaussDB 文档一致：VARCHAR + 无吞异常；失败则让上层改走 helper
	sql := `DECLARE
  v_line VARCHAR(32672);
  v_status INTEGER := 0;
  v_n INTEGER := 0;
BEGIN
  LOOP
    v_status := 1;
    v_line := NULL;
    DBMS_OUTPUT.GET_LINE(v_line, v_status);
    EXIT WHEN v_status <> 0;
    INSERT INTO nm_dbms_output_drain(line) VALUES (coalesce(v_line, ''));
    v_n := v_n + 1;
    EXIT WHEN v_n >= 5000;
  END LOOP;
END;`
	if _, err := execSimple(ctx, conn, sql); err != nil {
		slog.Warn("debug.dbms_output.drain_anon", "err", err.Error())
		return nil
	}
	rows, err := conn.Query(ctx, `SELECT line FROM nm_dbms_output_drain ORDER BY ord`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := make([]string, 0, 32)
	for rows.Next() {
		var line string
		if rows.Scan(&line) == nil {
			out = append(out, line)
		}
	}
	return out
}

func drainViaHelperProc(ctx context.Context, conn *pgx.Conn) []string {
	if err := ensureHelperDrain(ctx, conn); err != nil {
		slog.Warn("debug.dbms_output.drain_helper_create", "err", err.Error())
		return nil
	}
	if _, err := execSimple(ctx, conn, `CALL `+helperDrainProc+`()`); err != nil {
		slog.Warn("debug.dbms_output.drain_helper_call", "err", err.Error())
		return nil
	}
	rows, err := conn.Query(ctx, fmt.Sprintf(`SELECT line FROM %s ORDER BY ord`, helperDrainTable))
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := make([]string, 0, 32)
	for rows.Next() {
		var line string
		if rows.Scan(&line) == nil {
			out = append(out, line)
		}
	}
	_, _ = execSimple(ctx, conn, `DELETE FROM `+helperDrainTable)
	return out
}

// drainViaRaiseNotice 将缓冲行转成 NOTICE，供 NoticeSink 收集（部分实例 GET_LINE 写表失败时的兜底）。
func drainViaRaiseNotice(ctx context.Context, conn *pgx.Conn) {
	sql := `DECLARE
  v_line VARCHAR(32672);
  v_status INTEGER := 0;
  v_n INTEGER := 0;
BEGIN
  LOOP
    v_status := 1;
    v_line := NULL;
    DBMS_OUTPUT.GET_LINE(v_line, v_status);
    EXIT WHEN v_status <> 0;
    RAISE NOTICE '%', v_line;
    v_n := v_n + 1;
    EXIT WHEN v_n >= 5000;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  NULL;
END;`
	if _, err := execSimple(ctx, conn, sql); err != nil {
		slog.Debug("debug.dbms_output.drain_notice", "err", err.Error())
	}
}

func drainServerOutput(ctx context.Context, conn *pgx.Conn) []string {
	if conn == nil {
		return nil
	}
	if lines := drainViaAnon(ctx, conn); len(lines) > 0 {
		return trimOutputLines(lines)
	}
	if lines := drainViaHelperProc(ctx, conn); len(lines) > 0 {
		return trimOutputLines(lines)
	}
	return nil
}

func execSimple(ctx context.Context, conn *pgx.Conn, sql string) (pgconn.CommandTag, error) {
	return conn.Exec(ctx, sql, pgx.QueryExecModeSimpleProtocol)
}

func trimOutputLines(lines []string) []string {
	if len(lines) == 0 {
		return nil
	}
	out := make([]string, 0, len(lines))
	seen := make(map[string]struct{}, len(lines))
	for _, line := range lines {
		s := strings.TrimRight(line, "\r\n")
		// 内部探针：确认 ENABLE 可用，不展示给用户
		if strings.Contains(s, "nm_dbms_probe") || s == "nm_enable_ok" || s == "nm_dbms_warmup" {
			continue
		}
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
		if len(out) >= 5000 {
			break
		}
	}
	return out
}

func mergeOutputSources(parts ...[]string) []string {
	var all []string
	for _, p := range parts {
		all = append(all, p...)
	}
	return trimOutputLines(all)
}

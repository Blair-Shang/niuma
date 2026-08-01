package meta

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SequenceState 用于转储后 setval，对齐当前进度。
type SequenceState struct {
	LastValue int64
	IsCalled  bool
}

// GetSequenceDDL 还原 CREATE SEQUENCE（不含 OWNED BY；跨库恢复由当前用户拥有）。
func GetSequenceDDL(ctx context.Context, pool *pgxpool.Pool, ref RelationRef) (*DDLResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}

	var (
		dataType string
		start    int64
		inc      int64
		maxV     int64
		minV     int64
		cache    int64
		cycle    bool
	)
	err := pool.QueryRow(ctx, `
SELECT pg_catalog.format_type(s.seqtypid, NULL),
  s.seqstart, s.seqincrement, s.seqmax, s.seqmin, s.seqcache, s.seqcycle
FROM pg_catalog.pg_sequence s
JOIN pg_catalog.pg_class c ON c.oid = s.seqrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2
LIMIT 1`, ref.Schema, ref.Name).Scan(&dataType, &start, &inc, &maxV, &minV, &cache, &cycle)
	if err != nil {
		return nil, fmt.Errorf("kingbase: sequence ddl: %w", err)
	}

	qn := quoteIdent(ref.Schema) + "." + quoteIdent(ref.Name)
	var b strings.Builder
	b.WriteString("CREATE SEQUENCE ")
	b.WriteString(qn)
	b.WriteByte('\n')
	if dataType != "" && !strings.EqualFold(dataType, "bigint") {
		b.WriteString("    AS ")
		b.WriteString(dataType)
		b.WriteByte('\n')
	}
	b.WriteString("    START WITH ")
	b.WriteString(strconv.FormatInt(start, 10))
	b.WriteByte('\n')
	b.WriteString("    INCREMENT BY ")
	b.WriteString(strconv.FormatInt(inc, 10))
	b.WriteByte('\n')
	b.WriteString("    MINVALUE ")
	b.WriteString(strconv.FormatInt(minV, 10))
	b.WriteByte('\n')
	b.WriteString("    MAXVALUE ")
	b.WriteString(strconv.FormatInt(maxV, 10))
	b.WriteByte('\n')
	b.WriteString("    CACHE ")
	b.WriteString(strconv.FormatInt(cache, 10))
	b.WriteByte('\n')
	if cycle {
		b.WriteString("    CYCLE")
	} else {
		b.WriteString("    NO CYCLE")
	}

	return &DDLResult{ObjectType: "sequence", DDL: b.String()}, nil
}

// GetSequenceState 读取序列当前值，供转储数据后 setval。
func GetSequenceState(ctx context.Context, pool *pgxpool.Pool, ref RelationRef) (*SequenceState, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}
	qn := quoteIdent(ref.Schema) + "." + quoteIdent(ref.Name)
	var state SequenceState
	err := pool.QueryRow(ctx, fmt.Sprintf(`SELECT last_value, is_called FROM %s`, qn)).Scan(&state.LastValue, &state.IsCalled)
	if err != nil {
		return nil, fmt.Errorf("kingbase: sequence state %s: %w", qn, err)
	}
	return &state, nil
}

// FormatSetval 生成 setval 语句（跨库恢复后对齐序列进度）。
func FormatSetval(ref RelationRef, state SequenceState) string {
	qn := quoteIdent(ref.Schema) + "." + quoteIdent(ref.Name)
	called := "false"
	if state.IsCalled {
		called = "true"
	}
	return fmt.Sprintf(
		"SELECT pg_catalog.setval(%s, %s, %s)",
		quoteString(qn),
		strconv.FormatInt(state.LastValue, 10),
		called,
	)
}

func quoteString(s string) string {
	return `'` + strings.ReplaceAll(s, `'`, `''`) + `'`
}

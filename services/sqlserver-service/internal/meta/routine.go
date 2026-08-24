package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// RoutineRef 定位过程 / 函数 / 序列 / 视图。
type RoutineRef struct {
	Database string
	Schema   string
	Name     string
	Kind     string // procedure | function | sequence | view
}

// RoutineSourceResult 是 meta.routineSource 返回。
type RoutineSourceResult struct {
	Name       string `json:"name"`
	Schema     string `json:"schema,omitempty"`
	Kind       string `json:"kind"`
	Definition string `json:"definition"`
}

func requireRoutine(ref RoutineRef) error {
	if strings.TrimSpace(ref.Schema) == "" || strings.TrimSpace(ref.Name) == "" {
		return fmt.Errorf("sqlserver: schema and name required")
	}
	return nil
}

// KindFromSysType 将 sys.objects.type 映射为对象脚本种类。
func KindFromSysType(typ string) string {
	switch strings.ToUpper(strings.TrimSpace(typ)) {
	case "P", "PC":
		return "procedure"
	case "FN", "IF", "TF", "FS", "FT":
		return "function"
	case "V":
		return "view"
	case "SO":
		return "sequence"
	default:
		return ""
	}
}

// GetRoutineSource 读取过程 / 函数 / 序列 / 视图定义。
func GetRoutineSource(ctx context.Context, db *sql.DB, ref RoutineRef) (*RoutineSourceResult, error) {
	if err := requireRoutine(ref); err != nil {
		return nil, err
	}
	kind := strings.ToLower(strings.TrimSpace(ref.Kind))
	detected, err := detectRoutineKind(ctx, db, ref)
	if err != nil {
		return nil, err
	}
	if kind == "" {
		kind = detected
	}
	if kind == "" {
		return nil, fmt.Errorf("sqlserver: object %s.%s not found or unsupported", ref.Schema, ref.Name)
	}

	var def string
	switch kind {
	case "sequence":
		def, err = sequenceDDL(ctx, db, RelationRef{Schema: ref.Schema, Name: ref.Name})
	case "procedure", "function", "view":
		def, err = moduleDefinition(ctx, db, RelationRef{Schema: ref.Schema, Name: ref.Name})
	default:
		return nil, fmt.Errorf("sqlserver: kind must be procedure, function, sequence or view")
	}
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(def) == "" {
		return nil, fmt.Errorf("sqlserver: definition empty or encrypted for %s.%s", ref.Schema, ref.Name)
	}
	return &RoutineSourceResult{
		Name:       ref.Name,
		Schema:     ref.Schema,
		Kind:       kind,
		Definition: def,
	}, nil
}

func detectRoutineKind(ctx context.Context, db *sql.DB, ref RoutineRef) (string, error) {
	typ, err := objectSysType(ctx, db, ref)
	if err != nil {
		return "", err
	}
	return KindFromSysType(typ), nil
}

func objectSysType(ctx context.Context, db *sql.DB, ref RoutineRef) (string, error) {
	const q = `SELECT type FROM sys.objects WHERE object_id = OBJECT_ID(@p1)`
	var typ sql.NullString
	if err := db.QueryRowContext(ctx, q, objectIDArg(ref.Schema, ref.Name)).Scan(&typ); err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", fmt.Errorf("sqlserver: routine type: %w", err)
	}
	return strings.TrimSpace(typ.String), nil
}

func sequenceDDL(ctx context.Context, db *sql.DB, ref RelationRef) (string, error) {
	const q = `
SELECT
  TYPE_NAME(s.user_type_id),
  CONVERT(varchar(64), s.start_value),
  CONVERT(varchar(64), s.increment),
  CONVERT(varchar(64), s.minimum_value),
  CONVERT(varchar(64), s.maximum_value),
  s.is_cycling,
  s.is_cached,
  s.cache_size
FROM sys.sequences s
WHERE s.object_id = OBJECT_ID(@p1)`
	var (
		typ, start, incr, minv, maxv sql.NullString
		cycling, cached              bool
		cacheSize                    sql.NullInt64
	)
	err := db.QueryRowContext(ctx, q, objectIDArg(ref.Schema, ref.Name)).Scan(
		&typ, &start, &incr, &minv, &maxv, &cycling, &cached, &cacheSize,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", fmt.Errorf("sqlserver: sequence: %w", err)
	}
	return AssembleSequenceDDL(ref, SequenceInfo{
		DataType:  strings.TrimSpace(typ.String),
		Start:     strings.TrimSpace(start.String),
		Increment: strings.TrimSpace(incr.String),
		MinValue:  strings.TrimSpace(minv.String),
		MaxValue:  strings.TrimSpace(maxv.String),
		Cycle:     cycling,
		Cached:    cached,
		CacheSize: cacheSize.Int64,
	}), nil
}

// SequenceInfo 是拼装 CREATE SEQUENCE 的字段。
type SequenceInfo struct {
	DataType  string
	Start     string
	Increment string
	MinValue  string
	MaxValue  string
	Cycle     bool
	Cached    bool
	CacheSize int64
}

// AssembleSequenceDDL 拼装 CREATE SEQUENCE（供单测）。
func AssembleSequenceDDL(ref RelationRef, info SequenceInfo) string {
	var b strings.Builder
	b.WriteString("CREATE SEQUENCE ")
	b.WriteString(qualifiedName(ref.Schema, ref.Name))
	b.WriteByte('\n')
	if info.DataType != "" {
		b.WriteString("  AS ")
		b.WriteString(info.DataType)
		b.WriteByte('\n')
	}
	if info.Start != "" {
		b.WriteString("  START WITH ")
		b.WriteString(info.Start)
		b.WriteByte('\n')
	}
	if info.Increment != "" {
		b.WriteString("  INCREMENT BY ")
		b.WriteString(info.Increment)
		b.WriteByte('\n')
	}
	if info.MinValue != "" {
		b.WriteString("  MINVALUE ")
		b.WriteString(info.MinValue)
		b.WriteByte('\n')
	}
	if info.MaxValue != "" {
		b.WriteString("  MAXVALUE ")
		b.WriteString(info.MaxValue)
		b.WriteByte('\n')
	}
	if info.Cycle {
		b.WriteString("  CYCLE\n")
	} else {
		b.WriteString("  NO CYCLE\n")
	}
	if info.Cached && info.CacheSize > 0 {
		b.WriteString("  CACHE ")
		b.WriteString(fmt.Sprintf("%d", info.CacheSize))
		b.WriteByte('\n')
	} else {
		b.WriteString("  NO CACHE\n")
	}
	return b.String()
}

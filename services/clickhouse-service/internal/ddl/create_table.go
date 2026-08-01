package ddl

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// CreateTableColumn 是可视化新建表的列定义。
type CreateTableColumn struct {
	Name     string  `json:"name"`
	DataType string  `json:"dataType"`
	Default  *string `json:"default,omitempty"`
	Comment  string  `json:"comment,omitempty"`
	// Codec 列级压缩，如 ZSTD / LZ4 / Delta, ZSTD。
	Codec string `json:"codec,omitempty"`
}

// CreateTableIndex 是可视化新建表的数据跳过索引。
type CreateTableIndex struct {
	Name        string `json:"name"`
	Expression  string `json:"expression"`
	Type        string `json:"type"`
	Granularity int    `json:"granularity,omitempty"`
}

// CreateTableParams 是新建表预览 / 应用入参。
type CreateTableParams struct {
	Database    string              `json:"database"`
	Name        string              `json:"name"`
	Columns     []CreateTableColumn `json:"columns"`
	Indexes     []CreateTableIndex  `json:"indexes,omitempty"`
	Engine      string              `json:"engine,omitempty"`
	OrderBy     string              `json:"orderBy"`
	PartitionBy string              `json:"partitionBy,omitempty"`
	PrimaryKey  string              `json:"primaryKey,omitempty"`
	SampleBy    string              `json:"sampleBy,omitempty"`
	TTL         string              `json:"ttl,omitempty"`
	Settings    string              `json:"settings,omitempty"`
	Comment     string              `json:"comment,omitempty"`
	Cluster     string              `json:"cluster,omitempty"`
}

// CreateTableResult 是新建表预览 / 应用结果。
type CreateTableResult struct {
	SQL        []string `json:"sql"`
	DurationMS int64    `json:"durationMs,omitempty"`
}

// BuildCreateTableSQL 生成 ClickHouse CREATE TABLE。
func BuildCreateTableSQL(p CreateTableParams) ([]string, error) {
	if err := requireDatabaseName(p.Database, p.Name); err != nil {
		return nil, err
	}
	if len(p.Columns) == 0 {
		return nil, fmt.Errorf("clickhouse: at least one column required")
	}
	orderBy := strings.TrimSpace(p.OrderBy)
	if orderBy == "" {
		return nil, fmt.Errorf("clickhouse: orderBy required")
	}
	if err := validateKeyExpression(orderBy); err != nil {
		return nil, fmt.Errorf("clickhouse: orderBy: %w", err)
	}
	engine := strings.TrimSpace(p.Engine)
	if engine == "" {
		engine = "MergeTree"
	}
	if strings.ContainsAny(engine, ";\x00") {
		return nil, fmt.Errorf("clickhouse: invalid engine")
	}

	rel, err := qualified(p.Database, p.Name)
	if err != nil {
		return nil, err
	}
	onCluster, err := onClusterClause(p.Cluster)
	if err != nil {
		return nil, err
	}

	seen := make(map[string]struct{}, len(p.Columns))
	lines := make([]string, 0, len(p.Columns))
	for i, col := range p.Columns {
		name := strings.TrimSpace(col.Name)
		if name == "" {
			return nil, fmt.Errorf("clickhouse: columns[%d].name required", i)
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			return nil, fmt.Errorf("clickhouse: duplicate column %q", name)
		}
		seen[key] = struct{}{}
		dt := strings.TrimSpace(col.DataType)
		if err := validateDataType(dt); err != nil {
			return nil, fmt.Errorf("clickhouse: columns[%d]: %w", i, err)
		}
		qn, err := quoteIdent(name)
		if err != nil {
			return nil, err
		}
		var b strings.Builder
		b.WriteString("  ")
		b.WriteString(qn)
		b.WriteByte(' ')
		b.WriteString(dt)
		if col.Default != nil {
			if def := strings.TrimSpace(*col.Default); def != "" {
				b.WriteString(" DEFAULT ")
				b.WriteString(def)
			}
		}
		if codec := strings.TrimSpace(col.Codec); codec != "" {
			if err := validateCodec(codec); err != nil {
				return nil, fmt.Errorf("clickhouse: columns[%d]: %w", i, err)
			}
			b.WriteString(" CODEC(")
			b.WriteString(codec)
			b.WriteByte(')')
		}
		if c := strings.TrimSpace(col.Comment); c != "" {
			b.WriteString(" COMMENT '")
			b.WriteString(escapeStringLiteral(c))
			b.WriteByte('\'')
		}
		lines = append(lines, b.String())
	}

	for i, idx := range p.Indexes {
		name := strings.TrimSpace(idx.Name)
		expr := strings.TrimSpace(idx.Expression)
		typ := strings.TrimSpace(idx.Type)
		if name == "" {
			return nil, fmt.Errorf("clickhouse: indexes[%d].name required", i)
		}
		if err := validateKeyExpression(expr); err != nil {
			return nil, fmt.Errorf("clickhouse: indexes[%d]: %w", i, err)
		}
		if typ == "" || strings.ContainsAny(typ, ";\x00 ") {
			return nil, fmt.Errorf("clickhouse: indexes[%d].type required", i)
		}
		qn, err := quoteIdent(name)
		if err != nil {
			return nil, err
		}
		var b strings.Builder
		b.WriteString("  INDEX ")
		b.WriteString(qn)
		b.WriteByte(' ')
		b.WriteString(expr)
		b.WriteString(" TYPE ")
		b.WriteString(typ)
		if idx.Granularity > 0 {
			b.WriteString(fmt.Sprintf(" GRANULARITY %d", idx.Granularity))
		}
		lines = append(lines, b.String())
	}

	var sql strings.Builder
	sql.WriteString("CREATE TABLE ")
	sql.WriteString(rel)
	sql.WriteString(onCluster)
	sql.WriteString(" (\n")
	sql.WriteString(strings.Join(lines, ",\n"))
	sql.WriteString("\n) ENGINE = ")
	sql.WriteString(engine)
	sql.WriteString("\nORDER BY ")
	sql.WriteString(orderBy)
	if pb := strings.TrimSpace(p.PartitionBy); pb != "" {
		if err := validateKeyExpression(pb); err != nil {
			return nil, fmt.Errorf("clickhouse: partitionBy: %w", err)
		}
		sql.WriteString("\nPARTITION BY ")
		sql.WriteString(pb)
	}
	if pk := strings.TrimSpace(p.PrimaryKey); pk != "" {
		if err := validateKeyExpression(pk); err != nil {
			return nil, fmt.Errorf("clickhouse: primaryKey: %w", err)
		}
		sql.WriteString("\nPRIMARY KEY ")
		sql.WriteString(pk)
	}
	if sample := strings.TrimSpace(p.SampleBy); sample != "" {
		if err := validateKeyExpression(sample); err != nil {
			return nil, fmt.Errorf("clickhouse: sampleBy: %w", err)
		}
		sql.WriteString("\nSAMPLE BY ")
		sql.WriteString(sample)
	}
	if ttl := strings.TrimSpace(p.TTL); ttl != "" {
		if err := validateKeyExpression(ttl); err != nil {
			return nil, fmt.Errorf("clickhouse: ttl: %w", err)
		}
		sql.WriteString("\nTTL ")
		sql.WriteString(ttl)
	}
	if settings := strings.TrimSpace(p.Settings); settings != "" {
		if err := validateSettings(settings); err != nil {
			return nil, fmt.Errorf("clickhouse: settings: %w", err)
		}
		sql.WriteString("\nSETTINGS ")
		sql.WriteString(settings)
	}
	if c := strings.TrimSpace(p.Comment); c != "" {
		sql.WriteString("\nCOMMENT '")
		sql.WriteString(escapeStringLiteral(c))
		sql.WriteByte('\'')
	}

	return []string{sql.String()}, nil
}

func validateCodec(codec string) error {
	c := strings.TrimSpace(codec)
	if c == "" {
		return fmt.Errorf("codec required")
	}
	if strings.ContainsAny(c, ";\x00") {
		return fmt.Errorf("invalid codec")
	}
	return nil
}

func validateSettings(settings string) error {
	s := strings.TrimSpace(settings)
	if s == "" {
		return fmt.Errorf("settings required")
	}
	if strings.ContainsAny(s, ";\x00") {
		return fmt.Errorf("invalid settings")
	}
	return nil
}

// PreviewCreateTable 仅生成 SQL。
func PreviewCreateTable(p CreateTableParams) (*CreateTableResult, error) {
	sqls, err := BuildCreateTableSQL(p)
	if err != nil {
		return nil, err
	}
	return &CreateTableResult{SQL: sqls}, nil
}

// ApplyCreateTable 生成并执行 CREATE TABLE。
func ApplyCreateTable(ctx context.Context, db *sql.DB, p CreateTableParams) (*CreateTableResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: createTable: nil db")
	}
	sqls, err := BuildCreateTableSQL(p)
	if err != nil {
		return nil, err
	}
	start := time.Now()
	for _, q := range sqls {
		if _, err := db.ExecContext(ctx, q); err != nil {
			return nil, fmt.Errorf("clickhouse: createTable: %w", err)
		}
	}
	return &CreateTableResult{
		SQL:        sqls,
		DurationMS: time.Since(start).Milliseconds(),
	}, nil
}

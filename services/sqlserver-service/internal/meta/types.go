// Package meta 提供 SQL Server 对象元数据（列、索引、DDL）。
//
// 约定（docs/32 §5.5）：
//   - 与 tree 包解耦：树保持轻量，browse / DDL 按需拉取；
//   - RelationRef 使用 Database + Schema + Name；
//   - 不做行数 / 体积统计。
package meta

import (
	"fmt"
	"strings"
)

// RelationRef 定位一张表 / 视图 / 同义词。
type RelationRef struct {
	Database string
	Schema   string
	Name     string
}

// ColumnInfo 是列元数据。
type ColumnInfo struct {
	Ordinal       int     `json:"ordinal"`
	Name          string  `json:"name"`
	DataType      string  `json:"dataType"`
	Nullable      bool    `json:"nullable"`
	Default       *string `json:"default,omitempty"`
	Comment       string  `json:"comment,omitempty"`
	AutoIncrement bool    `json:"autoIncrement,omitempty"`
	IdentitySeed  string  `json:"identitySeed,omitempty"`
	IdentityIncr  string  `json:"identityIncrement,omitempty"`
	Computed      bool    `json:"computed,omitempty"`
	ComputedDef   string  `json:"computedDefinition,omitempty"`
}

// IndexInfo 是索引元数据。
type IndexInfo struct {
	Name       string   `json:"name"`
	Unique     bool     `json:"unique"`
	Primary    bool     `json:"primary"`
	Definition string   `json:"definition"`
	Columns    []string `json:"columns,omitempty"`
	Method     string   `json:"method,omitempty"`
}

// ColumnsResult 是 meta.columns 返回。
type ColumnsResult struct {
	Columns      []ColumnInfo `json:"columns"`
	TableComment string       `json:"tableComment,omitempty"`
}

// IndexesResult 是 meta.indexes 返回。
type IndexesResult struct {
	Indexes []IndexInfo `json:"indexes"`
}

// PrimaryKeyResult 是 meta.primaryKey 返回。
type PrimaryKeyResult struct {
	Columns []string `json:"columns"`
}

// DDLResult 是 meta.ddl 返回。
type DDLResult struct {
	ObjectType string `json:"objectType"` // table | view | synonym | unknown
	DDL        string `json:"ddl"`
}

func requireRelation(ref RelationRef) error {
	if strings.TrimSpace(ref.Schema) == "" || strings.TrimSpace(ref.Name) == "" {
		return fmt.Errorf("sqlserver: schema and name required")
	}
	return nil
}

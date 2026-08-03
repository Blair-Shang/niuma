package ddl

// 列级设计操作白名单。
const (
	DesignAddColumn    = "add_column"
	DesignDropColumn   = "drop_column"
	DesignRenameColumn = "rename_column"
	DesignAlterType    = "alter_type"
	DesignSetNull      = "set_null"
	DesignSetNotNull   = "set_not_null"
	DesignSetDefault   = "set_default"
	DesignDropDefault  = "drop_default"
	DesignSetCheck     = "set_check"
	DesignSetGenerated = "set_generated"
)

// 约束 / 索引级设计操作白名单。
const (
	DesignAddPrimaryKey  = "add_primary_key"
	DesignDropPrimaryKey = "drop_primary_key"
	DesignAddIndex       = "add_index"
	DesignDropIndex      = "drop_index"
	DesignRenameIndex    = "rename_index"
	DesignAddForeignKey  = "add_foreign_key"
	DesignDropConstraint = "drop_constraint"
)

// DesignStrategy 描述变更执行路径。
const (
	StrategyAlter   = "alter"
	StrategyRebuild = "rebuild"
)

// DesignOp 是一条受控设计操作（JSON 与 MySQL/Vastbase 对齐）。
type DesignOp struct {
	Op          string   `json:"op"`
	Name        string   `json:"name"`
	NewName     string   `json:"newName,omitempty"`
	DataType    string   `json:"dataType,omitempty"`
	Default     *string  `json:"default,omitempty"`
	Nullable    *bool    `json:"nullable,omitempty"`
	Columns     []string `json:"columns,omitempty"`
	Unique      *bool    `json:"unique,omitempty"`
	RefSchema   string   `json:"refSchema,omitempty"`
	RefDatabase string   `json:"refDatabase,omitempty"` // 兼容
	RefTable    string   `json:"refTable,omitempty"`
	RefColumns  []string `json:"refColumns,omitempty"`
	OnDelete    string   `json:"onDelete,omitempty"`
	OnUpdate    string   `json:"onUpdate,omitempty"`
	AutoIncrement bool   `json:"autoIncrement,omitempty"`
	Check         string `json:"check,omitempty"`
	GeneratedExpr string `json:"generatedExpr,omitempty"`
	GeneratedType string `json:"generatedType,omitempty"` // VIRTUAL | STORED
	PartialWhere  string `json:"partialWhere,omitempty"`  // CREATE INDEX … WHERE
}

// DesignPreviewParams 预览入参。
type DesignPreviewParams struct {
	Schema   string     `json:"schema"`
	Database string     `json:"database"`
	Name     string     `json:"name"`
	Ops      []DesignOp `json:"ops"`
}

func (p DesignPreviewParams) schemaName() string {
	if p.Schema != "" {
		return schemaOrMain(p.Schema)
	}
	return schemaOrMain(p.Database)
}

// DesignPreviewResult 预览结果。
type DesignPreviewResult struct {
	SQL      []string `json:"sql"`
	Strategy string   `json:"strategy"`
	Warning  string   `json:"warning,omitempty"`
}

// DesignApplyParams 应用入参。
type DesignApplyParams struct {
	Schema   string     `json:"schema"`
	Database string     `json:"database"`
	Name     string     `json:"name"`
	Ops      []DesignOp `json:"ops"`
}

func (p DesignApplyParams) schemaName() string {
	if p.Schema != "" {
		return schemaOrMain(p.Schema)
	}
	return schemaOrMain(p.Database)
}

// DesignApplyResult 应用结果。
type DesignApplyResult struct {
	SQL        []string `json:"sql"`
	Strategy   string   `json:"strategy"`
	Warning    string   `json:"warning,omitempty"`
	DurationMS int64    `json:"durationMs"`
}

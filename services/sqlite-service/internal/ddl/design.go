package ddl

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"niuma/services/sqlite-service/internal/meta"
)

// requiresRebuild 判断该操作是否无法用原生 ALTER 完成。
func requiresRebuild(op DesignOp) bool {
	switch op.Op {
	case DesignAlterType, DesignSetNull, DesignSetNotNull, DesignSetDefault, DesignDropDefault,
		DesignAddPrimaryKey, DesignDropPrimaryKey, DesignAddForeignKey, DesignDropConstraint,
		DesignRenameIndex, DesignSetCheck, DesignSetGenerated:
		return true
	case DesignAddColumn:
		// GENERATED / 复杂 CHECK 走重建更稳妥（各 SQLite 版本 ADD COLUMN 能力不一）
		if strings.TrimSpace(op.GeneratedExpr) != "" || strings.TrimSpace(op.GeneratedType) != "" {
			return true
		}
		if strings.TrimSpace(op.Check) != "" {
			return true
		}
		return false
	default:
		return false
	}
}

// PreviewDesign 根据 ops 生成 ALTER 或重建表脚本。
// 需要 DB 以读取当前表结构（重建路径）；纯原生 ALTER 时可不读结构，但仍尽量读取以校验。
func PreviewDesign(ctx context.Context, db *sql.DB, params DesignPreviewParams) (*DesignPreviewResult, error) {
	schema := params.schemaName()
	if err := requireSchemaTable(schema, params.Name); err != nil {
		return nil, err
	}
	if len(params.Ops) == 0 {
		return &DesignPreviewResult{SQL: []string{}, Strategy: StrategyAlter}, nil
	}

	needRebuild := false
	for _, op := range params.Ops {
		if requiresRebuild(op) {
			needRebuild = true
			break
		}
	}

	if !needRebuild {
		sqls, err := buildNativeAlterSQL(schema, params.Name, params.Ops)
		if err != nil {
			return nil, err
		}
		return &DesignPreviewResult{SQL: sqls, Strategy: StrategyAlter}, nil
	}

	sqls, err := buildRebuildSQL(ctx, db, schema, params.Name, params.Ops)
	if err != nil {
		return nil, err
	}
	return &DesignPreviewResult{
		SQL:      sqls,
		Strategy: StrategyRebuild,
		Warning:  "SQLite 不支持部分 ALTER；将通过重建表应用变更（数据会拷贝到新表）",
	}, nil
}

// ApplyDesign 在事务中执行预览 SQL。
func ApplyDesign(ctx context.Context, db *sql.DB, params DesignApplyParams) (*DesignApplyResult, error) {
	preview, err := PreviewDesign(ctx, db, DesignPreviewParams{
		Schema:   params.schemaName(),
		Name:     params.Name,
		Ops:      params.Ops,
	})
	if err != nil {
		return nil, err
	}
	if len(preview.SQL) == 0 {
		return nil, fmt.Errorf("sqlite: no design ops")
	}

	start := time.Now()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("sqlite: begin design tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, "PRAGMA foreign_keys=OFF"); err != nil {
		return nil, err
	}
	for i, s := range preview.SQL {
		if _, err := tx.ExecContext(ctx, s); err != nil {
			return nil, fmt.Errorf("sqlite: design apply failed at statement %d/%d: %w\nSQL: %s",
				i+1, len(preview.SQL), err, s)
		}
	}
	if _, err := tx.ExecContext(ctx, "PRAGMA foreign_keys=ON"); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("sqlite: commit design tx: %w", err)
	}
	return &DesignApplyResult{
		SQL:        preview.SQL,
		Strategy:   preview.Strategy,
		Warning:    preview.Warning,
		DurationMS: time.Since(start).Milliseconds(),
	}, nil
}

func buildNativeAlterSQL(schema, table string, ops []DesignOp) ([]string, error) {
	rel := qualified(schema, table)
	out := make([]string, 0, len(ops))
	for _, op := range ops {
		switch op.Op {
		case DesignAddColumn:
			s, err := buildAddColumn(rel, op)
			if err != nil {
				return nil, err
			}
			out = append(out, s)
		case DesignDropColumn:
			name := strings.TrimSpace(op.Name)
			if name == "" {
				return nil, fmt.Errorf("sqlite: drop_column requires name")
			}
			out = append(out, fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", rel, quoteIdent(name)))
		case DesignRenameColumn:
			name := strings.TrimSpace(op.Name)
			if name == "" {
				return nil, fmt.Errorf("sqlite: rename_column requires name")
			}
			if err := requireNewName(op.NewName); err != nil {
				return nil, err
			}
			out = append(out, fmt.Sprintf(
				"ALTER TABLE %s RENAME COLUMN %s TO %s",
				rel, quoteIdent(name), quoteIdent(strings.TrimSpace(op.NewName)),
			))
		case DesignAddIndex:
			s, err := buildCreateIndex(schema, table, op)
			if err != nil {
				return nil, err
			}
			out = append(out, s)
		case DesignDropIndex:
			name := strings.TrimSpace(op.Name)
			if name == "" {
				return nil, fmt.Errorf("sqlite: drop_index requires name")
			}
			out = append(out, fmt.Sprintf("DROP INDEX IF EXISTS %s.%s", quoteIdent(schema), quoteIdent(name)))
		default:
			return nil, fmt.Errorf("sqlite: op %q requires table rebuild", op.Op)
		}
	}
	return out, nil
}

func buildAddColumn(rel string, op DesignOp) (string, error) {
	name := strings.TrimSpace(op.Name)
	if name == "" {
		return "", fmt.Errorf("sqlite: add_column requires name")
	}
	if err := validateDataType(op.DataType); err != nil {
		return "", err
	}
	nullable := op.Nullable == nil || *op.Nullable
	var b strings.Builder
	b.WriteString("ALTER TABLE ")
	b.WriteString(rel)
	b.WriteString(" ADD COLUMN ")
	b.WriteString(quoteIdent(name))
	b.WriteByte(' ')
	b.WriteString(strings.TrimSpace(op.DataType))
	if err := appendColumnConstraints(
		&b, nullable, op.Default, op.Check, op.GeneratedExpr, op.GeneratedType, false,
	); err != nil {
		return "", err
	}
	return b.String(), nil
}

func buildCreateIndex(schema, table string, op DesignOp) (string, error) {
	name := strings.TrimSpace(op.Name)
	if name == "" {
		return "", fmt.Errorf("sqlite: add_index requires name")
	}
	cols, err := quoteIdentList(op.Columns)
	if err != nil {
		return "", err
	}
	unique := ""
	if op.Unique != nil && *op.Unique {
		unique = "UNIQUE "
	}
	return fmt.Sprintf(
		"CREATE %sINDEX IF NOT EXISTS %s ON %s (%s)",
		unique, quoteIdent(name), qualified(schema, table), cols,
	), nil
}

type colState struct {
	Name           string
	DataType       string
	Nullable       bool
	Default        string
	PrimaryKey     bool
	AutoIncrement  bool
	Check          string
	GeneratedExpr  string
	GeneratedType  string // VIRTUAL | STORED
	SourceName     string // 用于 INSERT 映射的原列名（重命名前）
	Dropped        bool
}

type idxState struct {
	Name    string
	Columns []string
	Unique  bool
	Dropped bool
}

type fkState struct {
	ID         int
	Name       string
	Columns    []string
	RefSchema  string
	RefTable   string
	RefColumns []string
	OnDelete   string
	OnUpdate   string
	Dropped    bool
}

func buildRebuildSQL(ctx context.Context, db *sql.DB, schema, table string, ops []DesignOp) ([]string, error) {
	if db == nil {
		return nil, fmt.Errorf("sqlite: rebuild requires db")
	}
	colsMeta, err := meta.ListColumns(ctx, db, schema, table)
	if err != nil {
		return nil, err
	}
	idxMeta, err := meta.ListIndexes(ctx, db, schema, table)
	if err != nil {
		return nil, err
	}
	fkMeta, err := meta.ListForeignKeys(ctx, db, schema, table)
	if err != nil {
		return nil, err
	}

	cols := make([]colState, 0, len(colsMeta.Columns))
	for _, c := range colsMeta.Columns {
		// hidden=1 为系统隐藏列；2/3 为 GENERATED，重建时必须保留
		if c.Hidden && c.GeneratedType == "" {
			continue
		}
		cols = append(cols, colState{
			Name:          c.Name,
			DataType:      c.DataType,
			Nullable:      c.Nullable,
			Default:       c.Default,
			PrimaryKey:    c.PrimaryKey,
			Check:         c.Check,
			GeneratedExpr: c.GeneratedExpr,
			GeneratedType: c.GeneratedType,
			SourceName:    c.Name,
		})
	}
	// 探测 AUTOINCREMENT：单 INTEGER PK 且 sqlite_sequence 中有该表
	detectAutoIncrement(ctx, db, schema, table, cols)

	indexes := make([]idxState, 0, len(idxMeta.Indexes))
	for _, idx := range idxMeta.Indexes {
		if strings.EqualFold(idx.Origin, "pk") {
			continue // 主键由列状态表达
		}
		var names []string
		for _, c := range idx.Columns {
			names = append(names, c.Name)
		}
		indexes = append(indexes, idxState{Name: idx.Name, Columns: names, Unique: idx.Unique})
	}

	fks := groupForeignKeys(schema, fkMeta.ForeignKeys)

	if err := applyOpsInMemory(&cols, &indexes, &fks, ops); err != nil {
		return nil, err
	}

	aliveCols := make([]colState, 0, len(cols))
	for _, c := range cols {
		if !c.Dropped {
			aliveCols = append(aliveCols, c)
		}
	}
	if len(aliveCols) == 0 {
		return nil, fmt.Errorf("sqlite: rebuild would leave no columns")
	}

	tmpName := "__niuma_rebuild_" + table
	createParams := CreateTableParams{
		Schema: schema,
		Name:   tmpName,
	}
	for _, c := range aliveCols {
		col := CreateTableColumn{
			Name:          c.Name,
			DataType:      c.DataType,
			Nullable:      c.Nullable,
			PrimaryKey:    c.PrimaryKey,
			AutoIncrement: c.AutoIncrement,
			Check:         c.Check,
			GeneratedExpr: c.GeneratedExpr,
			GeneratedType: c.GeneratedType,
		}
		if c.Default != "" && c.GeneratedType == "" {
			d := c.Default
			col.Default = &d
		}
		createParams.Columns = append(createParams.Columns, col)
	}
	for _, fk := range fks {
		if fk.Dropped {
			continue
		}
		createParams.ForeignKeys = append(createParams.ForeignKeys, CreateTableForeignKey{
			Name:       fk.Name,
			Columns:    fk.Columns,
			RefSchema:  fk.RefSchema,
			RefTable:   fk.RefTable,
			RefColumns: fk.RefColumns,
			OnDelete:   fk.OnDelete,
			OnUpdate:   fk.OnUpdate,
		})
	}

	createSQL, err := BuildCreateTableSQL(createParams)
	if err != nil {
		return nil, err
	}

	// INSERT 映射：新列 ← 源列；GENERATED 列由引擎计算，不写入 INSERT 列表
	var insertNew, insertSrc []string
	for _, c := range aliveCols {
		if c.GeneratedType != "" {
			continue
		}
		insertNew = append(insertNew, quoteIdent(c.Name))
		if c.SourceName != "" {
			insertSrc = append(insertSrc, quoteIdent(c.SourceName))
		} else {
			insertSrc = append(insertSrc, "NULL")
		}
	}

	out := make([]string, 0, 8+len(indexes))
	out = append(out, createSQL[0])
	if len(insertNew) > 0 {
		out = append(out, fmt.Sprintf(
			"INSERT INTO %s (%s) SELECT %s FROM %s",
			qualified(schema, tmpName),
			strings.Join(insertNew, ", "),
			strings.Join(insertSrc, ", "),
			qualified(schema, table),
		))
	}
	out = append(out, fmt.Sprintf("DROP TABLE %s", qualified(schema, table)))
	out = append(out, fmt.Sprintf("ALTER TABLE %s RENAME TO %s", qualified(schema, tmpName), quoteIdent(table)))

	// 重建非 PK 索引（CREATE TABLE 后）
	for _, idx := range indexes {
		if idx.Dropped {
			continue
		}
		// 过滤已删除列
		var okCols []string
		aliveSet := make(map[string]struct{}, len(aliveCols))
		for _, c := range aliveCols {
			aliveSet[strings.ToLower(c.Name)] = struct{}{}
		}
		for _, n := range idx.Columns {
			if _, ok := aliveSet[strings.ToLower(n)]; ok {
				okCols = append(okCols, n)
			}
		}
		if len(okCols) == 0 {
			continue
		}
		s, err := buildCreateIndex(schema, table, DesignOp{
			Name:    idx.Name,
			Columns: okCols,
			Unique:  boolPtr(idx.Unique),
		})
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	// createSQL 中可能还有 CREATE INDEX（我们建临时表时未带 indexes）——上面已单独处理
	return out, nil
}

func boolPtr(v bool) *bool { return &v }

func detectAutoIncrement(ctx context.Context, db *sql.DB, schema, table string, cols []colState) {
	var pkCount int
	var pkIdx = -1
	for i, c := range cols {
		if c.PrimaryKey {
			pkCount++
			pkIdx = i
		}
	}
	if pkCount != 1 || pkIdx < 0 || !isIntegerAffinity(cols[pkIdx].DataType) {
		return
	}
	var n int
	q := fmt.Sprintf(`SELECT COUNT(*) FROM %s.sqlite_sequence WHERE name = ?`, quoteIdent(schema))
	err := db.QueryRowContext(ctx, q, table).Scan(&n)
	if err != nil {
		// sqlite_sequence 可能不存在；再看 DDL
		ddlRes, derr := meta.GetDDL(ctx, db, schema, table, "table")
		if derr == nil && strings.Contains(strings.ToUpper(ddlRes.DDL), "AUTOINCREMENT") {
			cols[pkIdx].AutoIncrement = true
		}
		return
	}
	if n > 0 {
		cols[pkIdx].AutoIncrement = true
		return
	}
	ddlRes, derr := meta.GetDDL(ctx, db, schema, table, "table")
	if derr == nil && strings.Contains(strings.ToUpper(ddlRes.DDL), "AUTOINCREMENT") {
		cols[pkIdx].AutoIncrement = true
	}
}

func groupForeignKeys(schema string, list []meta.ForeignKeyInfo) []fkState {
	byID := map[int]*fkState{}
	var order []int
	for _, fk := range list {
		st, ok := byID[fk.ID]
		if !ok {
			st = &fkState{
				ID:        fk.ID,
				Name:      fmt.Sprintf("fk_%d", fk.ID),
				RefSchema: schema,
				RefTable:  fk.ReferencedTable,
				OnDelete:  fk.OnDelete,
				OnUpdate:  fk.OnUpdate,
			}
			byID[fk.ID] = st
			order = append(order, fk.ID)
		}
		st.Columns = append(st.Columns, fk.FromColumn)
		st.RefColumns = append(st.RefColumns, fk.ToColumn)
	}
	out := make([]fkState, 0, len(order))
	for _, id := range order {
		out = append(out, *byID[id])
	}
	return out
}

func applyOpsInMemory(cols *[]colState, indexes *[]idxState, fks *[]fkState, ops []DesignOp) error {
	findCol := func(name string) int {
		for i, c := range *cols {
			if !c.Dropped && strings.EqualFold(c.Name, name) {
				return i
			}
		}
		return -1
	}
	findIdx := func(name string) int {
		for i, idx := range *indexes {
			if !idx.Dropped && strings.EqualFold(idx.Name, name) {
				return i
			}
		}
		return -1
	}

	for _, op := range ops {
		switch op.Op {
		case DesignAddColumn:
			name := strings.TrimSpace(op.Name)
			if name == "" {
				return fmt.Errorf("sqlite: add_column requires name")
			}
			if findCol(name) >= 0 {
				return fmt.Errorf("sqlite: column %q already exists", name)
			}
			if err := validateDataType(op.DataType); err != nil {
				return err
			}
			c := colState{
				Name:          name,
				DataType:      strings.TrimSpace(op.DataType),
				Nullable:      op.Nullable == nil || *op.Nullable,
				Check:         strings.TrimSpace(op.Check),
				GeneratedExpr: strings.TrimSpace(op.GeneratedExpr),
				SourceName:    "", // 新列
			}
			if gt, err := NormalizeGeneratedType(op.GeneratedType); err != nil {
				return err
			} else {
				c.GeneratedType = gt
			}
			if op.Default != nil && c.GeneratedType == "" {
				c.Default = *op.Default
			}
			if op.AutoIncrement {
				c.AutoIncrement = true
				c.PrimaryKey = true
			}
			*cols = append(*cols, c)

		case DesignDropColumn:
			i := findCol(op.Name)
			if i < 0 {
				return fmt.Errorf("sqlite: column %q not found", op.Name)
			}
			(*cols)[i].Dropped = true

		case DesignRenameColumn:
			i := findCol(op.Name)
			if i < 0 {
				return fmt.Errorf("sqlite: column %q not found", op.Name)
			}
			if err := requireNewName(op.NewName); err != nil {
				return err
			}
			(*cols)[i].Name = strings.TrimSpace(op.NewName)

		case DesignAlterType:
			i := findCol(op.Name)
			if i < 0 {
				return fmt.Errorf("sqlite: column %q not found", op.Name)
			}
			if err := validateDataType(op.DataType); err != nil {
				return err
			}
			(*cols)[i].DataType = strings.TrimSpace(op.DataType)

		case DesignSetNull:
			i := findCol(op.Name)
			if i < 0 {
				return fmt.Errorf("sqlite: column %q not found", op.Name)
			}
			(*cols)[i].Nullable = true

		case DesignSetNotNull:
			i := findCol(op.Name)
			if i < 0 {
				return fmt.Errorf("sqlite: column %q not found", op.Name)
			}
			(*cols)[i].Nullable = false

		case DesignSetDefault:
			i := findCol(op.Name)
			if i < 0 {
				return fmt.Errorf("sqlite: column %q not found", op.Name)
			}
			if op.Default == nil {
				return fmt.Errorf("sqlite: set_default requires default")
			}
			(*cols)[i].Default = *op.Default

		case DesignDropDefault:
			i := findCol(op.Name)
			if i < 0 {
				return fmt.Errorf("sqlite: column %q not found", op.Name)
			}
			(*cols)[i].Default = ""

		case DesignSetCheck:
			i := findCol(op.Name)
			if i < 0 {
				return fmt.Errorf("sqlite: column %q not found", op.Name)
			}
			(*cols)[i].Check = strings.TrimSpace(op.Check)

		case DesignSetGenerated:
			i := findCol(op.Name)
			if i < 0 {
				return fmt.Errorf("sqlite: column %q not found", op.Name)
			}
			gt, err := NormalizeGeneratedType(op.GeneratedType)
			if err != nil {
				return err
			}
			expr := strings.TrimSpace(op.GeneratedExpr)
			if gt == "" {
				(*cols)[i].GeneratedType = ""
				(*cols)[i].GeneratedExpr = ""
			} else {
				if err := validateExprFragment("generatedExpr", expr); err != nil {
					return err
				}
				(*cols)[i].GeneratedType = gt
				(*cols)[i].GeneratedExpr = expr
				(*cols)[i].Default = ""
				(*cols)[i].AutoIncrement = false
			}

		case DesignAddPrimaryKey:
			for i := range *cols {
				(*cols)[i].PrimaryKey = false
				(*cols)[i].AutoIncrement = false
			}
			for _, n := range op.Columns {
				i := findCol(n)
				if i < 0 {
					return fmt.Errorf("sqlite: pk column %q not found", n)
				}
				(*cols)[i].PrimaryKey = true
			}
			if len(op.Columns) == 1 && op.AutoIncrement {
				i := findCol(op.Columns[0])
				if i >= 0 {
					(*cols)[i].AutoIncrement = true
				}
			}

		case DesignDropPrimaryKey:
			for i := range *cols {
				(*cols)[i].PrimaryKey = false
				(*cols)[i].AutoIncrement = false
			}

		case DesignAddIndex:
			*indexes = append(*indexes, idxState{
				Name:    strings.TrimSpace(op.Name),
				Columns: append([]string{}, op.Columns...),
				Unique:  op.Unique != nil && *op.Unique,
			})

		case DesignDropIndex:
			i := findIdx(op.Name)
			if i < 0 {
				return fmt.Errorf("sqlite: index %q not found", op.Name)
			}
			(*indexes)[i].Dropped = true

		case DesignRenameIndex:
			i := findIdx(op.Name)
			if i < 0 {
				return fmt.Errorf("sqlite: index %q not found", op.Name)
			}
			if err := requireNewName(op.NewName); err != nil {
				return err
			}
			(*indexes)[i].Name = strings.TrimSpace(op.NewName)

		case DesignAddForeignKey:
			refSchema := strings.TrimSpace(op.RefSchema)
			if refSchema == "" {
				refSchema = strings.TrimSpace(op.RefDatabase)
			}
			*fks = append(*fks, fkState{
				Name:       strings.TrimSpace(op.Name),
				Columns:    append([]string{}, op.Columns...),
				RefSchema:  refSchema,
				RefTable:   strings.TrimSpace(op.RefTable),
				RefColumns: append([]string{}, op.RefColumns...),
				OnDelete:   op.OnDelete,
				OnUpdate:   op.OnUpdate,
			})

		case DesignDropConstraint:
			name := strings.TrimSpace(op.Name)
			found := false
			for i := range *fks {
				if !(*fks)[i].Dropped && (strings.EqualFold((*fks)[i].Name, name) || fmt.Sprintf("fk_%d", (*fks)[i].ID) == name) {
					(*fks)[i].Dropped = true
					found = true
				}
			}
			if !found {
				// 也允许按索引名 drop
				i := findIdx(name)
				if i >= 0 {
					(*indexes)[i].Dropped = true
					found = true
				}
			}
			if !found {
				return fmt.Errorf("sqlite: constraint %q not found", name)
			}

		default:
			return fmt.Errorf("sqlite: unsupported design op %q", op.Op)
		}
	}
	return nil
}

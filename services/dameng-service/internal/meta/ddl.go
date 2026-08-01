package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

type DDLResult struct {
	ObjectType string `json:"objectType"`
	DDL        string `json:"ddl"`
}

// GetDDL 读取表/视图 DDL：按 ALL_OBJECTS 类型调用 DBMS_METADATA；表可降级为列重建。
func GetDDL(ctx context.Context, db *sql.DB, r RelationRef) (DDLResult, error) {
	schema := strings.TrimSpace(r.Schema)
	name := strings.TrimSpace(r.Name)
	if schema == "" || name == "" {
		return DDLResult{}, fmt.Errorf("dameng: schema and name required")
	}

	objType, err := detectRelationObjectType(ctx, db, schema, name)
	if err != nil {
		return DDLResult{}, err
	}

	switch objType {
	case "VIEW":
		if ddl, ok := getMetadataDDL(ctx, db, "VIEW", name, schema); ok {
			return DDLResult{ObjectType: "view", DDL: ddl}, nil
		}
		return DDLResult{}, fmt.Errorf("dameng: view ddl not found: %s.%s", schema, name)
	case "TABLE", "":
		if ddl, ok := getMetadataDDL(ctx, db, "TABLE", name, schema); ok {
			return DDLResult{ObjectType: "table", DDL: ddl}, nil
		}
		return rebuildTableDDL(ctx, db, RelationRef{Schema: schema, Name: name})
	case "PACKAGE":
		// 达梦 GET_DDL('PACKAGE') 常合并包头+包体且无 /；编辑页需两段用 / 分隔
		spec := ""
		body := ""
		if s, ok := getMetadataDDL(ctx, db, "PKG_SPEC", name, schema); ok {
			spec = s
		}
		if b, ok := getMetadataDDL(ctx, db, "PKG_BODY", name, schema); ok {
			body = b
		}
		if body == "" {
			if b, ok := getMetadataDDL(ctx, db, "PACKAGE BODY", name, schema); ok {
				body = b
			}
		}
		if spec == "" {
			raw, ok := getMetadataDDL(ctx, db, "PACKAGE", name, schema)
			if !ok {
				return DDLResult{}, fmt.Errorf("dameng: package ddl not found: %s.%s", schema, name)
			}
			var fromBody string
			spec, fromBody = splitPackageSpecBodyMeta(raw)
			if body == "" {
				body = fromBody
			}
		} else {
			s2, b2 := splitPackageSpecBodyMeta(spec)
			spec = s2
			if body == "" {
				body = b2
			}
		}
		spec = strings.TrimSpace(spec)
		body = strings.TrimSpace(body)
		if spec == "" {
			return DDLResult{}, fmt.Errorf("dameng: package ddl not found: %s.%s", schema, name)
		}
		ddl := spec
		if !strings.HasSuffix(ddl, "/") {
			ddl += "\n/"
		}
		if body != "" {
			ddl += "\n\n" + body
			if !strings.HasSuffix(strings.TrimSpace(body), "/") {
				ddl += "\n/"
			}
		}
		return DDLResult{ObjectType: "package", DDL: ddl}, nil
	case "SYNONYM":
		if ddl, ok := getMetadataDDL(ctx, db, "SYNONYM", name, schema); ok {
			return DDLResult{ObjectType: "synonym", DDL: ddl}, nil
		}
		return rebuildSynonymDDL(ctx, db, schema, name)
	default:
		// 过程/函数/触发器/同义词/序列等：仍尝试 GET_DDL，便于通用入口
		if ddl, ok := getMetadataDDL(ctx, db, objType, name, schema); ok {
			return DDLResult{ObjectType: strings.ToLower(objType), DDL: ddl}, nil
		}
		return DDLResult{}, fmt.Errorf("dameng: ddl not found for %s: %s.%s", objType, schema, name)
	}
}

func detectRelationObjectType(ctx context.Context, db *sql.DB, schema, name string) (string, error) {
	var objectType sql.NullString
	err := db.QueryRowContext(ctx, `
SELECT OBJECT_TYPE
FROM ALL_OBJECTS
WHERE OWNER = ? AND OBJECT_NAME = ?
  AND OBJECT_TYPE IN (
    'TABLE', 'VIEW', 'PROCEDURE', 'FUNCTION', 'SEQUENCE',
    'PACKAGE', 'PACKAGE BODY', 'SYNONYM', 'TRIGGER'
  )
ORDER BY CASE OBJECT_TYPE
  WHEN 'TABLE' THEN 1
  WHEN 'VIEW' THEN 2
  WHEN 'SEQUENCE' THEN 3
  WHEN 'PROCEDURE' THEN 4
  WHEN 'FUNCTION' THEN 5
  WHEN 'PACKAGE' THEN 6
  WHEN 'SYNONYM' THEN 7
  WHEN 'TRIGGER' THEN 8
  ELSE 9
END
FETCH FIRST 1 ROWS ONLY`, schema, name).Scan(&objectType)
	if err == nil && objectType.Valid {
		return strings.ToUpper(strings.TrimSpace(objectType.String)), nil
	}
	if err != nil && err != sql.ErrNoRows {
		// 部分版本无 FETCH FIRST：忽略探测错误，交给后续 GET_DDL/重建
		// 仍尝试 ALL_SYNONYMS 兜底
	}
	// 达梦同义词：ALL_OBJECTS 常无；查 SYSOBJECTS / ALL_SYNONYMS
	if synonymExists(ctx, db, schema, name) {
		return "SYNONYM", nil
	}
	if err == sql.ErrNoRows || err == nil {
		return "", nil
	}
	return "", nil
}

func synonymExists(ctx context.Context, db *sql.DB, schema, name string) bool {
	var synName sql.NullString
	err := db.QueryRowContext(ctx, `
SELECT o.NAME
FROM SYSOBJECTS o
INNER JOIN SYSOBJECTS s ON o.SCHID = s.ID AND s.TYPE$ = 'SCH'
WHERE UPPER(s.NAME) = UPPER(?)
  AND o.TYPE$ = 'SCHOBJ'
  AND o.SUBTYPE$ = 'SYNOM'
  AND o.NAME = ?`, schema, name).Scan(&synName)
	if err == nil && synName.Valid {
		return true
	}
	// 大小写不敏感再试一次
	err = db.QueryRowContext(ctx, `
SELECT o.NAME
FROM SYSOBJECTS o
INNER JOIN SYSOBJECTS s ON o.SCHID = s.ID AND s.TYPE$ = 'SCH'
WHERE UPPER(s.NAME) = UPPER(?)
  AND o.TYPE$ = 'SCHOBJ'
  AND o.SUBTYPE$ = 'SYNOM'
  AND UPPER(o.NAME) = UPPER(?)`, schema, name).Scan(&synName)
	if err == nil && synName.Valid {
		return true
	}
	err = db.QueryRowContext(ctx,
		`SELECT SYNONYM_NAME FROM ALL_SYNONYMS WHERE UPPER(OWNER) = UPPER(?) AND SYNONYM_NAME = ?`,
		schema, name,
	).Scan(&synName)
	return err == nil && synName.Valid
}

// rebuildSynonymDDL 从字典拼 CREATE 语句（GET_DDL 不可用时兜底）。
func rebuildSynonymDDL(ctx context.Context, db *sql.DB, schema, name string) (DDLResult, error) {
	q := func(s string) string {
		return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
	}
	var owner, synName, tableOwner, tableName sql.NullString
	var dbLink sql.NullString
	err := db.QueryRowContext(ctx, `
SELECT OWNER, SYNONYM_NAME, TABLE_OWNER, TABLE_NAME, DB_LINK
FROM ALL_SYNONYMS
WHERE UPPER(OWNER) = UPPER(?) AND (SYNONYM_NAME = ? OR UPPER(SYNONYM_NAME) = UPPER(?))`,
		schema, name, name,
	).Scan(&owner, &synName, &tableOwner, &tableName, &dbLink)
	if err != nil {
		// ALL_SYNONYMS 不可用时至少保留可执行骨架（目标需用户改）
		if synonymExists(ctx, db, schema, name) {
			ddl := fmt.Sprintf(
				"CREATE OR REPLACE SYNONYM %s.%s FOR %s.%s;",
				q(schema), q(name), q(schema), q("target_object"),
			)
			return DDLResult{ObjectType: "synonym", DDL: ddl}, nil
		}
		if err == sql.ErrNoRows {
			return DDLResult{}, fmt.Errorf("dameng: synonym not found: %s.%s", schema, name)
		}
		return DDLResult{}, fmt.Errorf("dameng: load synonym: %w", err)
	}
	own := strings.TrimSpace(owner.String)
	sn := strings.TrimSpace(synName.String)
	to := strings.TrimSpace(tableOwner.String)
	tn := strings.TrimSpace(tableName.String)
	if own == "" || sn == "" || tn == "" {
		return DDLResult{}, fmt.Errorf("dameng: synonym incomplete: %s.%s", schema, name)
	}
	target := q(tn)
	if to != "" {
		target = q(to) + "." + target
	}
	if dbLink.Valid && strings.TrimSpace(dbLink.String) != "" {
		target += "@" + strings.TrimSpace(dbLink.String)
	}
	ddl := fmt.Sprintf("CREATE OR REPLACE SYNONYM %s.%s FOR %s;", q(own), q(sn), target)
	return DDLResult{ObjectType: "synonym", DDL: ddl}, nil
}

func rebuildTableDDL(ctx context.Context, db *sql.DB, r RelationRef) (DDLResult, error) {
	cols, e := ListColumns(ctx, db, r)
	if e != nil {
		return DDLResult{}, e
	}
	parts := make([]string, 0, len(cols.Columns))
	for _, c := range cols.Columns {
		dt := c.DataType
		if c.AutoIncrement && !strings.Contains(strings.ToUpper(dt), "IDENTITY") {
			dt = strings.TrimSpace(dt) + " IDENTITY(1,1)"
		}
		n := `"` + strings.ReplaceAll(c.Name, `"`, `""`) + `" ` + dt
		if !c.Nullable {
			n += " NOT NULL"
		}
		if c.Default != nil && *c.Default != "" && !c.AutoIncrement {
			n += " DEFAULT " + *c.Default
		}
		parts = append(parts, n)
	}
	if len(parts) == 0 {
		return DDLResult{}, fmt.Errorf("dameng: table not found: %s.%s", r.Schema, r.Name)
	}
	qSchema := `"` + strings.ReplaceAll(r.Schema, `"`, `""`) + `"`
	qName := `"` + strings.ReplaceAll(r.Name, `"`, `""`) + `"`
	return DDLResult{
		ObjectType: "table",
		DDL:        "CREATE TABLE " + qSchema + "." + qName + " (\n  " + strings.Join(parts, ",\n  ") + "\n)",
	}, nil
}

// GetMetadataDDL 按已知 OBJECT_TYPE 调用 DBMS_METADATA.GET_DDL。
// 用于转储等已枚举类型场景（可区分 PACKAGE 与 PACKAGE BODY）。
func GetMetadataDDL(ctx context.Context, db *sql.DB, objectType, schema, name string) (string, error) {
	schema = strings.TrimSpace(schema)
	name = strings.TrimSpace(name)
	objectType = strings.ToUpper(strings.TrimSpace(objectType))
	if schema == "" || name == "" || objectType == "" {
		return "", fmt.Errorf("dameng: schema, name and objectType required")
	}
	if ddl, ok := getMetadataDDL(ctx, db, objectType, name, schema); ok {
		return ddl, nil
	}
	if objectType == "TABLE" {
		res, err := rebuildTableDDL(ctx, db, RelationRef{Schema: schema, Name: name})
		if err != nil {
			return "", err
		}
		return res.DDL, nil
	}
	return "", fmt.Errorf("dameng: ddl not found for %s: %s.%s", objectType, schema, name)
}

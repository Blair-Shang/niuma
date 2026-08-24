package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// RoutineParameter 是 sys.parameters 中的形参 / 函数返回值。
type RoutineParameter struct {
	// Ordinal 从 1 起为调用实参顺序；函数返回值为 0。
	Ordinal int `json:"ordinal"`
	// Name 形参名（含 @）；返回值可为空。
	Name string `json:"name"`
	// Mode：IN | OUTPUT；函数返回值为空字符串。
	Mode string `json:"mode"`
	// DataType 基础类型名（如 int / nvarchar）。
	DataType string `json:"dataType"`
	// DtdIdentifier 完整类型声明（如 nvarchar(64) / [dbo].[MyTableType]）。
	DtdIdentifier string `json:"dtdIdentifier"`
	// IsReturn 是否为函数返回值（parameter_id = 0）。
	IsReturn bool `json:"isReturn"`
	// HasDefault 是否声明了默认值（加密对象可能仍为 false）。
	HasDefault bool `json:"hasDefault,omitempty"`
	// IsTableType 是否为表值参数。
	IsTableType bool `json:"isTableType,omitempty"`
	// IsCursor 是否为游标参数。
	IsCursor bool `json:"isCursor,omitempty"`
}

// RoutineParametersResult 是 meta.routineParameters 返回。
type RoutineParametersResult struct {
	Name   string `json:"name"`
	Schema string `json:"schema,omitempty"`
	Kind   string `json:"kind"`
	// SysType 是 sys.objects.type（P / FN / IF / TF 等）。
	SysType string `json:"sysType,omitempty"`
	// Parameters 不含函数 RETURNS 伪行；返回类型单独放 ReturnType。
	Parameters []RoutineParameter `json:"parameters"`
	// ReturnType 标量函数返回类型（过程为空；表值函数为 table）。
	ReturnType string `json:"returnType,omitempty"`
	// IsTableValued 是否为表值函数（IF / TF / FT），调用应使用 SELECT * FROM。
	IsTableValued bool `json:"isTableValued,omitempty"`
}

// IsTableValuedSysType 判断 sys.objects.type 是否为表值函数。
func IsTableValuedSysType(typ string) bool {
	switch strings.ToUpper(strings.TrimSpace(typ)) {
	case "IF", "TF", "FT":
		return true
	default:
		return false
	}
}

// ParameterDtdIdentifier 拼装形参完整类型字面量。
func ParameterDtdIdentifier(typeSchema, typeName string, maxLen, precision, scale int32, isTableType bool) string {
	name := strings.TrimSpace(typeName)
	if isTableType {
		schema := strings.TrimSpace(typeSchema)
		if schema != "" && name != "" {
			return qualifiedName(schema, name)
		}
		if name != "" {
			return mustQuote(name)
		}
		return "table"
	}
	return FormatDataType(name, maxLen, precision, scale)
}

// ListRoutineParameters 读取过程 / 函数形参（含 OUTPUT）；函数返回值单独放 ReturnType。
func ListRoutineParameters(ctx context.Context, db *sql.DB, ref RoutineRef) (*RoutineParametersResult, error) {
	if err := requireRoutine(ref); err != nil {
		return nil, err
	}
	sysType, err := objectSysType(ctx, db, ref)
	if err != nil {
		return nil, err
	}
	kind := strings.ToLower(strings.TrimSpace(ref.Kind))
	detected := KindFromSysType(sysType)
	if kind == "" {
		kind = detected
	}
	if kind == "" {
		return nil, fmt.Errorf("sqlserver: object %s.%s not found or unsupported", ref.Schema, ref.Name)
	}
	if kind != "procedure" && kind != "function" {
		return nil, fmt.Errorf("sqlserver: kind must be procedure or function")
	}

	const q = `
SELECT
  p.parameter_id,
  p.name,
  p.is_output,
  p.has_default_value,
  p.is_cursor_ref,
  t.name,
  SCHEMA_NAME(t.schema_id),
  p.max_length,
  p.precision,
  p.scale,
  t.is_table_type
FROM sys.parameters p
INNER JOIN sys.types t ON p.user_type_id = t.user_type_id
WHERE p.object_id = OBJECT_ID(@p1)
ORDER BY p.parameter_id`

	rows, err := db.QueryContext(ctx, q, objectIDArg(ref.Schema, ref.Name))
	if err != nil {
		return nil, fmt.Errorf("sqlserver: list routine parameters: %w", err)
	}
	defer rows.Close()

	out := &RoutineParametersResult{
		Name:          ref.Name,
		Schema:        ref.Schema,
		Kind:          kind,
		SysType:       strings.ToUpper(strings.TrimSpace(sysType)),
		Parameters:    make([]RoutineParameter, 0, 8),
		IsTableValued: IsTableValuedSysType(sysType),
	}

	for rows.Next() {
		var (
			ordinal                        int
			name, typeName, typeSchema     sql.NullString
			isOutput, hasDefault, isCursor bool
			isTableType                    bool
			maxLen, precision, scale       int32
		)
		if err := rows.Scan(
			&ordinal,
			&name,
			&isOutput,
			&hasDefault,
			&isCursor,
			&typeName,
			&typeSchema,
			&maxLen,
			&precision,
			&scale,
			&isTableType,
		); err != nil {
			return nil, fmt.Errorf("sqlserver: scan routine parameter: %w", err)
		}
		dtd := ParameterDtdIdentifier(typeSchema.String, typeName.String, maxLen, precision, scale, isTableType)
		p := RoutineParameter{
			Ordinal:       ordinal,
			Name:          strings.TrimSpace(name.String),
			DataType:      strings.TrimSpace(typeName.String),
			DtdIdentifier: dtd,
			IsReturn:      ordinal == 0,
			HasDefault:    hasDefault,
			IsTableType:   isTableType,
			IsCursor:      isCursor,
		}
		if p.IsReturn {
			if out.IsTableValued {
				out.ReturnType = "table"
			} else {
				out.ReturnType = firstNonEmpty(p.DtdIdentifier, p.DataType)
			}
			continue
		}
		if isOutput {
			p.Mode = "OUTPUT"
		} else {
			p.Mode = "IN"
		}
		out.Parameters = append(out.Parameters, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlserver: routine parameters rows: %w", err)
	}
	if out.IsTableValued && strings.TrimSpace(out.ReturnType) == "" {
		out.ReturnType = "table"
	}
	return out, nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

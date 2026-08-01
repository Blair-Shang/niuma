package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// RoutineParameter 是 information_schema.PARAMETERS 中的形参/返回值。
type RoutineParameter struct {
	// Ordinal 从 1 起为调用实参顺序；函数返回值为 0。
	Ordinal int `json:"ordinal"`
	// Name 形参名；返回值可为空。
	Name string `json:"name"`
	// Mode：IN | OUT | INOUT；函数返回值为空字符串。
	Mode string `json:"mode"`
	// DataType 基础类型名（如 varchar / int）。
	DataType string `json:"dataType"`
	// DtdIdentifier 完整类型声明（如 varchar(64)）。
	DtdIdentifier string `json:"dtdIdentifier"`
	// IsReturn 是否为函数 RETURNS 伪行（ORDINAL_POSITION = 0）。
	IsReturn bool `json:"isReturn"`
}

// RoutineParametersResult 是 meta.routineParameters 返回。
type RoutineParametersResult struct {
	Name       string             `json:"name"`
	Kind       string             `json:"kind"`
	Parameters []RoutineParameter `json:"parameters"`
	// ReturnType 函数返回类型（过程为空）。
	ReturnType string `json:"returnType,omitempty"`
}

// ListRoutineParameters 读取例程形参（含 OUT/INOUT）；不含仅 RETURNS 的伪参行进 parameters，单独放 ReturnType。
func ListRoutineParameters(ctx context.Context, db *sql.DB, ref RoutineRef) (*RoutineParametersResult, error) {
	if err := requireRoutine(ref); err != nil {
		return nil, err
	}
	kind := strings.ToLower(strings.TrimSpace(ref.Kind))
	routineType := "PROCEDURE"
	if kind == "function" {
		routineType = "FUNCTION"
	}

	const q = `
SELECT
  ORDINAL_POSITION,
  PARAMETER_NAME,
  PARAMETER_MODE,
  DATA_TYPE,
  DTD_IDENTIFIER
FROM information_schema.PARAMETERS
WHERE SPECIFIC_SCHEMA = ?
  AND SPECIFIC_NAME = ?
  AND ROUTINE_TYPE = ?
ORDER BY ORDINAL_POSITION`

	rows, err := db.QueryContext(ctx, q, ref.Database, ref.Name, routineType)
	if err != nil {
		return nil, fmt.Errorf("mysql: list routine parameters: %w", err)
	}
	defer rows.Close()

	out := &RoutineParametersResult{
		Name:       ref.Name,
		Kind:       kind,
		Parameters: make([]RoutineParameter, 0, 8),
	}

	for rows.Next() {
		var (
			ordinal  int
			name     sql.NullString
			mode     sql.NullString
			dataType sql.NullString
			dtd      sql.NullString
		)
		if err := rows.Scan(&ordinal, &name, &mode, &dataType, &dtd); err != nil {
			return nil, fmt.Errorf("mysql: scan routine parameter: %w", err)
		}
		p := RoutineParameter{
			Ordinal:       ordinal,
			Name:          strings.TrimSpace(name.String),
			Mode:          strings.ToUpper(strings.TrimSpace(mode.String)),
			DataType:      strings.ToLower(strings.TrimSpace(dataType.String)),
			DtdIdentifier: strings.TrimSpace(dtd.String),
			IsReturn:      ordinal == 0,
		}
		if p.IsReturn {
			out.ReturnType = firstNonEmpty(p.DtdIdentifier, p.DataType)
			continue
		}
		if p.Mode == "" {
			p.Mode = "IN"
		}
		out.Parameters = append(out.Parameters, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("mysql: routine parameters rows: %w", err)
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

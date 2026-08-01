package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// RoutineParameter 是 ALL_ARGUMENTS 中的形参/返回值。
type RoutineParameter struct {
	// Ordinal 从 1 起为调用实参顺序；函数返回值为 0。
	Ordinal int `json:"ordinal"`
	// Name 形参名；返回值可为空。
	Name string `json:"name"`
	// Mode：IN | OUT | IN/OUT；函数返回值可为空。
	Mode string `json:"mode"`
	// DataType 基础类型名。
	DataType string `json:"dataType"`
	// DtdIdentifier 完整类型声明（尽量拼精度/长度）。
	DtdIdentifier string `json:"dtdIdentifier"`
	// IsReturn 是否为函数返回伪行。
	IsReturn bool `json:"isReturn"`
}

// RoutineParametersResult 是 meta.routineParameters 返回。
type RoutineParametersResult struct {
	Name       string             `json:"name"`
	Kind       string             `json:"kind"`
	Parameters []RoutineParameter `json:"parameters"`
	ReturnType string             `json:"returnType,omitempty"`
}

// ListRoutineParameters 读取例程形参（含 OUT/IN OUT）；返回值单独放 ReturnType。
func ListRoutineParameters(ctx context.Context, db *sql.DB, ref RoutineRef) (*RoutineParametersResult, error) {
	schema := strings.TrimSpace(ref.Schema)
	name := strings.TrimSpace(ref.Name)
	if schema == "" || name == "" {
		return nil, fmt.Errorf("dameng: schema and name required")
	}
	kind, _, err := normalizeRoutineKind(ref.Kind)
	if err != nil {
		return nil, err
	}

	rows, err := queryRoutineArguments(ctx, db, schema, name)
	if err != nil {
		return nil, fmt.Errorf("dameng: list routine parameters: %w", err)
	}
	defer rows.Close()

	out := &RoutineParametersResult{
		Name:       name,
		Kind:       kind,
		Parameters: make([]RoutineParameter, 0, 8),
	}

	for rows.Next() {
		var (
			position  int
			argName   sql.NullString
			inOut     sql.NullString
			dataType  sql.NullString
			length    sql.NullInt64
			precision sql.NullInt64
			scale     sql.NullInt64
		)
		if err := rows.Scan(&position, &argName, &inOut, &dataType, &length, &precision, &scale); err != nil {
			return nil, fmt.Errorf("dameng: scan routine parameter: %w", err)
		}
		dt := strings.TrimSpace(dataType.String)
		dtd := buildDtdIdentifier(dt, length, precision, scale)
		mode := normalizeArgumentMode(inOut.String)
		argLabel := strings.TrimSpace(argName.String)
		p := RoutineParameter{
			Ordinal:       position,
			Name:          argLabel,
			Mode:          mode,
			DataType:      dt,
			DtdIdentifier: dtd,
			// 仅函数返回值行用 POSITION=0；达梦过程形参偶发从 0 起算，不得当返回值丢掉。
			IsReturn: isRoutineReturnArg(kind, position, argLabel),
		}
		if p.IsReturn {
			out.ReturnType = firstNonEmpty(dtd, dt)
			continue
		}
		if p.Mode == "" {
			p.Mode = "IN"
		}
		out.Parameters = append(out.Parameters, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("dameng: routine parameters rows: %w", err)
	}
	// ALL_ARGUMENTS 的 POSITION 在达梦上可能从 0 起或重复；统一重编号为 1..n，
	// 避免调试网格 :key / find(index) 冲突导致多参联动。
	for i := range out.Parameters {
		out.Parameters[i].Ordinal = i + 1
	}
	return out, nil
}

func queryRoutineArguments(ctx context.Context, db *sql.DB, schema, name string) (*sql.Rows, error) {
	const withLevel = `
SELECT
  POSITION,
  ARGUMENT_NAME,
  IN_OUT,
  DATA_TYPE,
  DATA_LENGTH,
  DATA_PRECISION,
  DATA_SCALE
FROM ALL_ARGUMENTS
WHERE OWNER = ?
  AND OBJECT_NAME = ?
  AND PACKAGE_NAME IS NULL
  AND (DATA_LEVEL = 0 OR DATA_LEVEL IS NULL)
ORDER BY POSITION`
	rows, err := db.QueryContext(ctx, withLevel, schema, name)
	if err == nil {
		return rows, nil
	}
	const plain = `
SELECT
  POSITION,
  ARGUMENT_NAME,
  IN_OUT,
  DATA_TYPE,
  DATA_LENGTH,
  DATA_PRECISION,
  DATA_SCALE
FROM ALL_ARGUMENTS
WHERE OWNER = ?
  AND OBJECT_NAME = ?
  AND PACKAGE_NAME IS NULL
ORDER BY POSITION`
	return db.QueryContext(ctx, plain, schema, name)
}

// isRoutineReturnArg 判断 ALL_ARGUMENTS 行是否为函数返回值伪行。
// Oracle/达梦函数返回值：POSITION=0 且通常无 ARGUMENT_NAME。
// 过程不得因 POSITION=0 丢弃首个 IN 形参。
func isRoutineReturnArg(kind string, position int, argName string) bool {
	if kind != "function" {
		return false
	}
	if position == 0 {
		return true
	}
	return strings.TrimSpace(argName) == ""
}

func normalizeArgumentMode(mode string) string {
	m := strings.ToUpper(strings.TrimSpace(mode))
	switch m {
	case "OUT":
		return "OUT"
	case "IN/OUT", "INOUT", "IN OUT":
		return "INOUT"
	case "IN", "":
		return "IN"
	default:
		return m
	}
}

func buildDtdIdentifier(dataType string, length, precision, scale sql.NullInt64) string {
	dt := strings.TrimSpace(dataType)
	if dt == "" {
		return ""
	}
	upper := strings.ToUpper(dt)
	if precision.Valid && precision.Int64 > 0 {
		if scale.Valid && scale.Int64 > 0 {
			return fmt.Sprintf("%s(%d,%d)", dt, precision.Int64, scale.Int64)
		}
		if strings.Contains(upper, "CHAR") || strings.Contains(upper, "RAW") || strings.Contains(upper, "BYTE") {
			return fmt.Sprintf("%s(%d)", dt, precision.Int64)
		}
		return fmt.Sprintf("%s(%d)", dt, precision.Int64)
	}
	if length.Valid && length.Int64 > 0 && (strings.Contains(upper, "CHAR") || strings.Contains(upper, "RAW") || strings.Contains(upper, "BYTE")) {
		return fmt.Sprintf("%s(%d)", dt, length.Int64)
	}
	return dt
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

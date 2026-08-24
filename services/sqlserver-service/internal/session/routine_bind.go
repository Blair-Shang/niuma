package session

import (
	"database/sql"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// RoutineCallArg 是 routine.call 的单个实参。
type RoutineCallArg struct {
	Ordinal       int    `json:"ordinal,omitempty"`
	Name          string `json:"name"`
	Mode          string `json:"mode,omitempty"`
	DataType      string `json:"dataType,omitempty"`
	DtdIdentifier string `json:"dtdIdentifier,omitempty"`
	Value         string `json:"value,omitempty"`
	IsNull        bool   `json:"isNull,omitempty"`
	HasDefault    bool   `json:"hasDefault,omitempty"`
	IsTableType   bool   `json:"isTableType,omitempty"`
	IsCursor      bool   `json:"isCursor,omitempty"`
}

// RoutineCallParams 是 routine.call 入参：过程走 TDS RPC，函数走绑定参数的 SELECT。
type RoutineCallParams struct {
	SessionID     string           `json:"sessionId"`
	Database      string           `json:"database,omitempty"`
	Schema        string           `json:"schema"`
	Name          string           `json:"name"`
	Kind          string           `json:"kind"` // procedure | function
	IsTableValued bool             `json:"isTableValued,omitempty"`
	Args          []RoutineCallArg `json:"args"`
	Limit         int              `json:"limit"`
	TimeoutMS     int              `json:"timeoutMs"`
	RequestID     string           `json:"requestId"`
}

// RoutineOutput 是协议带回的 OUTPUT / 返回值。
type RoutineOutput struct {
	Name     string `json:"name"`
	Value    any    `json:"value"`
	DataType string `json:"dataType,omitempty"`
}

type outSlot struct {
	name     string
	display  string
	dataType string
	dest     any
}

func (a RoutineCallArg) typeKey() string {
	return normalizeTypeName(firstNonEmpty(a.DataType, a.DtdIdentifier))
}

func (a RoutineCallArg) typeLabel() string {
	return firstNonEmpty(strings.TrimSpace(a.DtdIdentifier), strings.TrimSpace(a.DataType), "unknown")
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func rpcParamName(name string, ordinal int) string {
	s := strings.TrimSpace(name)
	s = strings.TrimPrefix(s, "@")
	s = strings.TrimPrefix(s, "@")
	if s == "" {
		if ordinal > 0 {
			return fmt.Sprintf("p%d", ordinal)
		}
		return "p"
	}
	return s
}

func isSafeParamIdent(name string) bool {
	if name == "" || utf8.RuneCountInString(name) > 128 {
		return false
	}
	for i, r := range name {
		if i == 0 {
			if unicode.IsLetter(r) || r == '_' || r == '@' || r == '#' {
				continue
			}
			return false
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '@' || r == '#' || r == '$' {
			continue
		}
		return false
	}
	return true
}

func isOutputMode(mode string) bool {
	switch strings.ToUpper(strings.TrimSpace(mode)) {
	case "OUTPUT", "OUT", "INOUT", "IN/OUT", "IN OUT":
		return true
	default:
		return false
	}
}

func skipOptionalIn(a RoutineCallArg) bool {
	if isOutputMode(a.Mode) || a.IsNull || a.IsTableType || a.IsCursor {
		return false
	}
	if !a.HasDefault {
		return false
	}
	return strings.TrimSpace(a.Value) == ""
}

func unwrapSQLLiteral(raw string) string {
	v := strings.TrimSpace(raw)
	if v == "" {
		return v
	}
	if strings.EqualFold(v, "null") {
		return "NULL"
	}
	if len(v) >= 3 && (v[0] == 'N' || v[0] == 'n') && v[1] == '\'' && strings.HasSuffix(v, "'") {
		return unescapeSQLString(v[2 : len(v)-1])
	}
	if len(v) >= 2 && v[0] == '\'' && strings.HasSuffix(v, "'") {
		return unescapeSQLString(v[1 : len(v)-1])
	}
	return v
}

func unescapeSQLString(s string) string {
	return strings.ReplaceAll(s, "''", "'")
}

func parseBindValue(raw, dataType string, isNull, emptyAsZero bool) (any, error) {
	if isNull {
		return nil, nil
	}
	v := unwrapSQLLiteral(raw)
	if v == "" || strings.EqualFold(v, "NULL") {
		if emptyAsZero {
			return zeroBindValue(dataType), nil
		}
		return nil, nil
	}
	kind := normalizeTypeName(dataType)
	switch kind {
	case "TINYINT", "SMALLINT", "INT", "INTEGER", "BIGINT":
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("sqlserver: invalid integer %q", raw)
		}
		return n, nil
	case "BIT":
		switch strings.ToLower(v) {
		case "1", "true", "yes", "on":
			return true, nil
		case "0", "false", "no", "off":
			return false, nil
		default:
			return nil, fmt.Errorf("sqlserver: invalid bit %q", raw)
		}
	case "FLOAT", "REAL", "DOUBLE":
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return nil, fmt.Errorf("sqlserver: invalid float %q", raw)
		}
		return f, nil
	case "DECIMAL", "NUMERIC", "MONEY", "SMALLMONEY":
		if _, err := strconv.ParseFloat(v, 64); err != nil {
			return nil, fmt.Errorf("sqlserver: invalid numeric %q", raw)
		}
		return v, nil
	case "BINARY", "VARBINARY", "IMAGE", "TIMESTAMP", "ROWVERSION":
		b, err := parseHexBytes(v)
		if err != nil {
			return nil, err
		}
		return b, nil
	case "DATE", "DATETIME", "DATETIME2", "SMALLDATETIME", "DATETIMEOFFSET", "TIME":
		t, err := parseSQLServerTime(v, kind)
		if err != nil {
			return nil, err
		}
		return t, nil
	default:
		return v, nil
	}
}

func zeroBindValue(dataType string) any {
	kind := normalizeTypeName(dataType)
	switch kind {
	case "TINYINT", "SMALLINT", "INT", "INTEGER", "BIGINT":
		return int64(0)
	case "BIT":
		return false
	case "FLOAT", "REAL", "DOUBLE":
		return float64(0)
	case "BINARY", "VARBINARY", "IMAGE", "TIMESTAMP", "ROWVERSION":
		return []byte{}
	case "TIME":
		return time.Date(1, 1, 1, 0, 0, 0, 0, time.UTC)
	case "DATE", "DATETIME", "DATETIME2", "SMALLDATETIME", "DATETIMEOFFSET":
		return time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	default:
		return ""
	}
}

func parseHexBytes(v string) ([]byte, error) {
	s := strings.TrimSpace(v)
	if strings.HasPrefix(strings.ToLower(s), "0x") {
		s = s[2:]
	}
	if s == "" {
		return []byte{}, nil
	}
	if len(s)%2 == 1 {
		s = "0" + s
	}
	b, err := hex.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("sqlserver: invalid binary %q", v)
	}
	return b, nil
}

func parseSQLServerTime(v, kind string) (time.Time, error) {
	v = strings.TrimSpace(strings.ReplaceAll(v, "T", " "))
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05.9999999 -07:00",
		"2006-01-02 15:04:05.9999999",
		"2006-01-02 15:04:05",
		"2006-01-02",
		"15:04:05.9999999",
		"15:04:05",
	}
	if kind == "TIME" {
		layouts = []string{"15:04:05.9999999", "15:04:05", "15:04"}
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, v); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("sqlserver: invalid datetime %q", v)
}

func newOutDest(kind string) any {
	switch kind {
	case "TINYINT", "SMALLINT", "INT", "INTEGER", "BIGINT":
		return new(sql.NullInt64)
	case "BIT":
		return new(sql.NullBool)
	case "FLOAT", "REAL", "DOUBLE":
		return new(sql.NullFloat64)
	case "DATE", "DATETIME", "DATETIME2", "SMALLDATETIME", "DATETIMEOFFSET", "TIME":
		return new(sql.NullTime)
	case "BINARY", "VARBINARY", "IMAGE", "TIMESTAMP", "ROWVERSION":
		var b []byte
		return &b
	default:
		return new(sql.NullString)
	}
}

func seedOutDest(dest, value any) error {
	if dest == nil || value == nil {
		return nil
	}
	switch d := dest.(type) {
	case *sql.NullInt64:
		n, err := toInt64(value)
		if err != nil {
			return err
		}
		*d = sql.NullInt64{Int64: n, Valid: true}
	case *sql.NullBool:
		b, ok := value.(bool)
		if !ok {
			return fmt.Errorf("sqlserver: expected bool")
		}
		*d = sql.NullBool{Bool: b, Valid: true}
	case *sql.NullFloat64:
		f, err := toFloat64(value)
		if err != nil {
			return err
		}
		*d = sql.NullFloat64{Float64: f, Valid: true}
	case *sql.NullTime:
		t, ok := value.(time.Time)
		if !ok {
			return fmt.Errorf("sqlserver: expected time")
		}
		*d = sql.NullTime{Time: t, Valid: true}
	case *sql.NullString:
		*d = sql.NullString{String: fmt.Sprint(value), Valid: true}
	case *[]byte:
		b, ok := value.([]byte)
		if !ok {
			return fmt.Errorf("sqlserver: expected bytes")
		}
		*d = b
	default:
		return fmt.Errorf("sqlserver: unsupported output dest %T", dest)
	}
	return nil
}

func toInt64(v any) (int64, error) {
	switch n := v.(type) {
	case int64:
		return n, nil
	case int:
		return int64(n), nil
	case int32:
		return int64(n), nil
	default:
		return 0, fmt.Errorf("sqlserver: expected integer")
	}
}

func toFloat64(v any) (float64, error) {
	switch n := v.(type) {
	case float64:
		return n, nil
	case float32:
		return float64(n), nil
	case int64:
		return float64(n), nil
	default:
		return 0, fmt.Errorf("sqlserver: expected float")
	}
}

func encodeOutDest(dest any, dataType string) any {
	if dest == nil {
		return nil
	}
	col := ColumnMeta{DataType: dataType}
	switch d := dest.(type) {
	case *sql.NullInt64:
		if d == nil || !d.Valid {
			return nil
		}
		return encodeCell(d.Int64, col)
	case *sql.NullBool:
		if d == nil || !d.Valid {
			return nil
		}
		return encodeCell(d.Bool, col)
	case *sql.NullFloat64:
		if d == nil || !d.Valid {
			return nil
		}
		return encodeCell(d.Float64, col)
	case *sql.NullTime:
		if d == nil || !d.Valid {
			return nil
		}
		return encodeCell(d.Time, col)
	case *sql.NullString:
		if d == nil || !d.Valid {
			return nil
		}
		return encodeCell(d.String, col)
	case *[]byte:
		if d == nil || *d == nil {
			return nil
		}
		return encodeCell(*d, col)
	default:
		return fmt.Sprint(dest)
	}
}

func outputResultSet(outs []RoutineOutput, returnValue *int32) QueryResultSet {
	cols := make([]ColumnMeta, 0, len(outs)+1)
	row := make([]any, 0, len(outs)+1)
	for _, o := range outs {
		cols = append(cols, ColumnMeta{Name: o.Name, DataType: o.DataType})
		row = append(row, o.Value)
	}
	if returnValue != nil {
		cols = append(cols, ColumnMeta{Name: "Return Value", DataType: "int"})
		row = append(row, encodeCell(int64(*returnValue), ColumnMeta{DataType: "int"}))
	}
	if len(cols) == 0 {
		return QueryResultSet{}
	}
	return QueryResultSet{Columns: cols, Rows: [][]any{row}, RowCount: 1}
}

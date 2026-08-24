package session

import (
	"database/sql"
	"reflect"
	"testing"
	"time"
)

func TestRpcParamName(t *testing.T) {
	if got := rpcParamName("@CustomerId", 1); got != "CustomerId" {
		t.Fatalf("got %q", got)
	}
	if got := rpcParamName("", 3); got != "p3" {
		t.Fatalf("got %q", got)
	}
	if !isSafeParamIdent("CustomerId") || !isSafeParamIdent("p1") {
		t.Fatal("expected safe names")
	}
	if isSafeParamIdent("x);DROP") || isSafeParamIdent("") {
		t.Fatal("expected unsafe names rejected")
	}
}

func TestSkipOptionalIn(t *testing.T) {
	inDefault := RoutineCallArg{Name: "@id", Mode: "IN", HasDefault: true, DataType: "int"}
	if !skipOptionalIn(inDefault) {
		t.Fatal("empty IN with default should be omitted from RPC")
	}
	inNull := RoutineCallArg{Name: "@id", Mode: "IN", HasDefault: true, IsNull: true, DataType: "int"}
	if skipOptionalIn(inNull) {
		t.Fatal("explicit NULL must be sent")
	}
	outEmpty := RoutineCallArg{Name: "@out", Mode: "OUTPUT", HasDefault: true, DataType: "int"}
	if skipOptionalIn(outEmpty) {
		t.Fatal("OUTPUT must not be omitted")
	}
}

func TestParseBindValue(t *testing.T) {
	n, err := parseBindValue("42", "int", false, false)
	if err != nil || n != int64(42) {
		t.Fatalf("int: %v %v", n, err)
	}
	s, err := parseBindValue("N'O''Hara'", "nvarchar(32)", false, false)
	if err != nil || s != "O'Hara" {
		t.Fatalf("nvarchar: %v %v", s, err)
	}
	nul, err := parseBindValue("", "int", true, true)
	if err != nil || nul != nil {
		t.Fatalf("null: %v %v", nul, err)
	}
	z, err := parseBindValue("", "int", false, true)
	if err != nil || z != int64(0) {
		t.Fatalf("zero: %v %v", z, err)
	}
	b, err := parseBindValue("true", "bit", false, false)
	if err != nil || b != true {
		t.Fatalf("bit: %v %v", b, err)
	}
	hex, err := parseBindValue("0x0A0B", "varbinary", false, false)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := hex.([]byte)
	if !ok || len(got) != 2 || got[0] != 0x0A || got[1] != 0x0B {
		t.Fatalf("hex: %v", hex)
	}
	tm, err := parseBindValue("2020-01-02 03:04:05", "datetime2", false, false)
	if err != nil {
		t.Fatal(err)
	}
	tt, ok := tm.(time.Time)
	if !ok || tt.Year() != 2020 || tt.Month() != 1 || tt.Day() != 2 {
		t.Fatalf("time: %v", tm)
	}
}

func TestBuildFunctionCallQuery(t *testing.T) {
	sqlText, args, err := buildFunctionCallQuery("[dbo].[fnAdd]", false, []RoutineCallArg{
		{Ordinal: 1, Name: "@a", Mode: "IN", DataType: "int", Value: "1"},
		{Ordinal: 2, Name: "@b", Mode: "IN", DataType: "int", IsNull: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if sqlText != "SELECT [dbo].[fnAdd](@a, @b) AS [result]" {
		t.Fatalf("sql: %s", sqlText)
	}
	if len(args) != 2 {
		t.Fatalf("args %d", len(args))
	}
	tvf, args, err := buildFunctionCallQuery("[dbo].[fnRows]", true, []RoutineCallArg{
		{Ordinal: 1, Name: "@id", Mode: "IN", DataType: "int", Value: "7"},
	})
	if err != nil || len(args) != 1 {
		t.Fatalf("tvf: %s %v %d", tvf, err, len(args))
	}
	if tvf != "SELECT * FROM [dbo].[fnRows](@id)" {
		t.Fatalf("tvf sql: %s", tvf)
	}
	defSQL, defArgs, err := buildFunctionCallQuery("[dbo].[fnDef]", false, []RoutineCallArg{
		{Ordinal: 1, Name: "@a", Mode: "IN", DataType: "int", HasDefault: true},
		{Ordinal: 2, Name: "@b", Mode: "IN", DataType: "int", Value: "2"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if defSQL != "SELECT [dbo].[fnDef](DEFAULT, @b) AS [result]" {
		t.Fatalf("default sql: %s", defSQL)
	}
	if len(defArgs) != 1 {
		t.Fatalf("default args %d", len(defArgs))
	}
}

func TestBuildProcedureRPCArgs(t *testing.T) {
	args, slots, err := buildProcedureRPCArgs([]RoutineCallArg{
		{Ordinal: 1, Name: "@id", Mode: "IN", DataType: "int", Value: "9"},
		{Ordinal: 2, Name: "@name", Mode: "OUTPUT", DataType: "nvarchar", DtdIdentifier: "nvarchar(64)"},
		{Ordinal: 3, Name: "@skip", Mode: "IN", DataType: "int", HasDefault: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(args) != 2 {
		t.Fatalf("want 2 bound args, got %d", len(args))
	}
	if len(slots) != 1 || slots[0].display != "@name" {
		t.Fatalf("slots: %+v", slots)
	}
	in, ok := args[0].(sql.NamedArg)
	if !ok || in.Name != "id" {
		t.Fatalf("in arg: %#v", args[0])
	}
	out, ok := args[1].(sql.NamedArg)
	if !ok || out.Name != "name" {
		t.Fatalf("out arg: %#v", args[1])
	}
	if _, ok := out.Value.(sql.Out); !ok {
		t.Fatalf("expected sql.Out, got %T", out.Value)
	}
}

func TestBuildProcedureRPCRejectsTVP(t *testing.T) {
	_, _, err := buildProcedureRPCArgs([]RoutineCallArg{
		{Ordinal: 1, Name: "@tvp", Mode: "IN", DataType: "MyTableType", IsTableType: true},
	})
	if err == nil {
		t.Fatal("expected TVP error")
	}
}

func TestOutputResultSet(t *testing.T) {
	ret := int32(12)
	set := outputResultSet([]RoutineOutput{
		{Name: "@name", Value: "Ada", DataType: "nvarchar(64)"},
	}, &ret)
	if set.RowCount != 1 || len(set.Columns) != 2 {
		t.Fatalf("set: %+v", set)
	}
	if set.Columns[1].Name != "Return Value" {
		t.Fatalf("cols: %+v", set.Columns)
	}
	if !reflect.DeepEqual(set.Rows[0][1], int64(12)) && set.Rows[0][1] != 12 {
		t.Fatalf("return cell: %#v", set.Rows[0][1])
	}
}

func TestBuildRoutineInvocationProcedureIsProcName(t *testing.T) {
	q, args, slots, capture, err := buildRoutineInvocation("Sales", "uspGet", "procedure", false, []RoutineCallArg{
		{Ordinal: 1, Name: "@id", Mode: "IN", DataType: "int", Value: "1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if q != "[Sales].[uspGet]" {
		t.Fatalf("rpc text must be a proc name, got %q", q)
	}
	if !capture || len(args) != 1 || len(slots) != 0 {
		t.Fatalf("capture=%v args=%d slots=%d", capture, len(args), len(slots))
	}
}

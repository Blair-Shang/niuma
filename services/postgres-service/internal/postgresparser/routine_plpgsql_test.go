package postgresparser

import "testing"

func TestDiagnosePlpgsqlFunctionTemplate(t *testing.T) {
	sql := "CREATE OR REPLACE FUNCTION \"new_schema1\".\"new_func\"(\n  -- p_arg1 integer\n)\nRETURNS integer\nLANGUAGE plpgsql\nVOLATILE\nSECURITY INVOKER\nAS $$\nBEGIN\n  -- TODO: implement\n  RETURN 1;\nEND;\n$$;"
	diags := diagnoseRoutine(sql, CompatPG)
	for _, d := range diags {
		t.Logf("sev=%v msg=%s at L%d:%d", d.Severity, d.Message, d.Range.Start.Line, d.Range.Start.Character)
	}
	if len(diags) > 0 {
		t.Fatalf("expected no diagnostics, got %d", len(diags))
	}
}

func TestDiagnosePlpgsqlProcedureTemplate(t *testing.T) {
	sql := "CREATE OR REPLACE PROCEDURE \"s\".\"p\"(\n  -- IN p_arg1 integer\n)\nLANGUAGE plpgsql\nSECURITY INVOKER\nAS $$\nBEGIN\n  NULL;\nEND;\n$$;"
	diags := diagnoseRoutine(sql, CompatPG)
	for _, d := range diags {
		t.Logf("sev=%v msg=%s", d.Severity, d.Message)
	}
	if len(diags) > 0 {
		t.Fatalf("expected no diagnostics, got %d", len(diags))
	}
}

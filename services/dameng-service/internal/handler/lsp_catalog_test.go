package handler

import (
	"strings"
	"testing"

	"niuma/pkg/sqllsp"
	"niuma/services/dameng-service/internal/meta"
	"niuma/services/dameng-service/internal/tree"
)

func TestMapRoutineHits(t *testing.T) {
	schema := "SYSDBA"
	result := tree.ObjectResult{
		Routines: []tree.ObjectItem{
			{Name: "P1", Type: "procedure"},
			{Name: "F1", Type: "function"},
		},
		Truncated: true,
	}
	out := make([]sqllsp.RoutineHit, 0, len(result.Routines))
	for _, r := range result.Routines {
		out = append(out, sqllsp.RoutineHit{Name: r.Name, Type: r.Type, Schema: schema})
	}
	if len(out) != 2 || out[0].Type != "procedure" || out[1].Schema != schema {
		t.Fatalf("map routines failed: %#v", out)
	}
	if !result.Truncated {
		t.Fatal("truncated should propagate")
	}
}

func TestMapRoutineParameters(t *testing.T) {
	result := &meta.RoutineParametersResult{
		Name: "demo_fn",
		Kind: "function",
		Parameters: []meta.RoutineParameter{
			{Ordinal: 1, Name: "p_id", Mode: "IN", DataType: "INT", DtdIdentifier: "INT"},
			{Ordinal: 2, Name: "p_out", Mode: "OUT", DataType: "VARCHAR", DtdIdentifier: "VARCHAR(32)"},
			{Ordinal: 0, Name: "", Mode: "", DataType: "INT", IsReturn: true},
		},
		ReturnType: "INT",
	}
	params := make([]sqllsp.ParameterInformation, 0, len(result.Parameters))
	for _, rp := range result.Parameters {
		if rp.IsReturn {
			continue
		}
		label := rp.Name
		typ := strings.TrimSpace(rp.DtdIdentifier)
		if typ == "" {
			typ = rp.DataType
		}
		if label == "" {
			label = typ
		} else if typ != "" {
			if rp.Mode != "" && rp.Mode != "IN" {
				label = rp.Mode + " " + label + " " + typ
			} else {
				label = label + " " + typ
			}
		}
		params = append(params, sqllsp.ParameterInformation{Label: label})
	}
	if len(params) != 2 {
		t.Fatalf("expected 2 params (skip return), got %#v", params)
	}
	if params[1].Label != "OUT p_out VARCHAR(32)" {
		t.Fatalf("out param label=%q", params[1].Label)
	}
}

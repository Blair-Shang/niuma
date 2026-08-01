package meta

import "testing"

func TestIsRoutineReturnArg(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		kind     string
		position int
		argName  string
		want     bool
	}{
		{name: "fn return pos0", kind: "function", position: 0, argName: "", want: true},
		{name: "fn named in", kind: "function", position: 1, argName: "P_IN", want: false},
		{name: "fn empty name still return-ish", kind: "function", position: 2, argName: "", want: true},
		{name: "proc first arg pos0 must keep", kind: "procedure", position: 0, argName: "IN_ORGANIZATIONID", want: false},
		{name: "proc normal", kind: "procedure", position: 1, argName: "IN_WAREHOUSEID", want: false},
		{name: "proc empty name not return", kind: "procedure", position: 0, argName: "", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := isRoutineReturnArg(tc.kind, tc.position, tc.argName)
			if got != tc.want {
				t.Fatalf("isRoutineReturnArg(%q,%d,%q)=%v want %v", tc.kind, tc.position, tc.argName, got, tc.want)
			}
		})
	}
}

func TestRenumberProcedureOrdinalsUnique(t *testing.T) {
	t.Parallel()
	// 模拟达梦过程 POSITION 从 0 起：0,1,2 → 重编号后必须是 1,2,3 且互不重复
	out := &RoutineParametersResult{
		Parameters: []RoutineParameter{
			{Ordinal: 0, Name: "In_WarehouseId", Mode: "IN"},
			{Ordinal: 1, Name: "In_UserID", Mode: "IN"},
			{Ordinal: 2, Name: "OUT_Return_Code", Mode: "INOUT"},
		},
	}
	for i := range out.Parameters {
		out.Parameters[i].Ordinal = i + 1
	}
	seen := map[int]string{}
	for _, p := range out.Parameters {
		if prev, ok := seen[p.Ordinal]; ok {
			t.Fatalf("duplicate ordinal %d for %q and %q", p.Ordinal, prev, p.Name)
		}
		seen[p.Ordinal] = p.Name
	}
	if out.Parameters[0].Ordinal != 1 || out.Parameters[1].Ordinal != 2 || out.Parameters[2].Ordinal != 3 {
		t.Fatalf("unexpected ordinals: %#v", out.Parameters)
	}
}

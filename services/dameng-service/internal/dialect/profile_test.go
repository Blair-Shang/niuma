package dialect

import "testing"

func TestResolveCapabilities(t *testing.T) {
	cases := []struct{ version, compat, cap string }{
		{"8.1.3", "oracle", CapDDLIfNotExists},
		{"8.1.3", "oracle", CapCompatOracle},
		{"8.1.3", "mysql", CapCompatMysql},
		{"7.6.0", "", CapSequenceNative},
		{"8.1.3", "", CapEditorSqlLsp},
	}
	for _, tc := range cases {
		p := ResolveCapabilities(tc.version, tc.compat)
		if !Has(&p, tc.cap) {
			t.Errorf("%s/%s missing %s", tc.version, tc.compat, tc.cap)
		}
		if p.Family != FamilyDameng {
			t.Fatal("wrong family")
		}
	}
}

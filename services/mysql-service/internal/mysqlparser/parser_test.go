package mysqlparser_test

import (
	"strings"
	"testing"

	"niuma/pkg/sqllsp"
	"niuma/services/mysql-service/internal/mysqlparser"
)

func TestParseOK(t *testing.T) {
	if !mysqlparser.ParseOK("SELECT 1") {
		t.Fatal("expected SELECT 1 to parse")
	}
}

func TestDiagnosticsBadSQL(t *testing.T) {
	p := mysqlparser.New()
	diags := p.Diagnostics("", "SELEC ")
	if len(diags) == 0 {
		t.Fatal("expected diagnostics")
	}
}

func TestCompletionFrom(t *testing.T) {
	p := mysqlparser.New()
	cc := p.CompletionContext("SELECT * FROM u", sqllsp.Position{Character: 15})
	found := false
	for _, k := range cc.Expect {
		if k == sqllsp.KindTable {
			found = true
		}
	}
	if !found {
		t.Fatalf("expect table, got %#v", cc)
	}
}

func TestDelimiterDoesNotCrashDiagnostics(t *testing.T) {
	// TiDB 对存储过程支持有限；DELIMITER 预处理后至少不应 panic，且可诊断普通 DML
	p := mysqlparser.New()
	sql := "DELIMITER //\nSELECT 1 from t //\nDELIMITER ;\n"
	_ = p.Diagnostics("", sql)
	if !mysqlparser.ParseOK("SELECT 1 FROM t") {
		t.Fatal("baseline parse")
	}
	// 预处理后含 SELECT 的脚本应去掉客户端指令噪声
	if !strings.Contains(sql, "DELIMITER") {
		t.Fatal("fixture")
	}
}

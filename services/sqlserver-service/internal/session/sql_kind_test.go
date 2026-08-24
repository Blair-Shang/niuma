package session

import "testing"

func TestReturnsResultSetDeclareBatch(t *testing.T) {
	sql := `DECLARE @return_value int
EXEC @return_value = [dbo].[uspGet] @id = 1
SELECT @return_value AS [Return Value]`
	if !returnsResultSet(sql) {
		t.Fatal("DECLARE + EXEC + SELECT batch should be queried as a result set")
	}
}

func TestReturnsResultSetExec(t *testing.T) {
	if !returnsResultSet("EXEC [dbo].[uspGet] @id = 1") {
		t.Fatal("EXEC should return a result set")
	}
}

func TestReturnsResultSetInsert(t *testing.T) {
	if returnsResultSet("INSERT INTO t (id) VALUES (1)") {
		t.Fatal("INSERT should not be treated as a result set")
	}
}

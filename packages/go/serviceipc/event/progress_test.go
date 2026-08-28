package event

import "testing"

func TestIsProgressType(t *testing.T) {
	t.Parallel()
	if !IsProgressType("ftp.transfer.progress") {
		t.Fatal("ftp.transfer.progress")
	}
	if !IsProgressType("mysql.io.progress") {
		t.Fatal("mysql.io.progress")
	}
	if IsProgressType("ftp.transfer.state") {
		t.Fatal("state must not be droppable")
	}
	if IsProgressType("mysql.session.state") {
		t.Fatal("session.state must not be droppable")
	}
}

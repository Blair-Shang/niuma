package handler

import (
	"context"
	"encoding/json"
	"testing"

	"niuma/services/clickhouse-service/internal/idgen"
)

func TestHandleFrameUnknownMethod(t *testing.T) {
	t.Parallel()
	ids, err := idgen.NewSnowflake(1)
	if err != nil {
		t.Fatal(err)
	}
	d := New(ids, nil)
	raw, _ := json.Marshal(Request{Method: "no.such", ID: "1", Params: json.RawMessage(`{}`)})
	out := d.HandleFrame(context.Background(), raw)
	var resp Response
	if err := json.Unmarshal(out, &resp); err != nil {
		t.Fatal(err)
	}
	if resp.OK {
		t.Fatal("expected failure")
	}
	if resp.Error == "" {
		t.Fatal("expected error message")
	}
}

func TestHandleFrameInvalidJSON(t *testing.T) {
	t.Parallel()
	ids, err := idgen.NewSnowflake(2)
	if err != nil {
		t.Fatal(err)
	}
	d := New(ids, nil)
	out := d.HandleFrame(context.Background(), []byte(`{`))
	var resp Response
	if err := json.Unmarshal(out, &resp); err != nil {
		t.Fatal(err)
	}
	if resp.OK {
		t.Fatal("expected failure")
	}
}

func TestQueryExecRequiresSessionID(t *testing.T) {
	t.Parallel()
	ids, err := idgen.NewSnowflake(3)
	if err != nil {
		t.Fatal(err)
	}
	d := New(ids, nil)
	raw, _ := json.Marshal(Request{
		Method: MethodQueryExec,
		ID:     "q1",
		Params: json.RawMessage(`{"sql":"SELECT 1"}`),
	})
	out := d.HandleFrame(context.Background(), raw)
	var resp Response
	if err := json.Unmarshal(out, &resp); err != nil {
		t.Fatal(err)
	}
	if resp.OK || resp.Error != errSessionIDRequired {
		t.Fatalf("resp=%+v", resp)
	}
}

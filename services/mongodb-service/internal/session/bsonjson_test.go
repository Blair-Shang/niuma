package session

import (
	"encoding/json"
	"testing"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestParseDocumentExtendedJSON(t *testing.T) {
	raw := json.RawMessage(`{"_id":{"$oid":"507f1f77bcf86cd799439011"},"name":"test","ref":{"$oid":"507f1f77bcf86cd799439012"}}`)
	doc, err := ParseDocument(raw)
	if err != nil {
		t.Fatal(err)
	}
	id, ok := doc["_id"].(primitive.ObjectID)
	if !ok {
		t.Fatalf("_id type %T", doc["_id"])
	}
	if id.Hex() != "507f1f77bcf86cd799439011" {
		t.Fatalf("bad id %s", id.Hex())
	}
	ref, ok := doc["ref"].(primitive.ObjectID)
	if !ok {
		t.Fatalf("ref type %T value %#v", doc["ref"], doc["ref"])
	}
	if ref.Hex() != "507f1f77bcf86cd799439012" {
		t.Fatalf("bad ref %s", ref.Hex())
	}
}

func TestParseDocumentRelaxedDate(t *testing.T) {
	raw := json.RawMessage(`{"_id":{"$oid":"507f1f77bcf86cd799439011"},"ts":{"$date":"2020-01-01T00:00:00.000Z"}}`)
	doc, err := ParseDocument(raw)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := doc["ts"].(primitive.DateTime); !ok {
		t.Fatalf("ts type %T", doc["ts"])
	}
}

func TestParseDocumentRejectsObjectIDLiteral(t *testing.T) {
	_, err := ParseDocument(json.RawMessage(`{"$oid":"507f1f77bcf86cd799439011"}`))
	if err == nil {
		t.Fatal("expected error for ObjectId literal document")
	}
}

func TestParseDocumentIDExtended(t *testing.T) {
	raw := json.RawMessage(`{"$oid":"507f1f77bcf86cd799439011"}`)
	id, err := ParseDocumentID(raw)
	if err != nil {
		t.Fatal(err)
	}
	oid, ok := id.(primitive.ObjectID)
	if !ok {
		t.Fatalf("expected ObjectID, got %T", id)
	}
	if oid.Hex() != "507f1f77bcf86cd799439011" {
		t.Fatalf("bad id %s", oid.Hex())
	}
}

func TestParseDocumentIDStringHex(t *testing.T) {
	raw := json.RawMessage(`"507f1f77bcf86cd799439011"`)
	id, err := ParseDocumentID(raw)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := id.(primitive.ObjectID); !ok {
		t.Fatalf("expected ObjectID, got %T", id)
	}
}

func TestNormalizeBSONValuePrimitiveD(t *testing.T) {
	v := normalizeBSONValue(primitive.D{{Key: "$oid", Value: "507f1f77bcf86cd799439011"}})
	if _, ok := v.(primitive.ObjectID); !ok {
		t.Fatalf("expected ObjectID, got %T", v)
	}
}

func TestValidateDocumentForReplace(t *testing.T) {
	if err := validateDocumentForReplace(bson.M{"$oid": "507f1f77bcf86cd799439011"}); err == nil {
		t.Fatal("expected validation error")
	}
	if err := validateDocumentForReplace(bson.M{"name": "ok"}); err != nil {
		t.Fatal(err)
	}
}

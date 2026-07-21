package session

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

const extJSONRelaxed = false

// MarshalDocument 将 BSON 文档编码为 Relaxed Extended JSON。
func MarshalDocument(doc bson.M) (json.RawMessage, error) {
	if doc == nil {
		return json.RawMessage("null"), nil
	}
	data, err := bson.MarshalExtJSON(doc, extJSONRelaxed, false)
	if err != nil {
		return nil, fmt.Errorf("mongodb: marshal document: %w", err)
	}
	return json.RawMessage(data), nil
}

// ParseDocument 从 Relaxed Extended JSON 解析 BSON 文档。
func ParseDocument(raw json.RawMessage) (bson.M, error) {
	if len(raw) == 0 {
		return bson.M{}, nil
	}
	var doc bson.M
	if err := bson.UnmarshalExtJSON(raw, extJSONRelaxed, &doc); err != nil {
		return nil, fmt.Errorf("mongodb: parse document: %w", err)
	}
	if _, ok := objectIDFromExtendedMap(doc); ok {
		return nil, fmt.Errorf("document must be a JSON object, not an ObjectId literal")
	}
	return normalizeBSONMap(doc), nil
}

// ParseDocumentID 解析文档主键（支持 Extended JSON 或纯字符串 ObjectId）。
func ParseDocumentID(raw json.RawMessage) (any, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("id required")
	}
	var id any
	if err := bson.UnmarshalExtJSON(raw, extJSONRelaxed, &id); err == nil {
		if normalized := normalizeBSONValue(id); normalized != nil {
			if s, ok := normalized.(string); ok {
				if oid, err := primitive.ObjectIDFromHex(s); err == nil {
					return oid, nil
				}
			}
			return normalized, nil
		}
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, fmt.Errorf("mongodb: parse id: %w", err)
	}
	if oid, err := primitive.ObjectIDFromHex(s); err == nil {
		return oid, nil
	}
	return s, nil
}

// ParseOptionalFilter 解析可选查询条件 JSON。
func ParseOptionalFilter(raw json.RawMessage) (bson.M, error) {
	if len(raw) == 0 {
		return bson.M{}, nil
	}
	return ParseDocument(raw)
}

// ParseOptionalSort 解析可选排序 JSON。
func ParseOptionalSort(raw json.RawMessage) (bson.D, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var sort bson.D
	if err := bson.UnmarshalExtJSON(raw, extJSONRelaxed, &sort); err != nil {
		return nil, fmt.Errorf("mongodb: parse sort: %w", err)
	}
	return sort, nil
}

// ParseOptionalProjection 解析可选投影 JSON。
func ParseOptionalProjection(raw json.RawMessage) (bson.M, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	return ParseDocument(raw)
}

func normalizeBSONMap(m bson.M) bson.M {
	out := make(bson.M, len(m))
	for k, v := range m {
		out[k] = normalizeBSONValue(v)
	}
	return out
}

func normalizeBSONValue(v any) any {
	switch x := v.(type) {
	case bson.M:
		if oid, ok := objectIDFromExtendedMap(x); ok {
			return oid
		}
		if dt, ok := dateFromExtendedMap(x); ok {
			return dt
		}
		return normalizeBSONMap(x)
	case primitive.D:
		if oid, ok := objectIDFromExtendedD(x); ok {
			return oid
		}
		if dt, ok := dateFromExtendedD(x); ok {
			return dt
		}
		return normalizeBSONMap(x.Map())
	case primitive.A:
		arr := make(primitive.A, len(x))
		for i, item := range x {
			arr[i] = normalizeBSONValue(item)
		}
		return arr
	case []any:
		arr := make([]any, len(x))
		for i, item := range x {
			arr[i] = normalizeBSONValue(item)
		}
		return arr
	default:
		return v
	}
}

func objectIDFromExtendedMap(m bson.M) (primitive.ObjectID, bool) {
	if len(m) != 1 {
		return primitive.NilObjectID, false
	}
	hex, ok := m["$oid"].(string)
	if !ok {
		return primitive.NilObjectID, false
	}
	oid, err := primitive.ObjectIDFromHex(hex)
	return oid, err == nil
}

func objectIDFromExtendedD(d primitive.D) (primitive.ObjectID, bool) {
	if len(d) != 1 || d[0].Key != "$oid" {
		return primitive.NilObjectID, false
	}
	hex, ok := d[0].Value.(string)
	if !ok {
		return primitive.NilObjectID, false
	}
	oid, err := primitive.ObjectIDFromHex(hex)
	return oid, err == nil
}

func dateFromExtendedMap(m bson.M) (primitive.DateTime, bool) {
	if len(m) != 1 {
		return 0, false
	}
	raw, ok := m["$date"]
	if !ok {
		return 0, false
	}
	switch v := raw.(type) {
	case string:
		t, err := time.Parse(time.RFC3339Nano, v)
		if err != nil {
			t, err = time.Parse(time.RFC3339, v)
		}
		if err != nil {
			return 0, false
		}
		return primitive.NewDateTimeFromTime(t), true
	case bson.M:
		if ms, ok := v["$numberLong"].(string); ok {
			var n int64
			if _, err := fmt.Sscan(ms, &n); err != nil {
				return 0, false
			}
			return primitive.DateTime(n), true
		}
	}
	return 0, false
}

func dateFromExtendedD(d primitive.D) (primitive.DateTime, bool) {
	return dateFromExtendedMap(d.Map())
}

func validateDocumentForReplace(doc bson.M) error {
	for k := range doc {
		if strings.HasPrefix(k, "$") {
			return fmt.Errorf("document must not contain field names starting with '$'")
		}
	}
	return nil
}

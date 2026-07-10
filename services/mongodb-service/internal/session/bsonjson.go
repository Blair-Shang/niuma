package session

import (
	"encoding/json"
	"fmt"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// MarshalDocument 将 BSON 文档编码为 Relaxed Extended JSON。
func MarshalDocument(doc bson.M) (json.RawMessage, error) {
	if doc == nil {
		return json.RawMessage("null"), nil
	}
	data, err := bson.MarshalExtJSON(doc, false, false)
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
	if err := bson.UnmarshalExtJSON(raw, true, &doc); err != nil {
		return nil, fmt.Errorf("mongodb: parse document: %w", err)
	}
	return doc, nil
}

// ParseDocumentID 解析文档主键（支持 Extended JSON 或纯字符串 ObjectId）。
func ParseDocumentID(raw json.RawMessage) (any, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("id required")
	}
	var id any
	if err := bson.UnmarshalExtJSON(raw, true, &id); err == nil {
		return id, nil
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
	if err := bson.UnmarshalExtJSON(raw, true, &sort); err != nil {
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

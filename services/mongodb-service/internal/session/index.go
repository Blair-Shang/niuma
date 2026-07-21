package session

import (
	"context"
	"encoding/json"
	"fmt"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// idIndexName 是 MongoDB 默认主键索引名，禁止删除。
const idIndexName = "_id_"

// IndexInfo 是 index.list 返回的单条索引摘要。
type IndexInfo struct {
	// Name 是索引名（如 _id_、field_1）。
	Name string `json:"name"`
	// Keys 是索引键定义（Extended JSON，保留字段顺序）。
	Keys json.RawMessage `json:"keys"`
	// Unique 表示唯一索引。
	Unique bool `json:"unique,omitempty"`
	// Sparse 表示稀疏索引。
	Sparse bool `json:"sparse,omitempty"`
	// ExpireAfterSeconds 为 TTL 索引的过期秒数；非 TTL 索引为 nil。
	ExpireAfterSeconds *int32 `json:"expireAfterSeconds,omitempty"`
	// Raw 是完整索引定义（Extended JSON），供查看原始属性。
	Raw json.RawMessage `json:"raw"`
}

// CreateIndexParams 是 index.create 参数。
type CreateIndexParams struct {
	Database   string `json:"database"`
	Collection string `json:"collection"`
	// Keys 是索引键 JSON（如 {"userId":1,"createdAt":-1}），顺序敏感。
	Keys json.RawMessage `json:"keys"`
	// Name 为空时由服务端自动生成。
	Name   string `json:"name,omitempty"`
	Unique bool   `json:"unique,omitempty"`
	Sparse bool   `json:"sparse,omitempty"`
	// ExpireAfterSeconds 非 nil 时创建 TTL 索引。
	ExpireAfterSeconds *int32 `json:"expireAfterSeconds,omitempty"`
}

// ListIndexes 列出集合全部索引。
func ListIndexes(ctx context.Context, client *mongo.Client, database, collection string) ([]IndexInfo, error) {
	if err := requireDBColl(database, collection); err != nil {
		return nil, err
	}
	cur, err := client.Database(database).Collection(collection).Indexes().List(ctx)
	if err != nil {
		return nil, fmt.Errorf("mongodb: list indexes: %w", err)
	}
	defer cur.Close(ctx)

	indexes := make([]IndexInfo, 0, 4)
	for cur.Next(ctx) {
		// 用 bson.D 解码以保留 key 字段顺序（复合索引顺序有意义）。
		var doc bson.D
		if err := cur.Decode(&doc); err != nil {
			return nil, fmt.Errorf("mongodb: decode index: %w", err)
		}
		info, err := summarizeIndex(doc)
		if err != nil {
			return nil, err
		}
		indexes = append(indexes, info)
	}
	if err := cur.Err(); err != nil {
		return nil, fmt.Errorf("mongodb: iterate indexes: %w", err)
	}
	return indexes, nil
}

// CreateIndex 创建索引并返回索引名。
func CreateIndex(ctx context.Context, client *mongo.Client, p CreateIndexParams) (string, error) {
	if err := requireDBColl(p.Database, p.Collection); err != nil {
		return "", err
	}
	if len(p.Keys) == 0 {
		return "", fmt.Errorf("index keys required")
	}
	// bson.D 保留 JSON 对象字段顺序，复合索引依赖该顺序。
	var keys bson.D
	if err := bson.UnmarshalExtJSON(p.Keys, extJSONRelaxed, &keys); err != nil {
		return "", fmt.Errorf("mongodb: parse index keys: %w", err)
	}
	if len(keys) == 0 {
		return "", fmt.Errorf("index keys required")
	}

	opts := options.Index()
	if p.Name != "" {
		opts.SetName(p.Name)
	}
	if p.Unique {
		opts.SetUnique(true)
	}
	if p.Sparse {
		opts.SetSparse(true)
	}
	if p.ExpireAfterSeconds != nil {
		opts.SetExpireAfterSeconds(*p.ExpireAfterSeconds)
	}

	name, err := client.Database(p.Database).Collection(p.Collection).Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    keys,
		Options: opts,
	})
	if err != nil {
		return "", fmt.Errorf("mongodb: create index: %w", err)
	}
	return name, nil
}

// DropIndex 按名称删除索引；默认主键索引 _id_ 拒绝删除。
func DropIndex(ctx context.Context, client *mongo.Client, database, collection, name string) error {
	if err := requireDBColl(database, collection); err != nil {
		return err
	}
	if name == "" {
		return fmt.Errorf("index name required")
	}
	if name == idIndexName {
		return fmt.Errorf("mongodb: cannot drop default index %s", idIndexName)
	}
	if _, err := client.Database(database).Collection(collection).Indexes().DropOne(ctx, name); err != nil {
		return fmt.Errorf("mongodb: drop index: %w", err)
	}
	return nil
}

// summarizeIndex 从 listIndexes 原始文档提取摘要字段。
func summarizeIndex(doc bson.D) (IndexInfo, error) {
	var info IndexInfo
	m := doc.Map()

	if name, ok := m["name"].(string); ok {
		info.Name = name
	}
	if unique, ok := m["unique"].(bool); ok {
		info.Unique = unique
	}
	if sparse, ok := m["sparse"].(bool); ok {
		info.Sparse = sparse
	}
	switch v := m["expireAfterSeconds"].(type) {
	case int32:
		info.ExpireAfterSeconds = &v
	case int64:
		n := int32(v)
		info.ExpireAfterSeconds = &n
	case float64:
		n := int32(v)
		info.ExpireAfterSeconds = &n
	}

	if keyDoc, ok := m["key"].(bson.D); ok {
		raw, err := bson.MarshalExtJSON(keyDoc, extJSONRelaxed, false)
		if err != nil {
			return info, fmt.Errorf("mongodb: marshal index keys: %w", err)
		}
		info.Keys = raw
	} else {
		info.Keys = json.RawMessage("{}")
	}

	raw, err := bson.MarshalExtJSON(doc, extJSONRelaxed, false)
	if err != nil {
		return info, fmt.Errorf("mongodb: marshal index: %w", err)
	}
	info.Raw = raw
	return info, nil
}

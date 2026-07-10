package session

import (
	"context"
	"encoding/json"
	"fmt"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	DefaultFindLimit = 50
	MaxFindLimit     = 1000
)

// FindParams 是 document.find 查询参数。
type FindParams struct {
	Database   string
	Collection string
	Filter     json.RawMessage
	Sort       json.RawMessage
	Projection json.RawMessage
	Skip       int64
	Limit      int64
}

// FindResult 是 document.find 返回结构。
type FindResult struct {
	Documents []json.RawMessage `json:"documents"`
	Total     *int64            `json:"total,omitempty"`
	HasMore   bool              `json:"hasMore"`
}

// FindDocuments 分页查询集合文档。
func FindDocuments(ctx context.Context, client *mongo.Client, p FindParams) (*FindResult, error) {
	if err := requireDBColl(p.Database, p.Collection); err != nil {
		return nil, err
	}
	filter, err := ParseOptionalFilter(p.Filter)
	if err != nil {
		return nil, err
	}
	sort, err := ParseOptionalSort(p.Sort)
	if err != nil {
		return nil, err
	}
	projection, err := ParseOptionalProjection(p.Projection)
	if err != nil {
		return nil, err
	}

	limit := p.Limit
	if limit <= 0 {
		limit = DefaultFindLimit
	}
	if limit > MaxFindLimit {
		limit = MaxFindLimit
	}

	coll := client.Database(p.Database).Collection(p.Collection)
	findOpts := options.Find().SetSkip(p.Skip).SetLimit(limit + 1)
	if sort != nil {
		findOpts.SetSort(sort)
	}
	if projection != nil {
		findOpts.SetProjection(projection)
	}

	cur, err := coll.Find(ctx, filter, findOpts)
	if err != nil {
		return nil, fmt.Errorf("mongodb: find: %w", err)
	}
	defer cur.Close(ctx)

	docs := make([]json.RawMessage, 0, limit)
	for cur.Next(ctx) {
		var doc bson.M
		if err := cur.Decode(&doc); err != nil {
			return nil, fmt.Errorf("mongodb: decode document: %w", err)
		}
		raw, err := MarshalDocument(doc)
		if err != nil {
			return nil, err
		}
		docs = append(docs, raw)
	}
	if err := cur.Err(); err != nil {
		return nil, fmt.Errorf("mongodb: iterate documents: %w", err)
	}

	hasMore := int64(len(docs)) > limit
	if hasMore {
		docs = docs[:limit]
	}

	result := &FindResult{
		Documents: docs,
		HasMore:   hasMore,
	}
	if p.Skip == 0 && len(filter) == 0 {
		count, err := coll.EstimatedDocumentCount(ctx)
		if err == nil {
			result.Total = &count
		}
	}
	return result, nil
}

// GetDocument 按 _id 读取单条文档。
func GetDocument(ctx context.Context, client *mongo.Client, database, collection string, idRaw json.RawMessage) (json.RawMessage, error) {
	if err := requireDBColl(database, collection); err != nil {
		return nil, err
	}
	id, err := ParseDocumentID(idRaw)
	if err != nil {
		return nil, err
	}
	var doc bson.M
	err = client.Database(database).Collection(collection).FindOne(ctx, bson.M{"_id": id}).Decode(&doc)
	if err != nil {
		return nil, fmt.Errorf("mongodb: get document: %w", err)
	}
	return MarshalDocument(doc)
}

// InsertDocument 插入文档并返回 insertedId。
func InsertDocument(ctx context.Context, client *mongo.Client, database, collection string, docRaw json.RawMessage) (json.RawMessage, error) {
	if err := requireDBColl(database, collection); err != nil {
		return nil, err
	}
	doc, err := ParseDocument(docRaw)
	if err != nil {
		return nil, err
	}
	res, err := client.Database(database).Collection(collection).InsertOne(ctx, doc)
	if err != nil {
		return nil, fmt.Errorf("mongodb: insert: %w", err)
	}
	idDoc := bson.M{"_id": res.InsertedID}
	return MarshalDocument(idDoc)
}

// UpdateDocument 替换文档（保留 _id）。
func UpdateDocument(ctx context.Context, client *mongo.Client, database, collection string, idRaw, docRaw json.RawMessage) (int64, int64, error) {
	if err := requireDBColl(database, collection); err != nil {
		return 0, 0, err
	}
	id, err := ParseDocumentID(idRaw)
	if err != nil {
		return 0, 0, err
	}
	doc, err := ParseDocument(docRaw)
	if err != nil {
		return 0, 0, err
	}
	doc["_id"] = id
	res, err := client.Database(database).Collection(collection).ReplaceOne(ctx, bson.M{"_id": id}, doc)
	if err != nil {
		return 0, 0, fmt.Errorf("mongodb: update: %w", err)
	}
	return res.MatchedCount, res.ModifiedCount, nil
}

// DeleteDocument 按 _id 删除文档。
func DeleteDocument(ctx context.Context, client *mongo.Client, database, collection string, idRaw json.RawMessage) (int64, error) {
	if err := requireDBColl(database, collection); err != nil {
		return 0, err
	}
	id, err := ParseDocumentID(idRaw)
	if err != nil {
		return 0, err
	}
	res, err := client.Database(database).Collection(collection).DeleteOne(ctx, bson.M{"_id": id})
	if err != nil {
		return 0, fmt.Errorf("mongodb: delete: %w", err)
	}
	return res.DeletedCount, nil
}

func requireDBColl(database, collection string) error {
	if database == "" {
		return fmt.Errorf("database required")
	}
	if collection == "" {
		return fmt.Errorf("collection required")
	}
	return nil
}

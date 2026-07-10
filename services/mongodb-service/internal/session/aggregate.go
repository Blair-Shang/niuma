package session

import (
	"context"
	"encoding/json"
	"fmt"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

// RunAggregate 执行聚合管道并返回文档列表。
func RunAggregate(ctx context.Context, client *mongo.Client, database, collection string, pipelineRaw json.RawMessage) ([]json.RawMessage, error) {
	if err := requireDBColl(database, collection); err != nil {
		return nil, err
	}
	stages, err := parsePipeline(pipelineRaw)
	if err != nil {
		return nil, err
	}
	cur, err := client.Database(database).Collection(collection).Aggregate(ctx, stages)
	if err != nil {
		return nil, fmt.Errorf("mongodb: aggregate: %w", err)
	}
	defer cur.Close(ctx)

	docs := make([]json.RawMessage, 0)
	for cur.Next(ctx) {
		var doc bson.M
		if err := cur.Decode(&doc); err != nil {
			return nil, fmt.Errorf("mongodb: decode aggregate result: %w", err)
		}
		raw, err := MarshalDocument(doc)
		if err != nil {
			return nil, err
		}
		docs = append(docs, raw)
	}
	if err := cur.Err(); err != nil {
		return nil, fmt.Errorf("mongodb: aggregate cursor: %w", err)
	}
	return docs, nil
}

// ExplainAggregate 对聚合管道执行 explain。
func ExplainAggregate(ctx context.Context, client *mongo.Client, database, collection string, pipelineRaw json.RawMessage) (json.RawMessage, error) {
	if err := requireDBColl(database, collection); err != nil {
		return nil, err
	}
	stages, err := parsePipeline(pipelineRaw)
	if err != nil {
		return nil, err
	}
	var explain bson.M
	err = client.Database(database).RunCommand(ctx, bson.D{
		{Key: "explain", Value: bson.D{
			{Key: "aggregate", Value: collection},
			{Key: "pipeline", Value: stages},
			{Key: "cursor", Value: bson.D{}},
		}},
	}).Decode(&explain)
	if err != nil {
		return nil, fmt.Errorf("mongodb: aggregate explain: %w", err)
	}
	return MarshalDocument(explain)
}

func parsePipeline(raw json.RawMessage) (bson.A, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("pipeline required")
	}
	var stages bson.A
	if err := bson.UnmarshalExtJSON(raw, true, &stages); err != nil {
		return nil, fmt.Errorf("mongodb: parse pipeline: %w", err)
	}
	if len(stages) == 0 {
		return nil, fmt.Errorf("pipeline must not be empty")
	}
	return stages, nil
}

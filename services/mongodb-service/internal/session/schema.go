package session

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const defaultSampleSize = 100

// SchemaField 是采样推断的字段信息。
type SchemaField struct {
	Path      string   `json:"path"`
	Types     []string `json:"types"`
	Frequency float64  `json:"frequency"`
}

type fieldAccumulator struct {
	types map[string]struct{}
	count int
}

// SampleSchema 对集合文档采样并推断字段类型分布。
func SampleSchema(ctx context.Context, client *mongo.Client, database, collection string, sampleSize int) ([]SchemaField, error) {
	if err := requireDBColl(database, collection); err != nil {
		return nil, err
	}
	if sampleSize <= 0 {
		sampleSize = defaultSampleSize
	}
	if sampleSize > MaxFindLimit {
		sampleSize = MaxFindLimit
	}

	cur, err := client.Database(database).Collection(collection).Find(
		ctx,
		bson.M{},
		options.Find().SetLimit(int64(sampleSize)),
	)
	if err != nil {
		return nil, fmt.Errorf("mongodb: schema sample: %w", err)
	}
	defer cur.Close(ctx)

	acc := make(map[string]*fieldAccumulator)
	total := 0
	for cur.Next(ctx) {
		var doc bson.M
		if err := cur.Decode(&doc); err != nil {
			return nil, fmt.Errorf("mongodb: decode sample: %w", err)
		}
		total++
		walkDocument("", doc, acc)
	}
	if err := cur.Err(); err != nil {
		return nil, fmt.Errorf("mongodb: schema sample cursor: %w", err)
	}
	if total == 0 {
		return []SchemaField{}, nil
	}

	fields := make([]SchemaField, 0, len(acc))
	for path, item := range acc {
		types := make([]string, 0, len(item.types))
		for t := range item.types {
			types = append(types, t)
		}
		sort.Strings(types)
		fields = append(fields, SchemaField{
			Path:      path,
			Types:     types,
			Frequency: float64(item.count) / float64(total),
		})
	}
	sort.Slice(fields, func(i, j int) bool { return fields[i].Path < fields[j].Path })
	return fields, nil
}

func walkDocument(prefix string, value any, acc map[string]*fieldAccumulator) {
	switch v := value.(type) {
	case bson.M:
		for key, child := range v {
			path := key
			if prefix != "" {
				path = prefix + "." + key
			}
			recordField(path, child, acc)
			walkDocument(path, child, acc)
		}
	case map[string]any:
		for key, child := range v {
			path := key
			if prefix != "" {
				path = prefix + "." + key
			}
			recordField(path, child, acc)
			walkDocument(path, child, acc)
		}
	case bson.A:
		for i, child := range v {
			path := fmt.Sprintf("%s[%d]", prefix, i)
			recordField(path, child, acc)
			walkDocument(path, child, acc)
		}
	case []any:
		for i, child := range v {
			path := fmt.Sprintf("%s[%d]", prefix, i)
			recordField(path, child, acc)
			walkDocument(path, child, acc)
		}
	default:
		if prefix != "" {
			recordField(prefix, v, acc)
		}
	}
}

func recordField(path string, value any, acc map[string]*fieldAccumulator) {
	if path == "" {
		return
	}
	item, ok := acc[path]
	if !ok {
		item = &fieldAccumulator{types: make(map[string]struct{})}
		acc[path] = item
	}
	item.count++
	item.types[bsonTypeName(value)] = struct{}{}
}

func bsonTypeName(value any) string {
	switch value.(type) {
	case nil:
		return "null"
	case bool:
		return "bool"
	case int, int32, int64, float32, float64:
		return "number"
	case string:
		return "string"
	case bson.M, map[string]any:
		return "object"
	case bson.A, []any:
		return "array"
	case primitive.DateTime:
		return "date"
	case primitive.ObjectID:
		return "objectId"
	default:
		name := fmt.Sprintf("%T", value)
		if idx := strings.LastIndex(name, "."); idx >= 0 {
			name = name[idx+1:]
		}
		return strings.ToLower(name)
	}
}

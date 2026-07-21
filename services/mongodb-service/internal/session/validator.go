package session

import (
	"context"
	"encoding/json"
	"fmt"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

// CollectionValidator 是集合文档校验规则。
type CollectionValidator struct {
	Validator        json.RawMessage `json:"validator,omitempty"`
	ValidationLevel  string          `json:"validationLevel,omitempty"`
	ValidationAction string          `json:"validationAction,omitempty"`
}

// GetCollectionValidator 读取集合 collMod 校验配置。
func GetCollectionValidator(ctx context.Context, client *mongo.Client, database, collection string) (*CollectionValidator, error) {
	if err := requireDBColl(database, collection); err != nil {
		return nil, err
	}

	cur, err := client.Database(database).ListCollections(ctx, bson.M{"name": collection})
	if err != nil {
		return nil, fmt.Errorf("mongodb: list collection validator: %w", err)
	}
	defer cur.Close(ctx)

	if !cur.Next(ctx) {
		return &CollectionValidator{}, nil
	}

	var spec struct {
		Options struct {
			Validator        bson.M `bson:"validator"`
			ValidationLevel  string `bson:"validationLevel"`
			ValidationAction string `bson:"validationAction"`
		} `bson:"options"`
	}
	if err := cur.Decode(&spec); err != nil {
		return nil, fmt.Errorf("mongodb: decode collection validator: %w", err)
	}
	if err := cur.Err(); err != nil {
		return nil, fmt.Errorf("mongodb: list collection validator cursor: %w", err)
	}

	out := &CollectionValidator{
		ValidationLevel:  spec.Options.ValidationLevel,
		ValidationAction: spec.Options.ValidationAction,
	}
	if len(spec.Options.Validator) > 0 {
		raw, err := MarshalDocument(spec.Options.Validator)
		if err != nil {
			return nil, fmt.Errorf("mongodb: marshal validator: %w", err)
		}
		out.Validator = raw
	}
	return out, nil
}

// SetCollectionValidatorParams 是写入集合校验规则的参数。
type SetCollectionValidatorParams struct {
	Database         string
	Collection       string
	Validator        json.RawMessage
	ValidationLevel  string
	ValidationAction string
}

// SetCollectionValidator 通过 collMod 写入或更新集合校验规则。
func SetCollectionValidator(ctx context.Context, client *mongo.Client, params SetCollectionValidatorParams) error {
	if err := requireDBColl(params.Database, params.Collection); err != nil {
		return err
	}

	cmd := bson.D{{Key: "collMod", Value: params.Collection}}
	if len(params.Validator) > 0 {
		doc, err := ParseDocument(params.Validator)
		if err != nil {
			return fmt.Errorf("mongodb: validator: %w", err)
		}
		cmd = append(cmd, bson.E{Key: "validator", Value: doc})
	}
	if params.ValidationLevel != "" {
		cmd = append(cmd, bson.E{Key: "validationLevel", Value: params.ValidationLevel})
	}
	if params.ValidationAction != "" {
		cmd = append(cmd, bson.E{Key: "validationAction", Value: params.ValidationAction})
	}

	if err := client.Database(params.Database).RunCommand(ctx, cmd).Err(); err != nil {
		return fmt.Errorf("mongodb: collMod validator: %w", err)
	}
	return nil
}

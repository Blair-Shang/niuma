package session

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

const (
	maxDatabaseNameRunes   = 64
	maxCollectionNameRunes = 255
)

// protectedDatabases 是 MongoDB 系统库，禁止用户新建或重命名。
var protectedDatabases = map[string]struct{}{
	"admin":  {},
	"local":  {},
	"config": {},
}

// collectionSpec 是轻量集合描述（仅 name / type）。
type collectionSpec struct {
	Name string
	Type string
}

// CreateDatabaseParams 是 catalog.createDatabase 参数。
// MongoDB 没有独立 CREATE DATABASE：必须同时创建首个集合，库才会落盘可见。
type CreateDatabaseParams struct {
	Database   string
	Collection string
}

// RenameCollectionParams 是 catalog.renameCollection 参数。
type RenameCollectionParams struct {
	Database string
	From     string
	To       string
}

// RenameDatabaseParams 是 catalog.renameDatabase 参数。
type RenameDatabaseParams struct {
	From string
	To   string
}

// IsProtectedDatabase 判断是否为系统库。
func IsProtectedDatabase(name string) bool {
	_, ok := protectedDatabases[strings.TrimSpace(name)]
	return ok
}

// ValidateDatabaseName 校验用户库名（新建 / 重命名目标）。
func ValidateDatabaseName(name string) error {
	n := strings.TrimSpace(name)
	if n == "" {
		return fmt.Errorf("mongodb: database name required")
	}
	if utf8.RuneCountInString(n) > maxDatabaseNameRunes {
		return fmt.Errorf("mongodb: database name too long")
	}
	if IsProtectedDatabase(n) {
		return fmt.Errorf("mongodb: database %q is reserved", n)
	}
	if strings.ContainsAny(n, "/\\.\"$ \x00") {
		return fmt.Errorf("mongodb: invalid database name")
	}
	return nil
}

// ValidateCollectionName 校验用户集合名。
func ValidateCollectionName(name string) error {
	n := strings.TrimSpace(name)
	if n == "" {
		return fmt.Errorf("mongodb: collection name required")
	}
	if utf8.RuneCountInString(n) > maxCollectionNameRunes {
		return fmt.Errorf("mongodb: collection name too long")
	}
	if strings.HasPrefix(n, "system.") {
		return fmt.Errorf("mongodb: cannot use system collection name")
	}
	if strings.ContainsAny(n, "$\x00") {
		return fmt.Errorf("mongodb: invalid collection name")
	}
	return nil
}

// CreateDatabase 在新库上创建首个集合，使数据库出现在 listDatabases 中。
func CreateDatabase(ctx context.Context, client *mongo.Client, p CreateDatabaseParams) error {
	database := strings.TrimSpace(p.Database)
	collection := strings.TrimSpace(p.Collection)
	if err := ValidateDatabaseName(database); err != nil {
		return err
	}
	if err := ValidateCollectionName(collection); err != nil {
		return err
	}
	exists, err := databaseExists(ctx, client, database)
	if err != nil {
		return err
	}
	if exists {
		return fmt.Errorf("mongodb: database %q already exists", database)
	}
	if err := client.Database(database).CreateCollection(ctx, collection); err != nil {
		return fmt.Errorf("mongodb: create database: %w", err)
	}
	return nil
}

// RenameCollection 在同一库内重命名集合（不支持 view）。
func RenameCollection(ctx context.Context, client *mongo.Client, p RenameCollectionParams) error {
	database := strings.TrimSpace(p.Database)
	from := strings.TrimSpace(p.From)
	to := strings.TrimSpace(p.To)
	if database == "" {
		return fmt.Errorf("mongodb: database required")
	}
	if err := ValidateCollectionName(from); err != nil {
		return err
	}
	if err := ValidateCollectionName(to); err != nil {
		return err
	}
	if from == to {
		return fmt.Errorf("mongodb: new collection name must differ")
	}
	spec, err := findCollectionSpec(ctx, client, database, from)
	if err != nil {
		return err
	}
	if spec.Type != "" && spec.Type != "collection" {
		return fmt.Errorf("mongodb: cannot rename %s %q", spec.Type, from)
	}
	if err := renameNamespace(ctx, client, database+"."+from, database+"."+to); err != nil {
		return fmt.Errorf("mongodb: rename collection: %w", err)
	}
	return nil
}

// RenameDatabase 通过 admin.renameCollection 把全部普通集合迁到新库，再删除旧库。
// 旧库含 view / timeseries 时拒绝，避免半迁移。
func RenameDatabase(ctx context.Context, client *mongo.Client, p RenameDatabaseParams) error {
	from := strings.TrimSpace(p.From)
	to := strings.TrimSpace(p.To)
	if from == "" {
		return fmt.Errorf("mongodb: database required")
	}
	if IsProtectedDatabase(from) {
		return fmt.Errorf("mongodb: cannot rename reserved database %q", from)
	}
	if err := ValidateDatabaseName(to); err != nil {
		return err
	}
	if from == to {
		return fmt.Errorf("mongodb: new database name must differ")
	}
	exists, err := databaseExists(ctx, client, to)
	if err != nil {
		return err
	}
	if exists {
		return fmt.Errorf("mongodb: database %q already exists", to)
	}

	specs, err := listCollectionSpecs(ctx, client, from)
	if err != nil {
		return err
	}
	movable := make([]collectionSpec, 0, len(specs))
	for _, spec := range specs {
		if strings.HasPrefix(spec.Name, "system.") {
			continue
		}
		if spec.Type != "" && spec.Type != "collection" {
			return fmt.Errorf("mongodb: cannot rename database %q: contains %s %q", from, spec.Type, spec.Name)
		}
		if err := ValidateCollectionName(spec.Name); err != nil {
			return err
		}
		movable = append(movable, spec)
	}
	if len(movable) == 0 {
		return fmt.Errorf("mongodb: database %q has no collections to rename", from)
	}

	for _, spec := range movable {
		if err := renameNamespace(ctx, client, from+"."+spec.Name, to+"."+spec.Name); err != nil {
			return fmt.Errorf("mongodb: rename database: move %q: %w", spec.Name, err)
		}
	}
	if err := client.Database(from).Drop(ctx); err != nil {
		return fmt.Errorf("mongodb: rename database: drop %q: %w", from, err)
	}
	return nil
}

func renameNamespace(ctx context.Context, client *mongo.Client, fromNS, toNS string) error {
	cmd := bson.D{
		{Key: "renameCollection", Value: fromNS},
		{Key: "to", Value: toNS},
	}
	if err := client.Database("admin").RunCommand(ctx, cmd).Err(); err != nil {
		return err
	}
	return nil
}

func databaseExists(ctx context.Context, client *mongo.Client, name string) (bool, error) {
	names, err := client.ListDatabaseNames(ctx, bson.M{"name": name})
	if err != nil {
		return false, fmt.Errorf("mongodb: list databases: %w", err)
	}
	return len(names) > 0, nil
}

func listCollectionSpecs(ctx context.Context, client *mongo.Client, database string) ([]collectionSpec, error) {
	if strings.TrimSpace(database) == "" {
		return nil, fmt.Errorf("mongodb: database required")
	}
	cursor, err := client.Database(database).ListCollections(ctx, bson.M{})
	if err != nil {
		return nil, fmt.Errorf("mongodb: list collections: %w", err)
	}
	defer func() { _ = cursor.Close(ctx) }()

	out := make([]collectionSpec, 0)
	for cursor.Next(ctx) {
		var spec struct {
			Name string `bson:"name"`
			Type string `bson:"type"`
		}
		if err := cursor.Decode(&spec); err != nil {
			continue
		}
		if spec.Type == "" {
			spec.Type = "collection"
		}
		out = append(out, collectionSpec{Name: spec.Name, Type: spec.Type})
	}
	if err := cursor.Err(); err != nil {
		return nil, fmt.Errorf("mongodb: list collections cursor: %w", err)
	}
	return out, nil
}

func findCollectionSpec(ctx context.Context, client *mongo.Client, database, name string) (collectionSpec, error) {
	specs, err := listCollectionSpecs(ctx, client, database)
	if err != nil {
		return collectionSpec{}, err
	}
	for _, spec := range specs {
		if spec.Name == name {
			return spec, nil
		}
	}
	return collectionSpec{}, fmt.Errorf("mongodb: collection %q not found", name)
}

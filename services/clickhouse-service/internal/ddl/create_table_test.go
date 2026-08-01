package ddl

import (
	"strings"
	"testing"
)

func TestBuildCreateTableSQL(t *testing.T) {
	sqls, err := BuildCreateTableSQL(CreateTableParams{
		Database: "default",
		Name:     "events",
		Columns: []CreateTableColumn{
			{Name: "id", DataType: "UInt64"},
			{Name: "msg", DataType: "String", Comment: "body"},
		},
		Engine:  "MergeTree",
		OrderBy: "id",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(sqls) != 1 {
		t.Fatalf("want 1 stmt, got %d", len(sqls))
	}
	s := sqls[0]
	for _, want := range []string{
		"CREATE TABLE `default`.`events`",
		"`id` UInt64",
		"`msg` String COMMENT 'body'",
		"ENGINE = MergeTree",
		"ORDER BY id",
	} {
		if !strings.Contains(s, want) {
			t.Fatalf("missing %q in:\n%s", want, s)
		}
	}
}

func TestBuildCreateTableSQLRequiresOrderBy(t *testing.T) {
	_, err := BuildCreateTableSQL(CreateTableParams{
		Database: "default",
		Name:     "t",
		Columns:  []CreateTableColumn{{Name: "id", DataType: "UInt64"}},
	})
	if err == nil {
		t.Fatal("expected orderBy error")
	}
}

func TestPreviewDesignAddColumn(t *testing.T) {
	res, err := PreviewDesign(DesignPreviewParams{
		Database: "db",
		Name:     "t",
		Ops: []DesignOp{{
			Op:       DesignAddColumn,
			Name:     "x",
			DataType: "Int32",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.SQL) != 1 || !strings.Contains(res.SQL[0], "ADD COLUMN `x` Int32") {
		t.Fatalf("unexpected: %#v", res.SQL)
	}
}

func TestPreviewDesignOnClusterAndOrderBy(t *testing.T) {
	res, err := PreviewDesign(DesignPreviewParams{
		Database: "db",
		Name:     "t",
		Cluster:  "my_cluster",
		Ops: []DesignOp{
			{Op: DesignSetOrderBy, Expression: "id"},
			{Op: DesignAddColumn, Name: "y", DataType: "String"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.SQL) != 2 {
		t.Fatalf("want 2 stmts, got %#v", res.SQL)
	}
	if !strings.Contains(res.SQL[0], "ON CLUSTER `my_cluster`") || !strings.Contains(res.SQL[0], "MODIFY ORDER BY id") {
		t.Fatalf("order by: %s", res.SQL[0])
	}
	if !strings.Contains(res.SQL[1], "ON CLUSTER `my_cluster`") || !strings.Contains(res.SQL[1], "ADD COLUMN `y` String") {
		t.Fatalf("add column: %s", res.SQL[1])
	}
}

func TestBuildCreateTableSQLOnCluster(t *testing.T) {
	sqls, err := BuildCreateTableSQL(CreateTableParams{
		Database: "default",
		Name:     "events",
		Columns:  []CreateTableColumn{{Name: "id", DataType: "UInt64"}},
		Engine:   "MergeTree",
		OrderBy:  "id",
		Cluster:  "c1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sqls[0], "CREATE TABLE `default`.`events` ON CLUSTER `c1`") {
		t.Fatalf("missing ON CLUSTER: %s", sqls[0])
	}
}

func TestPreviewDesignAddDropIndex(t *testing.T) {
	res, err := PreviewDesign(DesignPreviewParams{
		Database: "db",
		Name:     "t",
		Ops: []DesignOp{
			{
				Op:          DesignAddIndex,
				Name:        "idx_minmax",
				Expression:  "id",
				Type:        "minmax",
				Granularity: 4,
			},
			{Op: DesignDropIndex, Name: "old_idx"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.SQL) != 2 {
		t.Fatalf("want 2 stmts, got %#v", res.SQL)
	}
	if !strings.Contains(res.SQL[0], "ADD INDEX `idx_minmax` id TYPE minmax GRANULARITY 4") {
		t.Fatalf("add index: %s", res.SQL[0])
	}
	if !strings.Contains(res.SQL[1], "DROP INDEX `old_idx`") {
		t.Fatalf("drop index: %s", res.SQL[1])
	}
}

func TestBuildCreateTableSQLWithIndex(t *testing.T) {
	sqls, err := BuildCreateTableSQL(CreateTableParams{
		Database: "db",
		Name:     "t",
		Columns:  []CreateTableColumn{{Name: "id", DataType: "UInt64"}},
		Indexes: []CreateTableIndex{{
			Name:        "idx_id",
			Expression:  "id",
			Type:        "minmax",
			Granularity: 2,
		}},
		OrderBy: "id",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sqls[0], "INDEX `idx_id` id TYPE minmax GRANULARITY 2") {
		t.Fatalf("missing index clause: %s", sqls[0])
	}
}

func TestBuildCreateTableSQLProfessionalClauses(t *testing.T) {
	sqls, err := BuildCreateTableSQL(CreateTableParams{
		Database: "analytics",
		Name:     "events",
		Columns: []CreateTableColumn{
			{Name: "dt", DataType: "DateTime"},
			{Name: "id", DataType: "UInt64", Codec: "ZSTD"},
			{Name: "msg", DataType: "Nullable(String)", Comment: "body"},
		},
		Engine:      "ReplacingMergeTree(ver)",
		OrderBy:     "(dt, id)",
		PartitionBy: "toYYYYMM(dt)",
		PrimaryKey:  "(dt, id)",
		SampleBy:    "id",
		TTL:         "dt + INTERVAL 90 DAY",
		Settings:    "index_granularity = 8192",
		Comment:     "events",
	})
	if err != nil {
		t.Fatal(err)
	}
	s := sqls[0]
	for _, want := range []string{
		"`id` UInt64 CODEC(ZSTD)",
		"`msg` Nullable(String) COMMENT 'body'",
		"ENGINE = ReplacingMergeTree(ver)",
		"ORDER BY (dt, id)",
		"PARTITION BY toYYYYMM(dt)",
		"PRIMARY KEY (dt, id)",
		"SAMPLE BY id",
		"TTL dt + INTERVAL 90 DAY",
		"SETTINGS index_granularity = 8192",
		"COMMENT 'events'",
	} {
		if !strings.Contains(s, want) {
			t.Fatalf("missing %q in:\n%s", want, s)
		}
	}
}

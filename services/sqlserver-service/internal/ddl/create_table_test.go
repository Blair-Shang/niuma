package ddl

import (
	"strings"
	"testing"
)

func TestBuildCreateTableSQL_IdentityAndComment(t *testing.T) {
	def := "0"
	sqls, err := BuildCreateTableSQL(CreateTableParams{
		Schema: "dbo",
		Name:   "Users",
		Columns: []CreateTableColumn{
			{Name: "Id", DataType: "int", Nullable: false, AutoIncrement: true, PrimaryKey: true},
			{Name: "Name", DataType: "nvarchar(50)", Nullable: false, Comment: "显示名"},
			{Name: "Age", DataType: "int", Nullable: true, Default: &def},
		},
		Comment: "用户表",
		Indexes: []CreateTableIndex{
			{Name: "IX_Users_Name", Columns: []string{"Name"}, Unique: true, Method: "NONCLUSTERED"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(sqls, "\n")
	if !strings.Contains(joined, "CREATE TABLE [dbo].[Users]") {
		t.Fatalf("missing CREATE TABLE: %s", joined)
	}
	if !strings.Contains(joined, "[Id] int IDENTITY(1,1) NOT NULL") {
		t.Fatalf("missing IDENTITY: %s", joined)
	}
	if !strings.Contains(joined, "CONSTRAINT [PK_Users] PRIMARY KEY") {
		t.Fatalf("missing PK: %s", joined)
	}
	if !strings.Contains(joined, "sp_addextendedproperty") {
		t.Fatalf("missing extended property: %s", joined)
	}
	if !strings.Contains(joined, "CREATE UNIQUE NONCLUSTERED INDEX [IX_Users_Name]") {
		t.Fatalf("missing index: %s", joined)
	}
}

func TestPreviewDesign_AddColumnAndRename(t *testing.T) {
	preview, err := PreviewDesign(DesignPreviewParams{
		Schema: "dbo",
		Name:   "Users",
		Ops: []DesignOp{
			{Op: DesignAddColumn, Name: "Email", DataType: "nvarchar(100)", Comment: "邮箱"},
			{Op: DesignRenameColumn, Name: "Name", NewName: "DisplayName", DataType: "nvarchar(80)"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(preview.SQL, "\n")
	if !strings.Contains(joined, "ALTER TABLE [dbo].[Users] ADD [Email] nvarchar(100) NULL") {
		t.Fatalf("missing add column: %s", joined)
	}
	if !strings.Contains(joined, "sp_rename") || !strings.Contains(joined, "N'COLUMN'") {
		t.Fatalf("missing rename: %s", joined)
	}
	if !strings.Contains(joined, "ALTER COLUMN [DisplayName] nvarchar(80)") {
		t.Fatalf("missing alter after rename: %s", joined)
	}
}

func TestPreviewDesign_AddIdentityColumn(t *testing.T) {
	preview, err := PreviewDesign(DesignPreviewParams{
		Schema: "dbo",
		Name:   "Users",
		Ops: []DesignOp{
			{Op: DesignAddColumn, Name: "Seq", DataType: "int", AutoIncrement: true},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(preview.SQL, "\n")
	if !strings.Contains(joined, "ADD [Seq] int IDENTITY(1,1) NOT NULL") {
		t.Fatalf("missing identity add: %s", joined)
	}
}

func TestQuoteIdent_Brackets(t *testing.T) {
	if got := QuoteIdent("a]b"); got != "[a]]b]" {
		t.Fatalf("got %s", got)
	}
}

func TestFormatDefaultExpr(t *testing.T) {
	if got := FormatDefaultExpr("hello"); got != "N'hello'" {
		t.Fatalf("got %s", got)
	}
	if got := FormatDefaultExpr("GETDATE()"); got != "GETDATE()" {
		t.Fatalf("got %s", got)
	}
}

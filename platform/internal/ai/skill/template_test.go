package skill

import "testing"

func TestApplySkillTemplate_defaults(t *testing.T) {
	tpl := "分析库 {{database}} 的慢查询，阈值 {{threshold}}ms。"
	schema := `{
  "type":"object",
  "properties":{
    "database":{"type":"string","default":"appdb"},
    "threshold":{"type":"number","default":500}
  }
}`
	got := ApplyTemplate(tpl, schema)
	want := "分析库 appdb 的慢查询，阈值 500ms。"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestApplySkillTemplate_keepsMissing(t *testing.T) {
	got := ApplyTemplate("hello {{name}}", `{"properties":{}}`)
	if got != "hello {{name}}" {
		t.Fatalf("got %q", got)
	}
}

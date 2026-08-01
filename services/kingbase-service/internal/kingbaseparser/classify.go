package kingbaseparser

import "strings"

// StmtKind 语句分类（工作级，非完整文法）。
type StmtKind int

const (
	StmtEmpty StmtKind = iota
	StmtUnknown
	StmtSelect
	StmtInsert
	StmtUpdate
	StmtDelete
	StmtMerge
	StmtCreateTable
	StmtCreateView
	StmtCreateIndex
	StmtCreateSequence
	StmtCreateProc
	StmtCreateFunc
	StmtCreateOther
	StmtAlter
	StmtDrop
	StmtPLAnon // 匿名 BEGIN…END 块
	StmtExplain
	StmtCall
	StmtOtherDML // TRUNCATE 等
)

func (k StmtKind) String() string {
	switch k {
	case StmtEmpty:
		return "empty"
	case StmtSelect:
		return "select"
	case StmtInsert:
		return "insert"
	case StmtUpdate:
		return "update"
	case StmtDelete:
		return "delete"
	case StmtMerge:
		return "merge"
	case StmtCreateTable:
		return "create_table"
	case StmtCreateView:
		return "create_view"
	case StmtCreateIndex:
		return "create_index"
	case StmtCreateSequence:
		return "create_sequence"
	case StmtCreateProc:
		return "create_procedure"
	case StmtCreateFunc:
		return "create_function"
	case StmtCreateOther:
		return "create_other"
	case StmtAlter:
		return "alter"
	case StmtDrop:
		return "drop"
	case StmtPLAnon:
		return "pl_anon"
	case StmtExplain:
		return "explain"
	case StmtCall:
		return "call"
	case StmtOtherDML:
		return "other_kbl"
	default:
		return "unknown"
	}
}

// Classify 对单条语句做首关键字分类（半成品友好）。
func Classify(text string) StmtKind {
	s := strings.TrimSpace(text)
	if s == "" {
		return StmtEmpty
	}
	i := skipLeadingNoise(s)
	if i >= len(s) {
		return StmtEmpty
	}

	switch {
	case matchKeywordAt(s, i, "select"), matchKeywordAt(s, i, "with"):
		return StmtSelect
	case matchKeywordAt(s, i, "insert"):
		return StmtInsert
	case matchKeywordAt(s, i, "update"):
		return StmtUpdate
	case matchKeywordAt(s, i, "delete"):
		return StmtDelete
	case matchKeywordAt(s, i, "merge"):
		return StmtMerge
	case matchKeywordAt(s, i, "explain"):
		return StmtExplain
	case matchKeywordAt(s, i, "call"):
		return StmtCall
	case matchKeywordAt(s, i, "truncate"):
		return StmtOtherDML
	case matchKeywordAt(s, i, "alter"):
		return StmtAlter
	case matchKeywordAt(s, i, "drop"):
		return StmtDrop
	case matchKeywordAt(s, i, "begin"):
		return StmtPLAnon
	case matchKeywordAt(s, i, "declare"):
		// DECLARE … BEGIN … 匿名块
		return StmtPLAnon
	case matchKeywordAt(s, i, "create"):
		return classifyCreate(s, i)
	default:
		return StmtUnknown
	}
}

func classifyCreate(s string, createAt int) StmtKind {
	i := skipWSAndComments(s, createAt+6)
	if matchKeywordAt(s, i, "or") {
		i = skipWSAndComments(s, i+2)
		if matchKeywordAt(s, i, "replace") {
			i = skipWSAndComments(s, i+7)
		}
	}
	switch {
	case matchKeywordAt(s, i, "procedure"):
		return StmtCreateProc
	case matchKeywordAt(s, i, "function"):
		return StmtCreateFunc
	case matchKeywordAt(s, i, "table"):
		return StmtCreateTable
	case matchKeywordAt(s, i, "view"):
		return StmtCreateView
	case matchKeywordAt(s, i, "index"), matchKeywordAt(s, i, "unique"):
		return StmtCreateIndex
	case matchKeywordAt(s, i, "sequence"):
		return StmtCreateSequence
	default:
		return StmtCreateOther
	}
}

// isRoutineDDL 是否 CREATE PROCEDURE/FUNCTION。
func isRoutineDDL(text string) bool {
	k := Classify(text)
	return k == StmtCreateProc || k == StmtCreateFunc
}

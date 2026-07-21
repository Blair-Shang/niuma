package session

import (
	"strings"
	"unicode"
)

type queryContextKind string

const (
	queryCtxUnknown        queryContextKind = "unknown"
	queryCtxTopLevel       queryContextKind = "top-level"
	queryCtxDbMember       queryContextKind = "db-member"
	queryCtxCollection     queryContextKind = "collection"
	queryCtxCollectionCall queryContextKind = "collection-call"
	queryCtxCursorChain    queryContextKind = "cursor-chain"
	queryCtxFilterKey      queryContextKind = "filter-key"
	queryCtxFilterOperator queryContextKind = "filter-operator"
	queryCtxPipeline       queryContextKind = "pipeline"
)

type queryCursorState struct {
	kind             queryContextKind
	prefix           string
	targetCollection string
	insideString     bool
	pipelineText     string
	pipelineOffset   int
}

func scanQueryCursor(text string, offset int) queryCursorState {
	if offset < 0 {
		offset = 0
	}
	if offset > len(text) {
		offset = len(text)
	}
	head := text[:offset]
	prefix := queryPrefixAt(text, offset)
	state := queryCursorState{
		prefix: prefix,
	}
	if pipeline, relOffset, ok := extractPipelineContext(head); ok {
		state.kind = queryCtxPipeline
		state.pipelineText = pipeline
		state.pipelineOffset = relOffset
		state.targetCollection = resolveQueryCollection(head)
		return state
	}
	if filterText, relOffset, ok := extractFilterContext(head); ok {
		state.targetCollection = resolveQueryCollection(head)
		cursor := scanPipelineCursor(filterText, relOffset)
		state.insideString = cursor.insideString
		if cursor.insideString {
			role := pipelineStringRole(filterText, relOffset)
			switch role {
			case "key":
				if strings.HasPrefix(prefix, "$") {
					state.kind = queryCtxFilterOperator
				} else {
					state.kind = queryCtxFilterKey
				}
			case "value":
				if strings.HasPrefix(prefix, "$") {
					state.kind = queryCtxFilterOperator
				}
			}
			return state
		}
	}
	if isMemberAccessContext(head) {
		target := resolveQueryCollection(head)
		if target != "" {
			state.targetCollection = target
		}
		if isCursorChainContext(head) {
			state.kind = queryCtxCursorChain
			return state
		}
		if target != "" {
			state.kind = queryCtxCollectionCall
			return state
		}
		state.kind = queryCtxDbMember
		return state
	}
	if isPartialMemberAccess(head) {
		if isCursorChainContext(head) {
			state.targetCollection = resolveQueryCollection(head)
			state.kind = queryCtxCursorChain
			return state
		}
		// db.getc → db 下单段成员（方法/集合名），不是 collection-call
		if hasCompletedCollectionRef(head) {
			state.targetCollection = resolveQueryCollection(head)
			state.kind = queryCtxCollectionCall
			return state
		}
		state.kind = queryCtxDbMember
		return state
	}
	if strings.HasSuffix(strings.TrimSpace(head), "db.") {
		state.kind = queryCtxDbMember
		return state
	}
	// 顶层助手：show / use / help，或尚未出现 db. 成员访问的行首输入
	if isTopLevelShellContext(head) {
		state.kind = queryCtxTopLevel
		state.prefix = shellStatementPrefix(head)
		return state
	}
	return state
}

func queryPrefixAt(text string, offset int) string {
	if offset <= 0 {
		return ""
	}
	start := offset - 1
	for start >= 0 {
		ch := text[start]
		if ch == '"' || ch == '\'' {
			return ""
		}
		if !isQueryPrefixChar(ch) {
			break
		}
		start--
	}
	return text[start+1 : offset]
}

func isQueryPrefixChar(ch byte) bool {
	// 不含 '.'：db. / coll. 之后前缀应为空，否则会把 "db." 拿去过滤候选导致无提示
	return ch == '$' || ch == '_' || unicode.IsLetter(rune(ch)) || unicode.IsDigit(rune(ch))
}

// isTopLevelShellContext 判断光标是否在 mongosh 顶层语句中（非 db.xxx 表达式）。
func isTopLevelShellContext(head string) bool {
	stmt := shellStatementPrefix(head)
	if stmt == "" {
		return true
	}
	lower := strings.ToLower(stmt)
	if strings.HasPrefix(lower, "show") ||
		strings.HasPrefix(lower, "use") ||
		strings.HasPrefix(lower, "help") ||
		strings.HasPrefix(lower, "exit") ||
		strings.HasPrefix(lower, "it") {
		return true
	}
	// 尚未进入 db. / getCollection 表达式
	if strings.Contains(stmt, ".") || strings.Contains(stmt, "(") || strings.Contains(stmt, "{") {
		return false
	}
	return true
}

// shellStatementPrefix 返回当前语句从前到光标的文本（支持 show da 这类多词前缀）。
func shellStatementPrefix(head string) string {
	start := 0
	for i := len(head) - 1; i >= 0; i-- {
		ch := head[i]
		if ch == '\n' || ch == '\r' || ch == ';' {
			start = i + 1
			break
		}
	}
	return strings.TrimLeft(head[start:], " \t")
}

func isMemberAccessContext(head string) bool {
	trimmed := strings.TrimRight(head, " \t\r\n")
	return strings.HasSuffix(trimmed, ".")
}

func isPartialMemberAccess(head string) bool {
	trimmed := strings.TrimRight(head, " \t\r\n")
	if trimmed == "" {
		return false
	}
	lastDot := strings.LastIndex(trimmed, ".")
	if lastDot < 0 {
		return false
	}
	suffix := trimmed[lastDot+1:]
	if suffix == "" {
		return false
	}
	for i := 0; i < len(suffix); i++ {
		ch := suffix[i]
		if !(unicode.IsLetter(rune(ch)) || unicode.IsDigit(rune(ch)) || ch == '_') {
			return false
		}
	}
	return true
}

// hasCompletedCollectionRef 判断是否已写出完整集合引用后再跟成员名。
// db.users.fin / db.getCollection('x').fin → true；db.getc → false。
func hasCompletedCollectionRef(head string) bool {
	trimmed := strings.TrimRight(head, " \t\r\n")
	lower := strings.ToLower(trimmed)
	if idx := strings.LastIndex(lower, "getcollection("); idx >= 0 {
		rest := trimmed[idx+len("getcollection("):]
		depth := 1
		closed := -1
		inStr := false
		var quote byte
		for i := 0; i < len(rest); i++ {
			ch := rest[i]
			if inStr {
				if ch == '\\' {
					i++
					continue
				}
				if ch == quote {
					inStr = false
				}
				continue
			}
			if ch == '\'' || ch == '"' {
				inStr = true
				quote = ch
				continue
			}
			if ch == '(' {
				depth++
			}
			if ch == ')' {
				depth--
				if depth == 0 {
					closed = i
					break
				}
			}
		}
		if closed < 0 {
			return false
		}
		after := strings.TrimLeft(rest[closed+1:], " \t")
		return strings.HasPrefix(after, ".")
	}
	dbIdx := strings.LastIndex(lower, "db.")
	if dbIdx < 0 {
		return false
	}
	rest := trimmed[dbIdx+3:]
	// 去掉尾部正在输入的成员名，看中间是否还有一段集合名 + '.'
	lastDot := strings.LastIndex(rest, ".")
	if lastDot <= 0 {
		return false
	}
	coll := rest[:lastDot]
	coll = strings.TrimSpace(coll)
	if coll == "" || strings.ContainsAny(coll, "()") {
		return false
	}
	// coll 本身不应再含未配对括号
	return true
}

func isCursorChainContext(head string) bool {
	lower := strings.ToLower(head)
	for _, marker := range []string{".find(", ".findone(", ".aggregate(", ".distinct("} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func resolveQueryCollection(head string) string {
	if coll := parseGetCollectionName(head); coll != "" {
		return coll
	}
	return parseDbDotCollection(head)
}

func parseGetCollectionName(head string) string {
	lower := strings.ToLower(head)
	idx := strings.LastIndex(lower, "getcollection(")
	if idx < 0 {
		return ""
	}
	rest := head[idx+len("getcollection("):]
	rest = strings.TrimLeft(rest, " \t\r\n")
	if len(rest) == 0 {
		return ""
	}
	quote := rest[0]
	if quote != '\'' && quote != '"' {
		return ""
	}
	end := strings.IndexByte(rest[1:], quote)
	if end < 0 {
		return ""
	}
	return rest[1 : end+1]
}

func parseDbDotCollection(head string) string {
	lower := strings.ToLower(head)
	dbIdx := strings.LastIndex(lower, "db.")
	if dbIdx < 0 {
		return ""
	}
	rest := head[dbIdx+3:]
	rest = strings.TrimLeft(rest, " \t\r\n")
	if len(rest) == 0 {
		return ""
	}
	end := 0
	for end < len(rest) && (isQueryPrefixChar(rest[end]) && rest[end] != '.') {
		end++
	}
	if end == 0 {
		return ""
	}
	name := rest[:end]
	reserved := map[string]struct{}{
		"getcollection": {},
		"getsiblingdb":  {},
		"runcommand":    {},
		"stats":         {},
		"admincommand":  {},
	}
	if _, ok := reserved[strings.ToLower(name)]; ok {
		return ""
	}
	return name
}

func extractBalancedSegment(text string, open, close byte) (segment string, start int, ok bool) {
	idx := strings.LastIndexByte(text, open)
	if idx < 0 {
		return "", -1, false
	}
	depth := 0
	inString := false
	escaped := false
	var quote byte
	for i := idx; i < len(text); i++ {
		ch := text[i]
		if inString {
			if escaped {
				escaped = false
				continue
			}
			if ch == '\\' {
				escaped = true
				continue
			}
			if ch == quote {
				inString = false
			}
			continue
		}
		switch ch {
		case '\'', '"':
			inString = true
			quote = ch
		case open:
			depth++
		case close:
			depth--
			if depth == 0 {
				return text[idx : i+1], idx, true
			}
		}
	}
	return text[idx:], idx, true
}

func extractPipelineContext(head string) (segment string, relOffset int, ok bool) {
	lower := strings.ToLower(head)
	idx := strings.LastIndex(lower, ".aggregate(")
	if idx < 0 {
		return "", 0, false
	}
	rest := head[idx+len(".aggregate("):]
	rest = strings.TrimLeft(rest, " \t\r\n")
	if len(rest) == 0 || rest[0] != '[' {
		return "", 0, false
	}
	arrayStart := len(head) - len(rest)
	segment = head[arrayStart:]
	relOffset = len(segment)
	return segment, relOffset, true
}

func extractFilterContext(head string) (segment string, relOffset int, ok bool) {
	lower := strings.ToLower(head)
	var marker string
	for _, candidate := range []string{".find(", ".findone(", ".countdocuments(", ".distinct("} {
		if strings.Contains(lower, candidate) {
			marker = candidate
			break
		}
	}
	if marker == "" {
		return "", 0, false
	}
	idx := strings.LastIndex(lower, marker)
	if idx < 0 {
		return "", 0, false
	}
	rest := head[idx+len(marker):]
	rest = strings.TrimLeft(rest, " \t\r\n")
	if len(rest) == 0 || rest[0] != '{' {
		return "", 0, false
	}
	objectStart := len(head) - len(rest)
	segment, _, found := extractBalancedSegment(head[objectStart:], '{', '}')
	if !found {
		segment = rest
	}
	relOffset = len(segment)
	return segment, relOffset, true
}

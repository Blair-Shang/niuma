package sqllsp

import (
	"strings"
	"unicode"
)

// CallSite 光标所在的函数/过程调用点。
type CallSite struct {
	// Qualifier 可选库/schema（db.func）。
	Qualifier string
	// Name 函数或过程名。
	Name string
	// ActiveParameter 当前参数下标（0-based）；无参调用时为 0。
	ActiveParameter int
	// OpenParen 开括号字节偏移。
	OpenParen int
}

// ParseCallSite 解析光标处是否位于 name(...|...) 调用内。
func ParseCallSite(text string, pos Position) *CallSite {
	offset := OffsetFromPosition(text, pos)
	if offset < 0 {
		offset = 0
	}
	if offset > len(text) {
		offset = len(text)
	}
	// 字符串/标识符引号内不提供签名
	if offset > 0 && inQuotedAt(text, offset) {
		return nil
	}
	open := findEnclosingOpenParen(text, offset)
	if open < 0 {
		return nil
	}
	nameEnd := skipWSAndCommentsBack(text, open)
	if nameEnd <= 0 {
		return nil
	}
	_, name, qualifier, ok := readCallNameBefore(text, nameEnd)
	if !ok || name == "" {
		return nil
	}
	active := countActiveParam(text, open+1, offset)
	return &CallSite{
		Qualifier:       qualifier,
		Name:            name,
		ActiveParameter: active,
		OpenParen:       open,
	}
}

func findEnclosingOpenParen(text string, offset int) int {
	depth := 0
	i := offset - 1
	for i >= 0 {
		c := text[i]
		if c == ')' {
			// 可能在字符串内；简化：配合引号扫描
			if inQuotedAt(text, i) {
				i--
				continue
			}
			depth++
			i--
			continue
		}
		if c == '(' {
			if inQuotedAt(text, i) {
				i--
				continue
			}
			if depth == 0 {
				return i
			}
			depth--
			i--
			continue
		}
		if c == '\'' || c == '"' || c == '`' {
			// 跳到引号起点
			i = skipQuotedBack(text, i, c)
			continue
		}
		i--
	}
	return -1
}

func countActiveParam(text string, from, to int) int {
	if to < from {
		return 0
	}
	active := 0
	depth := 0
	i := from
	for i < to {
		c := text[i]
		if c == '\'' || c == '"' || c == '`' {
			i = skipQuotedForward(text, i, c)
			continue
		}
		if c == '(' {
			depth++
			i++
			continue
		}
		if c == ')' {
			if depth > 0 {
				depth--
			}
			i++
			continue
		}
		if c == ',' && depth == 0 {
			active++
		}
		i++
	}
	return active
}

func readCallNameBefore(text string, end int) (start int, name, qualifier string, ok bool) {
	// end 指向名字最后一个字符之后（空白已跳过，紧贴 '('）
	i := end
	// 读右段 ident
	j := i
	for j > 0 {
		r := rune(text[j-1])
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '$' || r == '`' {
			j--
			continue
		}
		break
	}
	if j == i {
		return 0, "", "", false
	}
	right := strings.Trim(text[j:i], "`\"")
	start = j
	// 可选 schema.
	k := skipWSAndCommentsBack(text, j)
	if k > 0 && text[k-1] == '.' {
		k = skipWSAndCommentsBack(text, k-1)
		qEnd := k
		qStart := qEnd
		for qStart > 0 {
			r := rune(text[qStart-1])
			if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '$' || r == '`' {
				qStart--
				continue
			}
			break
		}
		if qStart < qEnd {
			qualifier = strings.Trim(text[qStart:qEnd], "`\"")
			start = qStart
		}
	}
	return start, right, qualifier, right != ""
}

func skipWSAndCommentsBack(text string, i int) int {
	for i > 0 {
		c := text[i-1]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			i--
			continue
		}
		// 块注释 */
		if c == '/' && i >= 2 && text[i-2] == '*' {
			i -= 2
			for i > 0 {
				if text[i-1] == '*' && i >= 2 && text[i-2] == '/' {
					i -= 2
					break
				}
				i--
			}
			continue
		}
		break
	}
	return i
}

func skipQuotedForward(text string, i int, quote byte) int {
	n := len(text)
	i++
	for i < n {
		c := text[i]
		if c == '\\' && quote != '`' {
			i += 2
			continue
		}
		if c == quote {
			if i+1 < n && text[i+1] == quote {
				i += 2
				continue
			}
			return i + 1
		}
		i++
	}
	return n
}

func skipQuotedBack(text string, i int, quote byte) int {
	// i 落在结束引号上；向前找配对起点（简化：扫到前一个同引号）
	i--
	for i >= 0 {
		if text[i] == quote {
			if i > 0 && text[i-1] == '\\' && quote != '`' {
				i--
				continue
			}
			// '' 转义：成对
			if i > 0 && text[i-1] == quote {
				i -= 2
				continue
			}
			return i
		}
		i--
	}
	return 0
}

func inQuotedAt(text string, idx int) bool {
	// 粗略：数到 idx 的未闭合引号（性能可接受于编辑器补全长度）
	inSingle, inDouble, inTick := false, false, false
	for i := 0; i < idx && i < len(text); i++ {
		c := text[i]
		if inSingle {
			if c == '\\' {
				i++
				continue
			}
			if c == '\'' {
				if i+1 < len(text) && text[i+1] == '\'' {
					i++
					continue
				}
				inSingle = false
			}
			continue
		}
		if inDouble {
			if c == '\\' {
				i++
				continue
			}
			if c == '"' {
				if i+1 < len(text) && text[i+1] == '"' {
					i++
					continue
				}
				inDouble = false
			}
			continue
		}
		if inTick {
			if c == '`' {
				if i+1 < len(text) && text[i+1] == '`' {
					i++
					continue
				}
				inTick = false
			}
			continue
		}
		switch c {
		case '\'':
			inSingle = true
		case '"':
			inDouble = true
		case '`':
			inTick = true
		}
	}
	return inSingle || inDouble || inTick
}

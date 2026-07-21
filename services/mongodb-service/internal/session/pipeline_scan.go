package session

import "strings"

type jsonFrame struct {
	frameType  string
	key        string
	currentKey string
}

type pipelineCursorState struct {
	frames       []jsonFrame
	insideString bool
	stage        string
}

type pipelineScannerState struct {
	frames       []jsonFrame
	insideString bool
	escaped      bool
	token        string
}

func offsetFromLineColumn(text string, line, column int) int {
	if line < 1 {
		line = 1
	}
	if column < 1 {
		column = 1
	}
	lines := strings.Split(text, "\n")
	offset := 0
	for i := 0; i < line-1 && i < len(lines); i++ {
		offset += len(lines[i]) + 1
	}
	if line-1 < len(lines) {
		col := column - 1
		if col > len(lines[line-1]) {
			col = len(lines[line-1])
		}
		offset += col
	}
	if offset > len(text) {
		return len(text)
	}
	return offset
}

func pipelineStringRole(text string, offset int) string {
	index := offset - 1
	for index >= 0 && text[index] != '"' {
		index--
	}
	if index < 0 {
		return "unknown"
	}
	prev := index - 1
	for prev >= 0 && (text[prev] == ' ' || text[prev] == '\t' || text[prev] == '\n' || text[prev] == '\r') {
		prev--
	}
	if prev < 0 {
		return "unknown"
	}
	switch text[prev] {
	case '{', ',':
		return "key"
	case ':':
		return "value"
	default:
		return "unknown"
	}
}

func closePipelineScannerString(state *pipelineScannerState, text string, index, offset int) {
	state.insideString = false
	next := index + 1
	for next < offset && (text[next] == ' ' || text[next] == '\t' || text[next] == '\n' || text[next] == '\r') {
		next++
	}
	if len(state.frames) == 0 {
		return
	}
	top := &state.frames[len(state.frames)-1]
	if top.frameType == "object" && next < len(text) && text[next] == ':' {
		top.currentKey = state.token
	}
}

func consumePipelineStringChar(state *pipelineScannerState, char byte, text string, index, offset int) {
	if state.escaped {
		state.token += string(char)
		state.escaped = false
		return
	}
	if char == '\\' {
		state.escaped = true
		return
	}
	if char == '"' {
		closePipelineScannerString(state, text, index, offset)
		return
	}
	state.token += string(char)
}

func consumePipelineStructuralChar(state *pipelineScannerState, char byte) {
	if char == '"' {
		state.insideString = true
		state.token = ""
		return
	}
	if char == '{' || char == '[' {
		parentKey := ""
		if len(state.frames) > 0 {
			parentKey = state.frames[len(state.frames)-1].currentKey
		}
		state.frames = append(state.frames, jsonFrame{
			frameType: map[byte]string{'{': "object", '[': "array"}[char],
			key:       parentKey,
		})
		return
	}
	if char == '}' || char == ']' {
		if len(state.frames) > 0 {
			state.frames = state.frames[:len(state.frames)-1]
		}
		if len(state.frames) > 0 {
			top := &state.frames[len(state.frames)-1]
			if top.frameType == "object" {
				top.currentKey = ""
			}
		}
		return
	}
	if char == ',' && len(state.frames) > 0 {
		top := &state.frames[len(state.frames)-1]
		if top.frameType == "object" {
			top.currentKey = ""
		}
	}
}

func scanPipelineCursor(text string, offset int) pipelineCursorState {
	state := pipelineScannerState{
		frames: make([]jsonFrame, 0, 8),
	}
	if offset < 0 {
		offset = 0
	}
	if offset > len(text) {
		offset = len(text)
	}
	for index := 0; index < offset; index++ {
		char := text[index]
		if state.insideString {
			consumePipelineStringChar(&state, char, text, index, offset)
		} else {
			consumePipelineStructuralChar(&state, char)
		}
	}
	stage := ""
	for i := len(state.frames) - 1; i >= 0; i-- {
		if strings.HasPrefix(state.frames[i].key, "$") {
			stage = state.frames[i].key
			break
		}
	}
	return pipelineCursorState{
		frames:       state.frames,
		insideString: state.insideString,
		stage:        stage,
	}
}

func nearestLookupFrom(text string, offset int) string {
	if offset > len(text) {
		offset = len(text)
	}
	head := text[:offset]
	lookupIndex := strings.LastIndex(head, "\"$lookup\"")
	if lookupIndex < 0 {
		return ""
	}
	segment := head[lookupIndex:]
	const fromPattern = "\"from\""
	fromIndex := strings.Index(segment, fromPattern)
	if fromIndex < 0 {
		return ""
	}
	rest := segment[fromIndex+len(fromPattern):]
	colon := strings.Index(rest, ":")
	if colon < 0 {
		return ""
	}
	rest = strings.TrimSpace(rest[colon+1:])
	if len(rest) == 0 || rest[0] != '"' {
		return ""
	}
	end := strings.Index(rest[1:], "\"")
	if end < 0 {
		return ""
	}
	return rest[1 : end+1]
}

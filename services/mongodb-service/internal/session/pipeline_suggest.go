package session

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/mongo"
)

const (
	pipelineSuggestSampleSize = 120
	pipelineMetadataTTL       = 5 * time.Minute
	maxPipelineSuggestItems   = 40
)

// PipelineSuggestion 是单条聚合管道补全候选。
type PipelineSuggestion struct {
	Label         string `json:"label"`
	InsertText    string `json:"insertText"`
	Detail        string `json:"detail,omitempty"`
	Documentation string `json:"documentation,omitempty"`
	FilterText    string `json:"filterText,omitempty"`
	SortText      string `json:"sortText,omitempty"`
	Kind          string `json:"kind,omitempty"`
}

// PipelineSuggestParams 是 pipeline.suggest 入参。
type PipelineSuggestParams struct {
	Database         string
	Collection       string
	Text             string
	Line             int
	Column           int
	Prefix           string
	TriggerCharacter string
}

// PipelineSuggestResult 是 pipeline.suggest 返回。
type PipelineSuggestResult struct {
	Suggestions []PipelineSuggestion `json:"suggestions"`
	Context     string               `json:"context,omitempty"`
}

type metadataCacheEntry[T any] struct {
	value     T
	expiresAt time.Time
}

type pipelineMetadataCache struct {
	mu          sync.RWMutex
	collections map[string]metadataCacheEntry[[]string]
	fields      map[string]metadataCacheEntry[[]SchemaField]
}

var pipelineMetaCache = &pipelineMetadataCache{
	collections: make(map[string]metadataCacheEntry[[]string]),
	fields:      make(map[string]metadataCacheEntry[[]SchemaField]),
}

func metadataCollectionsKey(sessionID, database string) string {
	return sessionID + ":" + database
}

func metadataFieldsKey(sessionID, database, collection string) string {
	return sessionID + ":" + database + ":" + collection
}

func (c *pipelineMetadataCache) getCollections(key string) ([]string, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	entry, ok := c.collections[key]
	if !ok || time.Now().After(entry.expiresAt) {
		return nil, false
	}
	return entry.value, true
}

func (c *pipelineMetadataCache) setCollections(key string, value []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.collections[key] = metadataCacheEntry[[]string]{value: value, expiresAt: time.Now().Add(pipelineMetadataTTL)}
}

func (c *pipelineMetadataCache) getFields(key string) ([]SchemaField, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	entry, ok := c.fields[key]
	if !ok || time.Now().After(entry.expiresAt) {
		return nil, false
	}
	return entry.value, true
}

func (c *pipelineMetadataCache) setFields(key string, value []SchemaField) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.fields[key] = metadataCacheEntry[[]SchemaField]{value: value, expiresAt: time.Now().Add(pipelineMetadataTTL)}
}

func loadPipelineCollections(ctx context.Context, client *mongo.Client, sessionID, database string) ([]string, error) {
	key := metadataCollectionsKey(sessionID, database)
	if cached, ok := pipelineMetaCache.getCollections(key); ok {
		return cached, nil
	}
	items, err := ListCollections(ctx, client, database)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(items))
	for _, item := range items {
		if item.Type == "collection" {
			names = append(names, item.Name)
		}
	}
	sort.Strings(names)
	pipelineMetaCache.setCollections(key, names)
	return names, nil
}

func loadPipelineFields(ctx context.Context, client *mongo.Client, sessionID, database, collection string) ([]SchemaField, error) {
	key := metadataFieldsKey(sessionID, database, collection)
	if cached, ok := pipelineMetaCache.getFields(key); ok {
		return cached, nil
	}
	result, err := SampleSchema(ctx, client, SchemaSampleParams{
		Database:   database,
		Collection: collection,
		SampleSize: pipelineSuggestSampleSize,
	})
	if err != nil {
		return nil, err
	}
	fields := result.Fields
	sort.Slice(fields, func(i, j int) bool { return fields[i].Frequency > fields[j].Frequency })
	pipelineMetaCache.setFields(key, fields)
	return fields, nil
}

type pipelineSuggestContext struct {
	fields       []SchemaField
	collections  []string
	fieldMap     map[string][]SchemaField
	getFields    func(collection string) ([]SchemaField, error)
	cursor       pipelineCursorState
	text         string
	offset       int
	prefix       string
	trigger      string
	contextLabel string
}

func matchesPipelinePrefix(label, prefix string) bool {
	if prefix == "" {
		return true
	}
	return strings.Contains(strings.ToLower(label), strings.ToLower(prefix))
}

func commandPropertyBody(cmd pipelineCommand) string {
	if strings.HasPrefix(cmd.Body, "\"") {
		return cmd.Body
	}
	if strings.HasPrefix(cmd.Body, "{") {
		return strings.TrimSpace(strings.TrimPrefix(strings.TrimSuffix(cmd.Body, "}"), "{"))
	}
	return fmt.Sprintf("\"%s\": ${1:{}}", cmd.Name)
}

func commandCompletions(
	cmds []pipelineCommand,
	prefix string,
	mode string,
	quoteOpen bool,
) []PipelineSuggestion {
	out := make([]PipelineSuggestion, 0, len(cmds))
	index := 0
	for _, cmd := range cmds {
		if !matchesPipelinePrefix(cmd.Name, prefix) {
			continue
		}
		insertText := ""
		kind := "property"
		switch mode {
		case "full-stage":
			insertText = cmd.Body
			if insertText == "" {
				insertText = fmt.Sprintf("{\n  \"%s\": ${1:{}}\n}", cmd.Name)
			}
			kind = "snippet"
		case "value":
			insertText = cmd.Name
			kind = "value"
		default:
			if cmd.Body != "" {
				insertText = commandPropertyBody(cmd)
				kind = "snippet"
			} else {
				insertText = fmt.Sprintf("\"%s\": ${1:{}}", cmd.Name)
			}
			if quoteOpen && strings.HasPrefix(insertText, "\"") {
				insertText = strings.TrimPrefix(insertText, "\"")
			}
		}
		out = append(out, PipelineSuggestion{
			Label:         cmd.Name,
			InsertText:    insertText,
			Detail:        cmd.Description,
			Documentation: "MongoDB · " + cmd.Description,
			FilterText:    cmd.Name,
			SortText:      fmt.Sprintf("%03d", index),
			Kind:          kind,
		})
		index++
		if len(out) >= maxPipelineSuggestItems {
			break
		}
	}
	return out
}

func fieldCompletions(fields []SchemaField, prefix string, mode string) []PipelineSuggestion {
	out := make([]PipelineSuggestion, 0, len(fields))
	index := 0
	rawPrefix := strings.TrimPrefix(prefix, "$")
	for _, field := range fields {
		label := field.Path
		insertText := field.Path
		if mode == "path" {
			label = "$" + field.Path
			insertText = "$" + field.Path
		}
		if !matchesPipelinePrefix(label, prefix) && !matchesPipelinePrefix(rawPrefix, field.Path) {
			continue
		}
		detail := fmt.Sprintf("%s · %d%%", strings.Join(field.Types, " | "), int(field.Frequency*100))
		out = append(out, PipelineSuggestion{
			Label:         label,
			InsertText:    insertText,
			Detail:        detail,
			Documentation: "字段 · " + detail,
			FilterText:    label,
			SortText:      fmt.Sprintf("0%03d", index),
			Kind:          "field",
		})
		index++
		if len(out) >= maxPipelineSuggestItems {
			break
		}
	}
	return out
}

func collectionCompletions(collections []string, prefix string) []PipelineSuggestion {
	out := make([]PipelineSuggestion, 0, len(collections))
	index := 0
	for _, name := range collections {
		if !matchesPipelinePrefix(name, prefix) {
			continue
		}
		out = append(out, PipelineSuggestion{
			Label:         name,
			InsertText:    name,
			Detail:        "collection",
			Documentation: "集合 · " + name,
			FilterText:    name,
			SortText:      fmt.Sprintf("0%03d", index),
			Kind:          "value",
		})
		index++
	}
	return out
}

func mergePipelineSuggestions(primary, secondary []PipelineSuggestion) []PipelineSuggestion {
	seen := make(map[string]struct{}, len(primary)+len(secondary))
	out := make([]PipelineSuggestion, 0, len(primary)+len(secondary))
	for _, batch := range [][]PipelineSuggestion{primary, secondary} {
		for _, item := range batch {
			if _, ok := seen[item.Label]; ok {
				continue
			}
			seen[item.Label] = struct{}{}
			out = append(out, item)
		}
	}
	return out
}

func isPipelineStageObject(state pipelineCursorState) bool {
	if len(state.frames) == 0 {
		return false
	}
	top := state.frames[len(state.frames)-1]
	if top.frameType != "object" || top.key != "" {
		return false
	}
	if len(state.frames) < 2 {
		return false
	}
	return state.frames[len(state.frames)-2].frameType == "array"
}

func isPipelineArray(state pipelineCursorState) bool {
	if len(state.frames) == 0 {
		return false
	}
	top := state.frames[len(state.frames)-1]
	if top.frameType != "array" {
		return false
	}
	if top.key == "" || top.key == "pipeline" {
		return true
	}
	for _, frame := range state.frames {
		if frame.key == "$facet" {
			return true
		}
	}
	return false
}

func isFieldKeyStage(stage string) bool {
	switch stage {
	case "$match", "$project", "$sort", "$set", "$addFields", "$unset":
		return true
	default:
		return false
	}
}

func isFieldPathStage(stage string) bool {
	switch stage {
	case "$group", "$project", "$sort", "$addFields", "$set", "$replaceRoot", "$replaceWith", "$sortByCount", "$bucket", "$bucketAuto", "$setWindowFields":
		return true
	default:
		return false
	}
}

func isExpressionStage(stage string) bool {
	switch stage {
	case "$addFields", "$bucket", "$bucketAuto", "$group", "$project", "$redact", "$replaceRoot", "$replaceWith", "$set", "$setWindowFields", "$sortByCount":
		return true
	default:
		return false
	}
}

func quoteOpenAt(text string, offset, prefixLen int) bool {
	pos := offset - prefixLen - 1
	return pos >= 0 && text[pos] == '"'
}

func dynamicPipelineSuggestions(ctx *pipelineSuggestContext) []PipelineSuggestion {
	if len(ctx.fields) == 0 && len(ctx.collections) == 0 {
		return nil
	}
	role := "unknown"
	if ctx.cursor.insideString {
		role = pipelineStringRole(ctx.text, ctx.offset)
	}
	topKey := ""
	propertyKey := ""
	if len(ctx.cursor.frames) > 0 {
		top := ctx.cursor.frames[len(ctx.cursor.frames)-1]
		topKey = top.key
		propertyKey = top.currentKey
	}

	if ctx.cursor.stage == "$lookup" && topKey == "$lookup" {
		switch propertyKey {
		case "from":
			if role == "value" || ctx.cursor.insideString {
				ctx.contextLabel = "lookup-from"
				return collectionCompletions(ctx.collections, ctx.prefix)
			}
		case "localField":
			if role == "value" || ctx.cursor.insideString {
				ctx.contextLabel = "lookup-local-field"
				return fieldCompletions(ctx.fields, ctx.prefix, "key")
			}
		case "foreignField":
			if role == "value" || ctx.cursor.insideString {
				target := nearestLookupFrom(ctx.text, ctx.offset)
				fields := ctx.fields
				if target != "" && ctx.getFields != nil {
					if loaded, err := ctx.getFields(target); err == nil && len(loaded) > 0 {
						fields = loaded
					}
				}
				ctx.contextLabel = "lookup-foreign-field"
				return fieldCompletions(fields, ctx.prefix, "key")
			}
		}
	}

	if ctx.cursor.stage == "$unwind" && propertyKey == "path" && strings.HasPrefix(ctx.prefix, "$") {
		arrayFields := make([]SchemaField, 0)
		for _, field := range ctx.fields {
			for _, typ := range field.Types {
				if strings.Contains(typ, "array") {
					arrayFields = append(arrayFields, field)
					break
				}
			}
		}
		ctx.contextLabel = "unwind-path"
		return fieldCompletions(arrayFields, ctx.prefix, "path")
	}

	if ctx.cursor.insideString && role == "key" && isFieldKeyStage(ctx.cursor.stage) {
		ctx.contextLabel = "field-key"
		return fieldCompletions(ctx.fields, ctx.prefix, "key")
	}

	if ctx.cursor.insideString && role == "value" && strings.HasPrefix(ctx.prefix, "$") && isFieldPathStage(ctx.cursor.stage) {
		ctx.contextLabel = "field-path"
		return fieldCompletions(ctx.fields, ctx.prefix, "path")
	}

	if ctx.cursor.stage == "$group" && propertyKey == "_id" && (role == "value" || strings.HasPrefix(ctx.prefix, "$")) {
		ctx.contextLabel = "group-id"
		return fieldCompletions(ctx.fields, ctx.prefix, "path")
	}

	if ctx.cursor.stage == "$sort" && role == "key" {
		ctx.contextLabel = "sort-field"
		return fieldCompletions(ctx.fields, ctx.prefix, "key")
	}

	if ctx.cursor.stage == "$match" && role == "key" && !strings.HasPrefix(ctx.prefix, "$") {
		ctx.contextLabel = "match-field"
		return fieldCompletions(ctx.fields, ctx.prefix, "key")
	}

	return nil
}

func staticPipelineSuggestions(ctx *pipelineSuggestContext) []PipelineSuggestion {
	topKey := ""
	if len(ctx.cursor.frames) > 0 {
		topKey = ctx.cursor.frames[len(ctx.cursor.frames)-1].key
	}
	parentKey := ""
	if len(ctx.cursor.frames) > 1 {
		parentKey = ctx.cursor.frames[len(ctx.cursor.frames)-2].currentKey
	}
	quoteOpen := quoteOpenAt(ctx.text, ctx.offset, len(ctx.prefix))

	if isPipelineArray(ctx.cursor) {
		ctx.contextLabel = "pipeline-stage"
		return commandCompletions(pipelineStages, ctx.prefix, "full-stage", quoteOpen)
	}
	if isPipelineStageObject(ctx.cursor) {
		ctx.contextLabel = "stage-key"
		return commandCompletions(pipelineStages, ctx.prefix, "property", quoteOpen)
	}
	if ctx.cursor.stage == "$lookup" && topKey == "$lookup" {
		ctx.contextLabel = "lookup-property"
		return commandCompletions(lookupProperties, ctx.prefix, "property", quoteOpen)
	}
	if ctx.cursor.stage == "$unwind" && topKey == "$unwind" {
		ctx.contextLabel = "unwind-property"
		return commandCompletions(unwindProperties, ctx.prefix, "property", quoteOpen)
	}

	if items := matchStageSuggestions(ctx); items != nil {
		return items
	}
	if items := groupStageSuggestions(ctx); items != nil {
		return items
	}

	commandsRequested := strings.HasPrefix(ctx.prefix, "$") || ctx.trigger == ""
	if commandsRequested && (isExpressionStage(ctx.cursor.stage) || parentKey == "$expr") {
		ctx.contextLabel = "expression"
		return commandCompletions(append(expressionOperators, systemVariables...), ctx.prefix, "property", quoteOpen)
	}
	if strings.HasPrefix(ctx.prefix, "$$") {
		ctx.contextLabel = "system-variable"
		return commandCompletions(systemVariables, ctx.prefix, "value", quoteOpen)
	}
	if strings.HasPrefix(ctx.prefix, "$") {
		ctx.contextLabel = "expression-operator"
		return commandCompletions(expressionOperators, ctx.prefix, "value", quoteOpen)
	}
	return nil
}

func matchStageSuggestions(ctx *pipelineSuggestContext) []PipelineSuggestion {
	if ctx.cursor.stage != "$match" {
		return nil
	}
	role := "unknown"
	if ctx.cursor.insideString {
		role = pipelineStringRole(ctx.text, ctx.offset)
	}
	top := ctx.cursor.frames[len(ctx.cursor.frames)-1]
	parentKey := ""
	if len(ctx.cursor.frames) > 1 {
		parentKey = ctx.cursor.frames[len(ctx.cursor.frames)-2].key
	}
	if parentKey == "$match" && top.frameType == "object" && role == "key" {
		return []PipelineSuggestion{}
	}
	quoteOpen := quoteOpenAt(ctx.text, ctx.offset, len(ctx.prefix))
	if top.key == "$expr" {
		ctx.contextLabel = "match-expr"
		return commandCompletions(expressionOperators, ctx.prefix, "property", quoteOpen)
	}
	if top.frameType == "object" && top.key != "$match" && top.currentKey != "" {
		ctx.contextLabel = "match-operator"
		return commandCompletions(queryOperators, ctx.prefix, "property", quoteOpen)
	}
	if top.key == "$match" && strings.HasPrefix(ctx.prefix, "$") {
		ctx.contextLabel = "match-logical"
		end := 4
		if end > len(queryOperators) {
			end = len(queryOperators)
		}
		return commandCompletions(queryOperators[:end], ctx.prefix, "property", quoteOpen)
	}
	return nil
}

func groupStageSuggestions(ctx *pipelineSuggestContext) []PipelineSuggestion {
	if ctx.cursor.stage != "$group" {
		return nil
	}
	top := ctx.cursor.frames[len(ctx.cursor.frames)-1]
	quoteOpen := quoteOpenAt(ctx.text, ctx.offset, len(ctx.prefix))
	if top.frameType == "object" && top.key != "" && top.key != "$group" {
		ctx.contextLabel = "group-accumulator"
		return commandCompletions(accumulators, ctx.prefix, "property", quoteOpen)
	}
	if top.key == "$group" {
		ctx.contextLabel = "group-key"
		return commandCompletions([]pipelineCommand{
			{Name: "_id", Description: "分组键；设为 null 表示将所有文档归为一组", Body: "\"_id\": \"$${1:field}\""},
		}, ctx.prefix, "property", quoteOpen)
	}
	return nil
}

// SuggestPipeline 根据光标上下文返回聚合管道补全候选。
func SuggestPipeline(ctx context.Context, client *mongo.Client, sessionID string, params PipelineSuggestParams) (*PipelineSuggestResult, error) {
	if err := requireDBColl(params.Database, params.Collection); err != nil {
		return nil, err
	}
	offset := offsetFromLineColumn(params.Text, params.Line, params.Column)
	cursor := scanPipelineCursor(params.Text, offset)

	collections, err := loadPipelineCollections(ctx, client, sessionID, params.Database)
	if err != nil {
		return nil, err
	}
	fields, err := loadPipelineFields(ctx, client, sessionID, params.Database, params.Collection)
	if err != nil {
		return nil, err
	}

	suggestCtx := &pipelineSuggestContext{
		fields:      fields,
		collections: collections,
		fieldMap:    map[string][]SchemaField{params.Collection: fields},
		cursor:      cursor,
		text:        params.Text,
		offset:      offset,
		prefix:      params.Prefix,
		trigger:     params.TriggerCharacter,
	}
	suggestCtx.getFields = func(collection string) ([]SchemaField, error) {
		if cached, ok := suggestCtx.fieldMap[collection]; ok {
			return cached, nil
		}
		loaded, loadErr := loadPipelineFields(ctx, client, sessionID, params.Database, collection)
		if loadErr != nil {
			return nil, loadErr
		}
		suggestCtx.fieldMap[collection] = loaded
		return loaded, nil
	}

	dynamic := dynamicPipelineSuggestions(suggestCtx)
	static := staticPipelineSuggestions(suggestCtx)
	suggestions := static
	if len(dynamic) > 0 {
		suggestions = mergePipelineSuggestions(dynamic, static)
	}
	if suggestions == nil {
		suggestions = []PipelineSuggestion{}
	}
	return &PipelineSuggestResult{Suggestions: suggestions, Context: suggestCtx.contextLabel}, nil
}

package session

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"go.mongodb.org/mongo-driver/mongo"
)

const maxQuerySuggestItems = 80

// QuerySuggestParams 是 query.suggest 入参。
type QuerySuggestParams struct {
	Database         string
	Collection       string
	Text             string
	Line             int
	Column           int
	Prefix           string
	TriggerCharacter string
}

// QuerySuggestResult 是 query.suggest 返回。
type QuerySuggestResult struct {
	Suggestions []PipelineSuggestion `json:"suggestions"`
	Context     string               `json:"context,omitempty"`
}

func queryCommandCompletions(items []queryCommand, prefix string) []PipelineSuggestion {
	out := make([]PipelineSuggestion, 0, len(items))
	index := 0
	lowerPrefix := strings.ToLower(strings.TrimSpace(prefix))
	for _, item := range items {
		nameLower := strings.ToLower(item.Name)
		if lowerPrefix != "" && !strings.HasPrefix(nameLower, lowerPrefix) &&
			!strings.Contains(nameLower, lowerPrefix) {
			continue
		}
		insertText := item.Name
		kind := item.Kind
		if item.Body != "" {
			insertText = item.Body
			if item.Kind == "snippet" || strings.Contains(item.Body, "${") {
				kind = "snippet"
			}
		}
		out = append(out, PipelineSuggestion{
			Label:         item.Name,
			InsertText:    insertText,
			Detail:        item.Description,
			Documentation: "MongoDB Shell · " + item.Description,
			FilterText:    item.Name,
			SortText:      fmt.Sprintf("%03d", index),
			Kind:          kind,
		})
		index++
		if len(out) >= maxQuerySuggestItems {
			break
		}
	}
	return out
}

// needsGetCollection 判断集合名能否用 db.name 点访问（含 . - 等须走 getCollection）。
func needsGetCollection(name string) bool {
	if name == "" {
		return true
	}
	if strings.ContainsAny(name, ".-$ ") {
		return true
	}
	r := name[0]
	return r >= '0' && r <= '9'
}

func queryCollectionCompletions(collections []string, prefix string) []PipelineSuggestion {
	out := make([]PipelineSuggestion, 0, len(collections))
	index := 0
	for _, name := range collections {
		if !matchesPipelinePrefix(name, prefix) {
			continue
		}
		insert := name
		detail := "collection"
		if needsGetCollection(name) {
			escaped := strings.ReplaceAll(name, `\`, `\\`)
			escaped = strings.ReplaceAll(escaped, `'`, `\'`)
			insert = "getCollection('" + escaped + "')"
			detail = "collection · getCollection"
		}
		out = append(out, PipelineSuggestion{
			Label:         name,
			InsertText:    insert,
			Detail:        detail,
			Documentation: "集合 · " + name,
			FilterText:    name,
			SortText:      fmt.Sprintf("0%03d", index),
			Kind:          "value",
		})
		index++
		if len(out) >= maxQuerySuggestItems {
			break
		}
	}
	return out
}

func staticQuerySuggestions(ctx *querySuggestContext) []PipelineSuggestion {
	switch ctx.cursor.kind {
	case queryCtxTopLevel:
		ctx.contextLabel = "shell-helper"
		return queryCommandCompletions(shellHelpers, ctx.prefix)
	case queryCtxDbMember:
		ctx.contextLabel = "db-member"
		collections := queryCollectionCompletions(ctx.collections, ctx.prefix)
		methods := queryCommandCompletions(dbMethods, ctx.prefix)
		return mergePipelineSuggestions(collections, methods)
	case queryCtxCollection:
		ctx.contextLabel = "collection"
		return queryCollectionCompletions(ctx.collections, ctx.prefix)
	case queryCtxCollectionCall:
		ctx.contextLabel = "collection-method"
		return queryCommandCompletions(collectionMethods, ctx.prefix)
	case queryCtxCursorChain:
		ctx.contextLabel = "cursor-chain"
		return queryCommandCompletions(cursorChainMethods, ctx.prefix)
	case queryCtxFilterKey:
		ctx.contextLabel = "filter-field"
		fields := fieldCompletions(ctx.fields, ctx.prefix, "key")
		ops := queryCommandCompletions(shellQueryOperators, ctx.prefix)
		return mergePipelineSuggestions(fields, ops)
	case queryCtxFilterOperator:
		ctx.contextLabel = "filter-operator"
		return queryCommandCompletions(shellQueryOperators, ctx.prefix)
	default:
		return nil
	}
}

type querySuggestContext struct {
	fields         []SchemaField
	collections    []string
	cursor         queryCursorState
	text           string
	offset         int
	prefix         string
	trigger        string
	contextLabel   string
	targetDatabase string
}

func suggestPipelineInQuery(ctx context.Context, client *mongo.Client, sessionID string, qctx *querySuggestContext) ([]PipelineSuggestion, error) {
	if qctx.cursor.pipelineText == "" {
		return nil, nil
	}
	result, err := SuggestPipeline(ctx, client, sessionID, PipelineSuggestParams{
		Database:         qctx.targetDatabase,
		Collection:       qctx.cursor.targetCollection,
		Text:             qctx.cursor.pipelineText,
		Line:             1,
		Column:           qctx.cursor.pipelineOffset + 1,
		Prefix:           qctx.prefix,
		TriggerCharacter: qctx.trigger,
	})
	if err != nil {
		return nil, err
	}
	qctx.contextLabel = "pipeline-" + result.Context
	return result.Suggestions, nil
}

func queryNeedsCollections(kind queryContextKind) bool {
	switch kind {
	case queryCtxDbMember, queryCtxCollection:
		return true
	default:
		return false
	}
}

func queryNeedsFields(kind queryContextKind) bool {
	switch kind {
	case queryCtxFilterKey, queryCtxPipeline:
		return true
	default:
		return false
	}
}

// SuggestQuery 根据光标上下文返回 mongosh 查询补全候选。
// 仅在上下文需要时采样集合/字段，静态目录场景不打库。
func SuggestQuery(ctx context.Context, client *mongo.Client, sessionID string, params QuerySuggestParams) (*QuerySuggestResult, error) {
	if err := requireDB(params.Database); err != nil {
		return nil, err
	}
	offset := offsetFromLineColumn(params.Text, params.Line, params.Column)
	cursor := scanQueryCursor(params.Text, offset)
	prefix := cursor.prefix
	if params.Prefix != "" {
		prefix = params.Prefix
	}
	targetCollection := params.Collection
	if cursor.targetCollection != "" {
		targetCollection = cursor.targetCollection
	}

	var collections []string
	var fields []SchemaField
	if queryNeedsCollections(cursor.kind) {
		if loaded, err := loadPipelineCollections(ctx, client, sessionID, params.Database); err == nil {
			collections = loaded
		}
	}
	if queryNeedsFields(cursor.kind) && targetCollection != "" {
		if loaded, err := loadPipelineFields(ctx, client, sessionID, params.Database, targetCollection); err == nil {
			fields = loaded
		}
	}

	qctx := &querySuggestContext{
		fields:         fields,
		collections:    collections,
		cursor:         cursor,
		text:           params.Text,
		offset:         offset,
		prefix:         prefix,
		trigger:        params.TriggerCharacter,
		targetDatabase: params.Database,
	}
	qctx.cursor.targetCollection = targetCollection

	var suggestions []PipelineSuggestion
	if qctx.cursor.kind == queryCtxPipeline && targetCollection != "" {
		pipelineItems, pipeErr := suggestPipelineInQuery(ctx, client, sessionID, qctx)
		if pipeErr != nil {
			// 管道元数据失败时仍返回空，避免整次补全 500
			suggestions = []PipelineSuggestion{}
		} else {
			suggestions = pipelineItems
		}
	} else {
		suggestions = staticQuerySuggestions(qctx)
	}

	if suggestions == nil {
		suggestions = []PipelineSuggestion{}
	}
	sort.SliceStable(suggestions, func(i, j int) bool {
		return suggestions[i].SortText < suggestions[j].SortText
	})
	return &QuerySuggestResult{Suggestions: suggestions, Context: qctx.contextLabel}, nil
}

func requireDB(database string) error {
	if strings.TrimSpace(database) == "" {
		return fmt.Errorf("database required")
	}
	return nil
}

package session

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	defaultSchemaSampleSize = 1000
	schemaStringTopN        = 8
	schemaSampleValueLimit  = 5
	schemaNumberBucketCount = 10
	schemaDateBucketCount   = 10
	schemaGeoPointLimit     = 120
)

// SchemaTypeStat 是字段在采样文档中的类型占比。
type SchemaTypeStat struct {
	Type      string  `json:"type"`
	Frequency float64 `json:"frequency"`
}

// SchemaNumberBucket 是数值字段分布直方图桶。
type SchemaNumberBucket struct {
	From      float64 `json:"from"`
	To        float64 `json:"to"`
	Frequency float64 `json:"frequency"`
}

// SchemaNumberStats 是数值字段的 min/max 与分布。
type SchemaNumberStats struct {
	Min     float64              `json:"min"`
	Max     float64              `json:"max"`
	Buckets []SchemaNumberBucket `json:"buckets,omitempty"`
}

// SchemaDateBucket 是日期字段分布直方图桶。
type SchemaDateBucket struct {
	From      string  `json:"from"`
	To        string  `json:"to"`
	Frequency float64 `json:"frequency"`
}

// SchemaDateStats 是日期字段的范围与分布。
type SchemaDateStats struct {
	Min     string             `json:"min"`
	Max     string             `json:"max"`
	Buckets []SchemaDateBucket `json:"buckets,omitempty"`
}

// SchemaGeoPoint 是地理坐标采样点。
type SchemaGeoPoint struct {
	Lng float64 `json:"lng"`
	Lat float64 `json:"lat"`
}

// SchemaGeoStats 是地理坐标字段的采样点集。
type SchemaGeoStats struct {
	Points []SchemaGeoPoint `json:"points"`
}

// SchemaStringBucket 是字符串字段的高频值。
type SchemaStringBucket struct {
	Value     string  `json:"value"`
	Frequency float64 `json:"frequency"`
}

// SchemaStringStats 是字符串字段的值分布摘要。
type SchemaStringStats struct {
	TopValues []SchemaStringBucket `json:"topValues"`
}

// SchemaField 是采样推断的字段信息。
type SchemaField struct {
	Path          string              `json:"path"`
	Types         []string            `json:"types"`
	Frequency     float64             `json:"frequency"`
	TypeBreakdown []SchemaTypeStat    `json:"typeBreakdown,omitempty"`
	NumberStats   *SchemaNumberStats  `json:"numberStats,omitempty"`
	DateStats     *SchemaDateStats    `json:"dateStats,omitempty"`
	StringStats   *SchemaStringStats  `json:"stringStats,omitempty"`
	GeoStats      *SchemaGeoStats     `json:"geoStats,omitempty"`
	Samples       []string            `json:"samples,omitempty"`
}

// SchemaSampleParams 是集合 Schema 采样请求参数。
type SchemaSampleParams struct {
	Database   string
	Collection string
	SampleSize int
	Filter     json.RawMessage
	MaxTimeMS  int64
}

// SchemaSampleResult 是 Schema 采样结果。
type SchemaSampleResult struct {
	Fields      []SchemaField `json:"fields"`
	SampleCount int           `json:"sampleCount"`
	SampleSize  int           `json:"sampleSize"`
}

type fieldAccumulator struct {
	presenceCount int
	typeCounts    map[string]int
	numberValues  []float64
	dateValues    []time.Time
	stringCounts  map[string]int
	geoPoints     [][2]float64
	sampleValues  []string
	sampleSeen    map[string]struct{}
}

// SampleSchema 对集合文档随机采样并推断字段类型与值分布。
func SampleSchema(ctx context.Context, client *mongo.Client, params SchemaSampleParams) (SchemaSampleResult, error) {
	if err := requireDBColl(params.Database, params.Collection); err != nil {
		return SchemaSampleResult{}, err
	}

	sampleSize := params.SampleSize
	if sampleSize <= 0 {
		sampleSize = defaultSchemaSampleSize
	}
	if sampleSize > MaxFindLimit {
		sampleSize = MaxFindLimit
	}

	filter, err := ParseOptionalFilter(params.Filter)
	if err != nil {
		return SchemaSampleResult{}, fmt.Errorf("mongodb: schema filter: %w", err)
	}

	pipeline := mongo.Pipeline{}
	if len(filter) > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$match", Value: filter}})
	}
	pipeline = append(pipeline, bson.D{{Key: "$sample", Value: bson.M{"size": sampleSize}}})

	aggOpts := options.Aggregate()
	if params.MaxTimeMS > 0 {
		aggOpts.SetMaxTime(time.Duration(params.MaxTimeMS) * time.Millisecond)
	}

	cur, err := client.Database(params.Database).Collection(params.Collection).Aggregate(ctx, pipeline, aggOpts)
	if err != nil {
		return SchemaSampleResult{}, fmt.Errorf("mongodb: schema sample: %w", err)
	}
	defer cur.Close(ctx)

	acc := make(map[string]*fieldAccumulator)
	total := 0
	for cur.Next(ctx) {
		var doc bson.M
		if err := cur.Decode(&doc); err != nil {
			return SchemaSampleResult{}, fmt.Errorf("mongodb: decode sample: %w", err)
		}
		total++
		walkDocument("", doc, acc)
	}
	if err := cur.Err(); err != nil {
		return SchemaSampleResult{}, fmt.Errorf("mongodb: schema sample cursor: %w", err)
	}
	if total == 0 {
		return SchemaSampleResult{Fields: []SchemaField{}, SampleCount: 0, SampleSize: sampleSize}, nil
	}

	fields := finalizeSchemaFields(acc, total)
	return SchemaSampleResult{
		Fields:      fields,
		SampleCount: total,
		SampleSize:  sampleSize,
	}, nil
}

func finalizeSchemaFields(acc map[string]*fieldAccumulator, total int) []SchemaField {
	fields := make([]SchemaField, 0, len(acc))
	for path, item := range acc {
		fields = append(fields, buildSchemaField(path, item, total))
	}
	sort.Slice(fields, func(i, j int) bool { return fields[i].Path < fields[j].Path })
	return fields
}

func buildSchemaField(path string, item *fieldAccumulator, total int) SchemaField {
	field := SchemaField{
		Path:      path,
		Frequency: float64(item.presenceCount) / float64(total),
	}

	typeNames := make([]string, 0, len(item.typeCounts))
	breakdown := make([]SchemaTypeStat, 0, len(item.typeCounts))
	for typeName, count := range item.typeCounts {
		typeNames = append(typeNames, typeName)
		breakdown = append(breakdown, SchemaTypeStat{
			Type:      typeName,
			Frequency: float64(count) / float64(total),
		})
	}
	sort.Strings(typeNames)
	sort.Slice(breakdown, func(i, j int) bool {
		if breakdown[i].Frequency == breakdown[j].Frequency {
			return breakdown[i].Type < breakdown[j].Type
		}
		return breakdown[i].Frequency > breakdown[j].Frequency
	})
	field.Types = typeNames
	field.TypeBreakdown = breakdown

	if len(item.numberValues) > 0 {
		field.NumberStats = buildNumberStats(item.numberValues, item.presenceCount)
	}
	if len(item.dateValues) > 0 {
		field.DateStats = buildDateStats(item.dateValues)
	}
	if len(item.stringCounts) > 0 {
		field.StringStats = buildStringStats(item.stringCounts, item.presenceCount)
	}
	if len(item.geoPoints) > 0 {
		field.GeoStats = buildGeoStats(item.geoPoints)
	}
	if len(item.sampleValues) > 0 {
		field.Samples = append([]string(nil), item.sampleValues...)
	}

	return field
}

func buildNumberStats(values []float64, presence int) *SchemaNumberStats {
	minVal := values[0]
	maxVal := values[0]
	for _, v := range values[1:] {
		if v < minVal {
			minVal = v
		}
		if v > maxVal {
			maxVal = v
		}
	}

	stats := &SchemaNumberStats{Min: minVal, Max: maxVal}
	if presence == 0 || minVal == maxVal {
		stats.Buckets = []SchemaNumberBucket{{
			From:      minVal,
			To:        maxVal,
			Frequency: 1,
		}}
		return stats
	}

	bucketCount := schemaNumberBucketCount
	if len(values) < bucketCount {
		bucketCount = len(values)
	}
	if bucketCount <= 0 {
		return stats
	}

	span := maxVal - minVal
	if span == 0 {
		stats.Buckets = []SchemaNumberBucket{{
			From:      minVal,
			To:        maxVal,
			Frequency: 1,
		}}
		return stats
	}

	counts := make([]int, bucketCount)
	for _, v := range values {
		idx := int(math.Floor((v - minVal) / span * float64(bucketCount)))
		if idx >= bucketCount {
			idx = bucketCount - 1
		}
		if idx < 0 {
			idx = 0
		}
		counts[idx]++
	}

	buckets := make([]SchemaNumberBucket, 0, bucketCount)
	for i, count := range counts {
		if count == 0 {
			continue
		}
		from := minVal + span*float64(i)/float64(bucketCount)
		to := minVal + span*float64(i+1)/float64(bucketCount)
		if i == bucketCount-1 {
			to = maxVal
		}
		buckets = append(buckets, SchemaNumberBucket{
			From:      from,
			To:        to,
			Frequency: float64(count) / float64(len(values)),
		})
	}
	stats.Buckets = buckets
	return stats
}

func buildDateStats(values []time.Time) *SchemaDateStats {
	minTime := values[0]
	maxTime := values[0]
	for _, v := range values[1:] {
		if v.Before(minTime) {
			minTime = v
		}
		if v.After(maxTime) {
			maxTime = v
		}
	}

	stats := &SchemaDateStats{
		Min: minTime.UTC().Format(time.RFC3339),
		Max: maxTime.UTC().Format(time.RFC3339),
	}

	if len(values) == 1 || minTime.Equal(maxTime) {
		stats.Buckets = []SchemaDateBucket{{
			From:      stats.Min,
			To:        stats.Max,
			Frequency: 1,
		}}
		return stats
	}

	bucketCount := schemaDateBucketCount
	if len(values) < bucketCount {
		bucketCount = len(values)
	}
	minMs := float64(minTime.UnixMilli())
	maxMs := float64(maxTime.UnixMilli())
	span := maxMs - minMs
	counts := make([]int, bucketCount)
	for _, v := range values {
		idx := int(math.Floor((float64(v.UnixMilli()) - minMs) / span * float64(bucketCount)))
		if idx >= bucketCount {
			idx = bucketCount - 1
		}
		if idx < 0 {
			idx = 0
		}
		counts[idx]++
	}

	buckets := make([]SchemaDateBucket, 0, bucketCount)
	for i, count := range counts {
		if count == 0 {
			continue
		}
		fromMs := minMs + span*float64(i)/float64(bucketCount)
		toMs := minMs + span*float64(i+1)/float64(bucketCount)
		if i == bucketCount-1 {
			toMs = maxMs
		}
		buckets = append(buckets, SchemaDateBucket{
			From:      time.UnixMilli(int64(fromMs)).UTC().Format(time.RFC3339),
			To:        time.UnixMilli(int64(toMs)).UTC().Format(time.RFC3339),
			Frequency: float64(count) / float64(len(values)),
		})
	}
	stats.Buckets = buckets
	return stats
}

func buildGeoStats(points [][2]float64) *SchemaGeoStats {
	limit := len(points)
	if limit > schemaGeoPointLimit {
		limit = schemaGeoPointLimit
	}
	out := make([]SchemaGeoPoint, 0, limit)
	for i := 0; i < limit; i++ {
		out = append(out, SchemaGeoPoint{Lng: points[i][0], Lat: points[i][1]})
	}
	return &SchemaGeoStats{Points: out}
}

func buildStringStats(counts map[string]int, presence int) *SchemaStringStats {
	type valueCount struct {
		value string
		count int
	}
	rows := make([]valueCount, 0, len(counts))
	for value, count := range counts {
		rows = append(rows, valueCount{value: value, count: count})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].count == rows[j].count {
			return rows[i].value < rows[j].value
		}
		return rows[i].count > rows[j].count
	})

	limit := schemaStringTopN
	if len(rows) < limit {
		limit = len(rows)
	}
	top := make([]SchemaStringBucket, 0, limit)
	for i := 0; i < limit; i++ {
		top = append(top, SchemaStringBucket{
			Value:     rows[i].value,
			Frequency: float64(rows[i].count) / float64(presence),
		})
	}
	return &SchemaStringStats{TopValues: top}
}

func walkDocument(prefix string, value any, acc map[string]*fieldAccumulator) {
	switch v := value.(type) {
	case bson.M:
		for key, child := range v {
			path := key
			if prefix != "" {
				path = prefix + "." + key
			}
			recordField(path, child, acc)
			walkDocument(path, child, acc)
		}
	case map[string]any:
		for key, child := range v {
			path := key
			if prefix != "" {
				path = prefix + "." + key
			}
			recordField(path, child, acc)
			walkDocument(path, child, acc)
		}
	case bson.A:
		if prefix != "" {
			recordField(prefix, v, acc)
		}
		for _, child := range v {
			walkDocument(prefix, child, acc)
		}
	case []any:
		if prefix != "" {
			recordField(prefix, v, acc)
		}
		for _, child := range v {
			walkDocument(prefix, child, acc)
		}
	default:
		if prefix != "" {
			recordField(prefix, v, acc)
		}
	}
}

func recordField(path string, value any, acc map[string]*fieldAccumulator) {
	if path == "" {
		return
	}
	item, ok := acc[path]
	if !ok {
		item = &fieldAccumulator{
			typeCounts: make(map[string]int),
			stringCounts: make(map[string]int),
			sampleSeen: make(map[string]struct{}),
		}
		acc[path] = item
	}
	item.presenceCount++

	typeName := bsonTypeName(value)
	if lng, lat, ok := extractGeoPoint(value); ok {
		typeName = "coordinates"
		if len(item.geoPoints) < schemaGeoPointLimit {
			item.geoPoints = append(item.geoPoints, [2]float64{lng, lat})
		}
	}
	item.typeCounts[typeName]++

	switch typeName {
	case "int", "long", "double", "number":
		if n, ok := numericValue(value); ok {
			item.numberValues = append(item.numberValues, n)
		}
	case "date":
		if dt, ok := dateValue(value); ok {
			item.dateValues = append(item.dateValues, dt)
		}
	case "string":
		if s, ok := value.(string); ok {
			item.stringCounts[s]++
			appendSampleValue(item, s)
		}
	case "bool":
		appendSampleValue(item, fmt.Sprintf("%v", value))
	case "objectId":
		if oid, ok := value.(primitive.ObjectID); ok {
			appendSampleValue(item, oid.Hex())
		}
	case "coordinates":
		if lng, lat, ok := extractGeoPoint(value); ok {
			appendSampleValue(item, fmt.Sprintf("[%g, %g]", lng, lat))
		}
	default:
		if value != nil {
			appendSampleValue(item, fmt.Sprintf("%v", value))
		}
	}
}

func appendSampleValue(item *fieldAccumulator, value string) {
	if len(item.sampleValues) >= schemaSampleValueLimit {
		return
	}
	if _, seen := item.sampleSeen[value]; seen {
		return
	}
	item.sampleSeen[value] = struct{}{}
	item.sampleValues = append(item.sampleValues, value)
}

func numericValue(value any) (float64, bool) {
	switch v := value.(type) {
	case int:
		return float64(v), true
	case int32:
		return float64(v), true
	case int64:
		return float64(v), true
	case float32:
		return float64(v), true
	case float64:
		return v, true
	default:
		return 0, false
	}
}

func dateValue(value any) (time.Time, bool) {
	switch v := value.(type) {
	case primitive.DateTime:
		return v.Time(), true
	case time.Time:
		return v, true
	default:
		return time.Time{}, false
	}
}

func bsonTypeName(value any) string {
	if _, _, ok := extractGeoPoint(value); ok {
		return "coordinates"
	}
	switch value.(type) {
	case nil:
		return "null"
	case bool:
		return "bool"
	case string:
		return "string"
	case int, int32:
		return "int"
	case int64:
		return "long"
	case float32, float64:
		return "double"
	case bson.M, map[string]any:
		return "object"
	case bson.A, []any:
		return "array"
	case primitive.DateTime:
		return "date"
	case primitive.ObjectID:
		return "objectId"
	case primitive.Binary:
		return "binData"
	case primitive.Regex:
		return "regex"
	case primitive.Timestamp:
		return "timestamp"
	case primitive.Decimal128:
		return "decimal"
	default:
		name := fmt.Sprintf("%T", value)
		if idx := strings.LastIndex(name, "."); idx >= 0 {
			name = name[idx+1:]
		}
		return strings.ToLower(name)
	}
}

func extractGeoPoint(value any) (lng, lat float64, ok bool) {
	switch v := value.(type) {
	case bson.M:
		if typ, _ := v["type"].(string); strings.EqualFold(typ, "Point") {
			return coordPairValue(v["coordinates"])
		}
	case map[string]any:
		if typ, _ := v["type"].(string); strings.EqualFold(typ, "Point") {
			return coordPairValue(v["coordinates"])
		}
	case bson.A:
		return coordPairValue(v)
	case []any:
		return coordPairValue(v)
	}
	return 0, 0, false
}

func coordPairValue(raw any) (lng, lat float64, ok bool) {
	switch coords := raw.(type) {
	case bson.A:
		return coordPair(coords[0], coords[1])
	case []any:
		if len(coords) < 2 {
			return 0, 0, false
		}
		return coordPair(coords[0], coords[1])
	default:
		return 0, 0, false
	}
}

func coordPair(lngRaw, latRaw any) (lng, lat float64, ok bool) {
	lng, lngOK := numericValue(lngRaw)
	lat, latOK := numericValue(latRaw)
	if !lngOK || !latOK {
		return 0, 0, false
	}
	if lng < -180 || lng > 180 || lat < -90 || lat > 90 {
		return 0, 0, false
	}
	return lng, lat, true
}

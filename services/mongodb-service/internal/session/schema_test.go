package session

import (
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"
)

func TestBuildSchemaField_mixedTypes(t *testing.T) {
	acc := map[string]*fieldAccumulator{
		"age": {
			presenceCount: 10,
			typeCounts:    map[string]int{"int": 8, "string": 2},
		},
	}
	fields := finalizeSchemaFields(acc, 10)
	if len(fields) != 1 {
		t.Fatalf("expected 1 field, got %d", len(fields))
	}
	field := fields[0]
	if field.Path != "age" {
		t.Fatalf("unexpected path %q", field.Path)
	}
	if field.Frequency != 1 {
		t.Fatalf("expected frequency 1, got %v", field.Frequency)
	}
	if len(field.TypeBreakdown) != 2 {
		t.Fatalf("expected 2 type breakdown entries, got %d", len(field.TypeBreakdown))
	}
	if field.TypeBreakdown[0].Type != "int" || field.TypeBreakdown[0].Frequency != 0.8 {
		t.Fatalf("unexpected primary type breakdown: %+v", field.TypeBreakdown[0])
	}
}

func TestBuildNumberStats_buckets(t *testing.T) {
	stats := buildNumberStats([]float64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}, 10)
	if stats == nil {
		t.Fatal("expected stats")
	}
	if stats.Min != 1 || stats.Max != 10 {
		t.Fatalf("unexpected range: min=%v max=%v", stats.Min, stats.Max)
	}
	if len(stats.Buckets) == 0 {
		t.Fatal("expected buckets")
	}
}

func TestWalkDocument_arrayUsesSharedPrefix(t *testing.T) {
	acc := make(map[string]*fieldAccumulator)
	doc := map[string]any{
		"items": []any{
			map[string]any{"name": "a"},
			map[string]any{"name": "b"},
		},
	}
	walkDocument("", doc, acc)

	if _, ok := acc["items"]; !ok {
		t.Fatal("expected items field")
	}
	if _, ok := acc["items.name"]; !ok {
		t.Fatal("expected items.name field from array elements")
	}
	if acc["items[0]"] != nil {
		t.Fatal("did not expect indexed array paths")
	}
}

func TestBuildDateStats_buckets(t *testing.T) {
	base := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	values := make([]time.Time, 0, 10)
	for i := 0; i < 10; i++ {
		values = append(values, base.Add(time.Duration(i)*24*time.Hour))
	}
	stats := buildDateStats(values)
	if stats == nil || len(stats.Buckets) == 0 {
		t.Fatal("expected date buckets")
	}
}

func TestExtractGeoPoint(t *testing.T) {
	lng, lat, ok := extractGeoPoint(bson.A{116.4, 39.9})
	if !ok || lng != 116.4 || lat != 39.9 {
		t.Fatalf("unexpected geo point: ok=%v lng=%v lat=%v", ok, lng, lat)
	}
}

func TestExtractGeoPoint_geoJSON(t *testing.T) {
	lng, lat, ok := extractGeoPoint(bson.M{
		"type":        "Point",
		"coordinates": bson.A{121.5, 31.2},
	})
	if !ok || lng != 121.5 || lat != 31.2 {
		t.Fatalf("unexpected geojson point: ok=%v lng=%v lat=%v", ok, lng, lat)
	}
}
func TestBuildStringStats_topValues(t *testing.T) {
	stats := buildStringStats(map[string]int{
		"active": 7,
		"draft":  2,
		"archived": 1,
	}, 10)
	if stats == nil || len(stats.TopValues) == 0 {
		t.Fatal("expected top values")
	}
	if stats.TopValues[0].Value != "active" {
		t.Fatalf("expected active first, got %q", stats.TopValues[0].Value)
	}
}

package tree

import (
	"context"
	"database/sql"
)

type CategoryCounts struct {
	Tables     int64 `json:"tables"`
	Views      int64 `json:"views"`
	Procedures int64 `json:"procedures"`
	Functions  int64 `json:"functions"`
	Packages   int64 `json:"packages"`
	Synonyms   int64 `json:"synonyms"`
	Triggers   int64 `json:"triggers"`
	Sequences  int64 `json:"sequences"`
}

func CategoryCountsForSchema(ctx context.Context, db *sql.DB, s string) (o CategoryCounts, err error) {
	for _, v := range []struct {
		q string
		p *int64
	}{
		{"SELECT COUNT(*) FROM ALL_TABLES WHERE OWNER=?", &o.Tables},
		{"SELECT COUNT(*) FROM ALL_VIEWS WHERE OWNER=?", &o.Views},
		{"SELECT COUNT(*) FROM ALL_OBJECTS WHERE OWNER=? AND OBJECT_TYPE='PROCEDURE'", &o.Procedures},
		{"SELECT COUNT(*) FROM ALL_OBJECTS WHERE OWNER=? AND OBJECT_TYPE='FUNCTION'", &o.Functions},
		{"SELECT COUNT(*) FROM ALL_OBJECTS WHERE OWNER=? AND OBJECT_TYPE='PACKAGE'", &o.Packages},
		{"SELECT COUNT(*) FROM ALL_OBJECTS WHERE OWNER=? AND OBJECT_TYPE='TRIGGER'", &o.Triggers},
		{"SELECT COUNT(*) FROM ALL_SEQUENCES WHERE SEQUENCE_OWNER=?", &o.Sequences},
	} {
		if e := db.QueryRowContext(ctx, v.q, s).Scan(v.p); e != nil {
			return o, e
		}
	}
	n, e := countSynonyms(ctx, db, s)
	if e != nil {
		return o, e
	}
	o.Synonyms = n
	return o, nil
}

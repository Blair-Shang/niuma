package sqllsp

import "sync"

// Document 是打开的文本文档。
type Document struct {
	URI     string
	Version int
	Text    string
	// SuggestDatabase 文档级默认库（MySQL=库；金仓=PG database；达梦=schema）。
	SuggestDatabase string
	// SuggestSchema 文档级默认 schema（金仓/PG 系；MySQL 可空，与 Database 同义）。
	SuggestSchema string
}

// docStore 按 URI 存文档。
type docStore struct {
	mu   sync.RWMutex
	docs map[string]*Document
}

func newDocStore() *docStore {
	return &docStore{docs: make(map[string]*Document)}
}

func (s *docStore) put(uri string, version int, text string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	suggestDB, suggestSch := "", ""
	if old, ok := s.docs[uri]; ok {
		suggestDB = old.SuggestDatabase
		suggestSch = old.SuggestSchema
	}
	s.docs[uri] = &Document{
		URI:             uri,
		Version:         version,
		Text:            text,
		SuggestDatabase: suggestDB,
		SuggestSchema:   suggestSch,
	}
}

func (s *docStore) setSuggestDatabase(uri, database, schema string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	db := trimSpaceASCII(database)
	sch := trimSpaceASCII(schema)
	d, ok := s.docs[uri]
	if !ok {
		s.docs[uri] = &Document{URI: uri, SuggestDatabase: db, SuggestSchema: sch}
		return
	}
	d.SuggestDatabase = db
	// 仅当显式传入 schema 键时更新（允许传空串清空）；调用方用 pointer 语义较烦，
	// 这里约定：schema 参数非空才覆盖；空串表示「不改 schema」。
	if sch != "" {
		d.SuggestSchema = sch
	}
}

func trimSpaceASCII(s string) string {
	start, end := 0, len(s)
	for start < end {
		c := s[start]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			start++
			continue
		}
		break
	}
	for end > start {
		c := s[end-1]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			end--
			continue
		}
		break
	}
	return s[start:end]
}

func (s *docStore) Get(uri string) (*Document, bool) {
	return s.get(uri)
}

func (s *docStore) get(uri string) (*Document, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	d, ok := s.docs[uri]
	if !ok {
		return nil, false
	}
	cp := *d
	return &cp, true
}

func (s *docStore) delete(uri string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.docs, uri)
}

func (s *docStore) clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.docs = make(map[string]*Document)
}

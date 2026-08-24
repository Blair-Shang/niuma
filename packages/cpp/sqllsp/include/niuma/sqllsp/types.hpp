#pragma once

#include <string>
#include <vector>

namespace niuma::sqllsp {

/** LSP CompletionItemKind（与 VS Code / Monaco 对齐）。 */
inline constexpr int kLspKeyword = 14;
inline constexpr int kLspModule = 9;
inline constexpr int kLspClass = 7;
inline constexpr int kLspField = 5;
inline constexpr int kLspFunction = 3;
inline constexpr int kLspMethod = 2;
inline constexpr int kLspVariable = 6;
inline constexpr int kLspSnippet = 15;

inline constexpr int kDefaultCatalogLimit = 100;
inline constexpr int kMaxCatalogLimit = 500;

enum class CompletionKind {
  Keyword,
  Schema,
  Table,
  Column,
  Function,
  Routine,
  Snippet,
};

struct Position {
  int line = 0;
  int character = 0;
};

struct Range {
  Position start;
  Position end;
};

struct Diagnostic {
  Range range;
  int severity = 1;
  std::string source;
  std::string message;
};

struct CompletionItem {
  std::string label;
  int kind = 0;
  std::string detail;
  std::string insert_text;
  std::string documentation;
  std::string sort_text;
};

struct TableRef {
  std::string schema;
  std::string name;
  std::string alias;
  bool virtual_table = false;
  std::vector<std::string> columns;
};

struct CompletionContext {
  std::vector<CompletionKind> expect;
  std::string schema;
  std::string table;
  std::string prefix;
  std::vector<std::string> keywords;
  std::vector<CompletionItem> snippets;
  std::vector<CompletionItem> functions;
  std::vector<TableRef> tables;
  std::vector<std::string> locals;
  std::string routine_filter;
};

struct CatalogParams {
  std::string session_id;
  std::string database;
  std::string schema;
  std::string table;
  std::string prefix;
  int limit = kDefaultCatalogLimit;
  bool exclude_system = true;
};

struct SchemaHit {
  std::string name;
};

struct TableHit {
  std::string name;
  std::string type;
  std::string schema;
};

struct ColumnHit {
  std::string name;
  std::string data_type;
  std::string schema;
  std::string table;
};

struct RoutineHit {
  std::string name;
  std::string type;  // function | procedure
};

}  // namespace niuma::sqllsp

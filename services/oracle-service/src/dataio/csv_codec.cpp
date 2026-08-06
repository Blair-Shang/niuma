#include "dataio/csv_codec.hpp"

#include <algorithm>
#include <cctype>
#include <unordered_set>

namespace niuma::oracle::dataio {
namespace {

std::string Trim(std::string value) {
  size_t begin = 0;
  while (begin < value.size() && std::isspace(static_cast<unsigned char>(value[begin]))) {
    ++begin;
  }
  size_t end = value.size();
  while (end > begin && std::isspace(static_cast<unsigned char>(value[end - 1]))) {
    --end;
  }
  return value.substr(begin, end - begin);
}

std::string Fold(std::string value) {
  value = Trim(std::move(value));
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
    return static_cast<char>(std::toupper(c));
  });
  return value;
}

}  // namespace

CsvRecordReader::CsvRecordReader(std::istream& input, char delimiter)
    : input_(input), delimiter_(delimiter) {}

int CsvRecordReader::Get() {
  const int ch = input_.get();
  if (ch != std::char_traits<char>::eof()) {
    ++bytes_read_;
  }
  return ch;
}

int CsvRecordReader::Peek() { return input_.peek(); }

bool CsvRecordReader::Read(std::vector<std::string>& record, std::string& error) {
  record.clear();
  error.clear();
  std::string cell;
  bool in_quotes = false;
  bool saw_any = false;
  bool after_quote = false;

  while (true) {
    const int raw = Get();
    if (raw == std::char_traits<char>::eof()) {
      if (in_quotes) {
        error = "oracle: malformed csv: unterminated quoted field";
        return false;
      }
      if (!saw_any && cell.empty() && record.empty()) {
        return false;
      }
      record.push_back(std::move(cell));
      first_record_ = false;
      return true;
    }

    char ch = static_cast<char>(raw);
    saw_any = true;
    if (first_record_ && record.empty() && cell.empty() &&
        static_cast<unsigned char>(ch) == 0xEF) {
      const int b2 = Get();
      const int b3 = Get();
      if (b2 == 0xBB && b3 == 0xBF) {
        continue;
      }
      error = "oracle: malformed utf-8 BOM";
      return false;
    }

    if (in_quotes) {
      if (ch == '"') {
        if (Peek() == '"') {
          (void)Get();
          cell.push_back('"');
        } else {
          in_quotes = false;
          after_quote = true;
        }
      } else {
        cell.push_back(ch);
      }
      continue;
    }

    if (after_quote) {
      if (ch == delimiter_) {
        record.push_back(std::move(cell));
        cell.clear();
        after_quote = false;
        continue;
      }
      if (ch == '\n') {
        record.push_back(std::move(cell));
        first_record_ = false;
        return true;
      }
      if (ch == '\r') {
        if (Peek() == '\n') (void)Get();
        record.push_back(std::move(cell));
        first_record_ = false;
        return true;
      }
      if (ch == ' ' || ch == '\t') {
        continue;
      }
      error = "oracle: malformed csv: characters after closing quote";
      return false;
    }

    if (ch == '"' && cell.empty()) {
      in_quotes = true;
      continue;
    }
    if (ch == delimiter_) {
      record.push_back(std::move(cell));
      cell.clear();
      continue;
    }
    if (ch == '\n' || ch == '\r') {
      if (ch == '\r' && Peek() == '\n') (void)Get();
      record.push_back(std::move(cell));
      first_record_ = false;
      return true;
    }
    cell.push_back(ch);
  }
}

bool BuildCsvProjection(
    const std::vector<std::string>& source_columns,
    const std::unordered_map<std::string, std::string>& column_map,
    const std::vector<std::string>& table_columns, CsvProjection& out, std::string& error) {
  out = {};
  error.clear();
  std::unordered_map<std::string, std::string> actual_columns;
  for (const auto& column : table_columns) {
    actual_columns[Fold(column)] = column;
  }
  std::unordered_map<std::string, std::string> folded_map;
  for (const auto& [source, target] : column_map) {
    folded_map[Fold(source)] = Trim(target);
  }
  std::unordered_set<std::string> used_targets;
  for (size_t i = 0; i < source_columns.size(); ++i) {
    const std::string source = Trim(source_columns[i]);
    std::string target = source;
    if (!column_map.empty()) {
      const auto mapped = folded_map.find(Fold(source));
      if (mapped == folded_map.end() || mapped->second.empty()) {
        continue;
      }
      target = mapped->second;
    }
    const auto actual = actual_columns.find(Fold(target));
    if (actual == actual_columns.end()) {
      error = "oracle: csv target column not found: " + target;
      return false;
    }
    const std::string key = Fold(actual->second);
    if (!used_targets.insert(key).second) {
      error = "oracle: duplicate csv target column: " + actual->second;
      return false;
    }
    out.source_columns.push_back(source);
    out.target_columns.push_back(actual->second);
    out.source_indexes.push_back(i);
  }
  if (out.target_columns.empty()) {
    error = "oracle: column map produced no target columns";
    return false;
  }
  return true;
}

}  // namespace niuma::oracle::dataio

#pragma once

#include <cstdint>
#include <istream>
#include <string>
#include <unordered_map>
#include <vector>

namespace niuma::oracle::dataio {

class CsvRecordReader {
 public:
  CsvRecordReader(std::istream& input, char delimiter);

  // EOF 返回 false 且 error 为空；格式错误返回 false 且 error 非空。
  bool Read(std::vector<std::string>& record, std::string& error);
  int64_t bytes_read() const { return bytes_read_; }

 private:
  int Get();
  int Peek();

  std::istream& input_;
  char delimiter_;
  int64_t bytes_read_ = 0;
  bool first_record_ = true;
};

struct CsvProjection {
  std::vector<std::string> source_columns;
  std::vector<std::string> target_columns;
  std::vector<size_t> source_indexes;
};

bool BuildCsvProjection(
    const std::vector<std::string>& source_columns,
    const std::unordered_map<std::string, std::string>& column_map,
    const std::vector<std::string>& table_columns, CsvProjection& out, std::string& error);

}  // namespace niuma::oracle::dataio

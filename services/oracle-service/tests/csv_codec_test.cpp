#include "dataio/csv_codec.hpp"

#include <iostream>
#include <sstream>

static int failures = 0;

#define EXPECT(cond)                                               \
  do {                                                             \
    if (!(cond)) {                                                 \
      std::cerr << "FAIL: " << #cond << " @ " << __LINE__ << "\n"; \
      ++failures;                                                  \
    }                                                              \
  } while (0)

int main() {
  using niuma::oracle::dataio::BuildCsvProjection;
  using niuma::oracle::dataio::CsvProjection;
  using niuma::oracle::dataio::CsvRecordReader;

  {
    std::istringstream input("\xEF\xBB\xBFid,text\r\n1,\"hello\nworld\"\r\n2,\"a\"\"b\"\n");
    CsvRecordReader reader(input, ',');
    std::vector<std::string> row;
    std::string error;
    EXPECT(reader.Read(row, error));
    EXPECT(row.size() == 2 && row[0] == "id" && row[1] == "text");
    EXPECT(reader.Read(row, error));
    EXPECT(row.size() == 2 && row[1] == "hello\nworld");
    EXPECT(reader.Read(row, error));
    EXPECT(row.size() == 2 && row[1] == "a\"b");
    EXPECT(!reader.Read(row, error));
    EXPECT(error.empty());
  }

  {
    CsvProjection projection;
    std::string error;
    EXPECT(BuildCsvProjection({"source_id", "skip", "NAME"},
                              {{"source_id", "ID"}, {"skip", ""}, {"name", "display_name"}},
                              {"ID", "DISPLAY_NAME"}, projection, error));
    EXPECT(projection.target_columns.size() == 2);
    EXPECT(projection.target_columns[0] == "ID");
    EXPECT(projection.target_columns[1] == "DISPLAY_NAME");
    EXPECT(projection.source_indexes[1] == 2);
  }

  {
    CsvProjection projection;
    std::string error;
    EXPECT(!BuildCsvProjection({"a", "b"}, {{"a", "ID"}, {"b", "id"}}, {"ID"},
                               projection, error));
    EXPECT(error.find("duplicate") != std::string::npos);
  }

  if (failures != 0) return 1;
  std::cout << "ok\n";
  return 0;
}

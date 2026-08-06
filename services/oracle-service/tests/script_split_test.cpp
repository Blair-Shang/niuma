#include "dataio/script_split.hpp"

#include <algorithm>
#include <cstdint>
#include <iostream>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

static int failures = 0;

#define EXPECT(cond)                                               \
  do {                                                             \
    if (!(cond)) {                                                 \
      std::cerr << "FAIL: " << #cond << " @ " << __LINE__ << "\n"; \
      ++failures;                                                  \
    }                                                              \
  } while (0)

int main() {
  using niuma::oracle::dataio::LooksLikePlsqlUnit;
  using niuma::oracle::dataio::SplitSqlScript;
  using niuma::oracle::dataio::SqlScriptSplitter;

  {
    const auto got = SplitSqlScript("CREATE TABLE t (id INT);\nINSERT INTO t VALUES (1);\n");
    EXPECT(got.size() == 2);
    EXPECT(got[0].find("CREATE TABLE") != std::string::npos);
    EXPECT(got[1].find("INSERT INTO") != std::string::npos);
  }

  {
    const std::string src = R"(
CREATE OR REPLACE PROCEDURE p AS
BEGIN
  NULL;
  INSERT INTO t VALUES (1);
END;
/

CREATE TABLE x (id INT);
)";
    const auto got = SplitSqlScript(src);
    EXPECT(got.size() == 2);
    EXPECT(got[0].find("CREATE OR REPLACE PROCEDURE") != std::string::npos);
    EXPECT(got[0].find("INSERT INTO t") != std::string::npos);
    EXPECT(got[0].find("CREATE TABLE") == std::string::npos);
    EXPECT(got[1].find("CREATE TABLE") != std::string::npos);
  }

  {
    const std::string src = R"(
CREATE OR REPLACE PACKAGE pkg AS
  PROCEDURE foo;
END;
/

CREATE OR REPLACE PACKAGE BODY pkg AS
  PROCEDURE foo IS
  BEGIN
    NULL;
  END;
END;
/
)";
    const auto got = SplitSqlScript(src);
    EXPECT(got.size() == 2);
    EXPECT(got[0].find("PACKAGE") != std::string::npos);
    EXPECT(got[0].find("PACKAGE BODY") == std::string::npos);
    EXPECT(got[1].find("PACKAGE BODY") != std::string::npos);
  }

  {
    const auto got = SplitSqlScript("INSERT INTO t VALUES ('a;b');");
    EXPECT(got.size() == 1);
    EXPECT(got[0].find("'a;b'") != std::string::npos);
  }

  {
    const std::string src =
        "-- leading comment\n"
        "INSERT INTO t VALUES (q'[a;--b]'); /* split-boundary comment */\n"
        "CREATE OR REPLACE PROCEDURE p AS\n"
        "BEGIN\n"
        "  INSERT INTO t VALUES ('x'';y');\n"
        "END;\n"
        "/\n"
        "SELECT \"a;\" FROM dual;";
    const auto expected = SplitSqlScript(src);
    EXPECT(expected.size() == 3);

    // 每一种固定 chunk 大小都必须与原有一次性 API 完全一致。
    for (std::size_t chunk_size = 1; chunk_size <= src.size(); ++chunk_size) {
      std::vector<std::string> got;
      SqlScriptSplitter splitter([&](std::string&& sql, std::uint64_t) {
        got.push_back(std::move(sql));
        return true;
      });
      for (std::size_t pos = 0; pos < src.size(); pos += chunk_size) {
        EXPECT(splitter.Feed(
            std::string_view(src).substr(pos, std::min(chunk_size, src.size() - pos))));
      }
      EXPECT(splitter.Finish());
      EXPECT(got == expected);
      EXPECT(splitter.bytes_consumed() == src.size());
    }
  }

  {
    std::vector<std::uint64_t> offsets;
    std::vector<std::string> got;
    SqlScriptSplitter splitter([&](std::string&& sql, std::uint64_t bytes) {
      got.push_back(std::move(sql));
      offsets.push_back(bytes);
      return true;
    });
    EXPECT(splitter.Feed("A"));
    EXPECT(splitter.Feed(";\nB"));
    EXPECT(splitter.Feed(";"));
    EXPECT(splitter.Finish());
    EXPECT(got == std::vector<std::string>({"A", "B"}));
    EXPECT(offsets == std::vector<std::uint64_t>({2, 5}));
  }

  {
    std::istringstream input("SELECT 1;\nSELECT q'{x;y}' FROM dual;");
    std::vector<std::string> got;
    EXPECT(SplitSqlScript(input,
                          [&](std::string&& sql, std::uint64_t) {
                            got.push_back(std::move(sql));
                            return true;
                          },
                          2));
    EXPECT(got.size() == 2);
    EXPECT(got[1].find("q'{x;y}'") != std::string::npos);
  }

  {
    int emitted = 0;
    SqlScriptSplitter splitter([&](std::string&&, std::uint64_t) {
      ++emitted;
      return false;
    });
    EXPECT(!splitter.Feed("SELECT 1; SELECT 2;"));
    EXPECT(emitted == 1);
    EXPECT(!splitter.Finish());
  }

  EXPECT(!LooksLikePlsqlUnit("CREATE TABLE t (id INT)"));
  EXPECT(LooksLikePlsqlUnit("CREATE OR REPLACE PROCEDURE p AS"));
  EXPECT(LooksLikePlsqlUnit("-- c\nCREATE FUNCTION f RETURN INT AS"));
  EXPECT(LooksLikePlsqlUnit("CREATE OR REPLACE PACKAGE BODY p AS"));
  EXPECT(LooksLikePlsqlUnit("CREATE OR REPLACE TRIGGER tr BEFORE INSERT ON t"));
  EXPECT(LooksLikePlsqlUnit("DECLARE\n  x INT;"));
  EXPECT(LooksLikePlsqlUnit("BEGIN\n  NULL;\nEND;"));
  EXPECT(!LooksLikePlsqlUnit("INSERT INTO t VALUES (1)"));
  EXPECT(!LooksLikePlsqlUnit("DROP PROCEDURE p"));

  // 小写 create 也应识别
  EXPECT(LooksLikePlsqlUnit("create or replace procedure p as"));

  if (failures != 0) {
    std::cerr << failures << " failure(s)\n";
    return 1;
  }
  std::cout << "ok\n";
  return 0;
}

#include "niuma/sqllsp/heuristic.hpp"

#include <iostream>
#include <string>

static int failures = 0;

#define EXPECT(cond)                                               \
  do {                                                             \
    if (!(cond)) {                                                 \
      std::cerr << "FAIL: " << #cond << " @ " << __LINE__ << "\n"; \
      ++failures;                                                  \
    }                                                              \
  } while (0)

int main() {
  using niuma::sqllsp::CompletionKind;
  using niuma::sqllsp::HeuristicCompletionContext;
  using niuma::sqllsp::Position;

  const std::vector<std::string> kws = {"SELECT", "FROM", "WHERE"};

  {
    const auto cc = HeuristicCompletionContext("SELECT * FROM ", Position{0, 14}, kws);
    bool has_table = false;
    for (const auto k : cc.expect) {
      if (k == CompletionKind::Table) has_table = true;
    }
    EXPECT(has_table);
  }

  {
    const auto cc =
        HeuristicCompletionContext("SELECT * FROM emp e WHERE e.", Position{0, 28}, kws);
    bool has_col = false;
    for (const auto k : cc.expect) {
      if (k == CompletionKind::Column) has_col = true;
    }
    EXPECT(has_col);
    EXPECT(cc.table == "emp" || !cc.table.empty());
  }

  {
    const auto cc =
        HeuristicCompletionContext("SELECT a FROM t ORDER BY ", Position{0, 24}, kws);
    bool has_col = false;
    for (const auto k : cc.expect) {
      if (k == CompletionKind::Column) has_col = true;
    }
    EXPECT(has_col);
  }

  {
    const auto cc =
        HeuristicCompletionContext("SELECT * FROM t CONNECT BY ", Position{0, 27}, kws);
    bool has_col = false;
    for (const auto k : cc.expect) {
      if (k == CompletionKind::Column) has_col = true;
    }
    EXPECT(has_col);
  }

  if (failures != 0) {
    std::cerr << failures << " failure(s)\n";
    return 1;
  }
  std::cout << "ok\n";
  return 0;
}

#include "meta/system_users.hpp"
#include "util/ident.hpp"
#include "util/sql_literal.hpp"

#include <iostream>

static int failures = 0;

#define EXPECT(cond)                                                         \
  do {                                                                       \
    if (!(cond)) {                                                           \
      std::cerr << "FAIL: " << #cond << " @ " << __LINE__ << "\n";           \
      ++failures;                                                            \
    }                                                                        \
  } while (0)

int main() {
  using namespace niuma::oracle;

  EXPECT(util::QuoteIdent("SCOTT") == "\"SCOTT\"");
  EXPECT(util::QuoteIdent("A\"B") == "\"A\"\"B\"");
  EXPECT(util::QuoteIdent("").empty());
  EXPECT(util::IsSafeIdent("SCOTT"));
  EXPECT(util::IsSafeIdent("APP_USER$1"));
  EXPECT(!util::IsSafeIdent("SCOTT; DROP"));
  EXPECT(!util::IsSafeIdent("A\"B"));

  EXPECT(util::QuoteLiteral("O'Reilly") == "'O''Reilly'");
  EXPECT(util::LikePrefixPattern("a%b") == "a\\%b%");
  EXPECT(util::ClampListLimit(0) == 500);
  EXPECT(util::ClampListLimit(99999) == 5000);

  EXPECT(meta::IsSystemSchema("SYS"));
  EXPECT(meta::IsSystemSchema("sys"));
  EXPECT(meta::IsSystemSchema("APEX_040000"));
  EXPECT(!meta::IsSystemSchema("SCOTT"));
  EXPECT(!meta::IsSystemSchema("HR"));

  if (failures != 0) {
    std::cerr << failures << " failure(s)\n";
    return 1;
  }
  std::cout << "util_test ok\n";
  return 0;
}

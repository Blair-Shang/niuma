#include "meta/system_users.hpp"
#include "util/connection_error.hpp"
#include "util/ident.hpp"
#include "util/sql_literal.hpp"
#include "util/utf8.hpp"

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

  EXPECT(util::IsValidUtf8("hello"));
  EXPECT(util::IsValidUtf8("中文OK"));
  EXPECT(!util::IsValidUtf8("\xff\xfe bad"));
  EXPECT(util::EnsureUtf8("plain") == "plain");
  EXPECT(util::IsValidUtf8(util::EnsureUtf8("\xff\xfe")));

  EXPECT(util::IsConnectionLost("oracle: DPI-1080: connection was closed by ORA-03113"));
  EXPECT(util::IsConnectionLost("ORA-03113: end-of-file on communication channel"));
  EXPECT(util::IsConnectionLost("session closed, please reconnect"));
  EXPECT(!util::IsConnectionLost("ORA-00902: invalid datatype"));
  EXPECT(!util::IsConnectionLost("ORA-04088: error during execution of trigger"));

  if (failures != 0) {
    std::cerr << failures << " failure(s)\n";
    return 1;
  }
  std::cout << "util_test ok\n";
  return 0;
}

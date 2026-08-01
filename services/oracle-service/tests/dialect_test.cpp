#include "dialect/profile.hpp"

#include <cstdlib>
#include <iostream>

static int failures = 0;

#define EXPECT(cond)                                   \
  do {                                                 \
    if (!(cond)) {                                     \
      std::cerr << "FAIL: " << #cond << " @ " << __LINE__ << "\n"; \
      ++failures;                                      \
    }                                                  \
  } while (0)

int main() {
  using namespace niuma::oracle::dialect;

  EXPECT(LooksLikeOracle("Oracle Database 19c Enterprise Edition Release 19.0.0.0.0"));
  EXPECT(!LooksLikeOracle("DM Database Server 64 V8"));
  EXPECT(!LooksLikeOracle("PostgreSQL 14.0"));

  const auto p = ResolveCapabilities("Oracle Database 19c Enterprise Edition Release 19.21.0.0.0", true);
  EXPECT(p.family == "oracle");
  EXPECT(p.version_num.find("19") == 0);
  bool has_slash = false;
  bool has_cdb = false;
  for (const auto& c : p.capabilities) {
    if (c == kCapScriptOracleSlash) {
      has_slash = true;
    }
    if (c == kCapCdbPdb) {
      has_cdb = true;
    }
  }
  EXPECT(has_slash);
  EXPECT(has_cdb);

  if (failures != 0) {
    std::cerr << failures << " failure(s)\n";
    return 1;
  }
  std::cout << "dialect_test ok\n";
  return 0;
}

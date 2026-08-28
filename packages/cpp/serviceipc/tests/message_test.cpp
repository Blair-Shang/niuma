#include <niuma/serviceipc/message.hpp>

#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

static int failures = 0;

#define EXPECT(cond)                                                         \
  do {                                                                       \
    if (!(cond)) {                                                           \
      std::cerr << "FAIL: " << #cond << " @ " << __LINE__ << "\n";           \
      ++failures;                                                            \
    }                                                                        \
  } while (0)

#ifndef NIUMA_IPC_GOLDEN_DIR
#define NIUMA_IPC_GOLDEN_DIR ""
#endif

static std::string ReadFile(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    std::cerr << "FAIL: open " << path << "\n";
    ++failures;
    return {};
  }
  std::ostringstream ss;
  ss << in.rdbuf();
  std::string s = ss.str();
  while (!s.empty() && (s.back() == '\n' || s.back() == '\r')) {
    s.pop_back();
  }
  return s;
}

static std::string Golden(const char* name) {
  return std::string(NIUMA_IPC_GOLDEN_DIR) + "/" + name;
}

int main() {
  using namespace niuma::serviceipc;
  const auto ok = MakeOkResponse("req-1", R"({"closed":true})");
  EXPECT(ok == ReadFile(Golden("ok-v1.json")));

  const auto fail_nf = MakeFailResponse("req-2", "method not found: foo");
  EXPECT(fail_nf == ReadFile(Golden("fail-method_not_found-v1.json")));

  const auto fail_eng = MakeFailResponse(
      "req-3", "mysql: server is MariaDB; use mariadb connection kind instead");
  EXPECT(fail_eng == ReadFile(Golden("fail-engine_mismatch-v1.json")));
  EXPECT(InferErrorCode("use the matching connection kind") == "engine_mismatch");
  EXPECT(InferErrorCode("i/o timeout") == "timeout");
  EXPECT(InferErrorCode("read tcp: connection reset by peer") == "lost");

  if (failures != 0) {
    return 1;
  }
  std::cout << "message_test ok\n";
  return 0;
}

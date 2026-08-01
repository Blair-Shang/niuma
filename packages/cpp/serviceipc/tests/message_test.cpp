#include <niuma/serviceipc/message.hpp>

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
  using namespace niuma::serviceipc;
  const auto ok = MakeOkResponse("1", R"({"closed":true})");
  EXPECT(ok.find(R"("ok":true)") != std::string::npos);
  EXPECT(ok.find(R"("id":"1")") != std::string::npos);
  // result 字段为转义后的 JSON 字符串
  EXPECT(ok.find(R"({\"closed\":true})") != std::string::npos);

  const auto fail = MakeFailResponse("2", R"(boom "x")");
  EXPECT(fail.find(R"("ok":false)") != std::string::npos);
  EXPECT(fail.find("boom") != std::string::npos);

  if (failures != 0) {
    return 1;
  }
  std::cout << "message_test ok\n";
  return 0;
}

#include <niuma/serviceipc/frame.hpp>

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
  const std::string payload = R"({"method":"session.test","id":"1"})";
  const auto frame = EncodeFrame(payload);
  EXPECT(frame.size() == 4 + payload.size());

  std::string buffer = frame;
  buffer += EncodeFrame(R"({"ok":true})");
  std::string out;
  std::string err;
  EXPECT(TryReadFrame(buffer, out, err));
  EXPECT(out == payload);
  EXPECT(err.empty());
  EXPECT(TryReadFrame(buffer, out, err));
  EXPECT(out == R"({"ok":true})");
  EXPECT(buffer.empty());

  if (failures != 0) {
    return 1;
  }
  std::cout << "frame_test ok\n";
  return 0;
}

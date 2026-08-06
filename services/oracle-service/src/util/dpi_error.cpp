#include "util/dpi_error.hpp"

#include "util/utf8.hpp"

namespace niuma::oracle::util {

std::string FormatDpiError(dpiContext* ctx, const char* fallback) {
  dpiErrorInfo info{};
  if (ctx != nullptr) {
    dpiContext_getError(ctx, &info);
  }
  if (info.message == nullptr || info.messageLength == 0) {
    return fallback ? fallback : "oracle: ODPI error";
  }
  std::string raw(info.message, info.messageLength);
  while (!raw.empty()) {
    const unsigned char c = static_cast<unsigned char>(raw.back());
    if (c == 0 || c == ' ' || c == '\n' || c == '\r' || c == '\t') {
      raw.pop_back();
      continue;
    }
    break;
  }
  return std::string("oracle: ") + EnsureUtf8(raw);
}

}  // namespace niuma::oracle::util

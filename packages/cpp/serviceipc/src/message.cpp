#include <niuma/serviceipc/message.hpp>

#include <cctype>
#include <cstdio>
#include <string>

namespace niuma::serviceipc {

std::string EscapeJsonString(std::string_view s) {
  std::string out;
  out.reserve(s.size() + 8);
  for (const unsigned char c : s) {
    switch (c) {
      case '\\':
        out += "\\\\";
        break;
      case '"':
        out += "\\\"";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      case '\t':
        out += "\\t";
        break;
      default:
        if (c < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof(buf), "\\u%04x", c);
          out += buf;
        } else {
          out.push_back(static_cast<char>(c));
        }
        break;
    }
  }
  return out;
}

std::string InferErrorCode(std::string_view error) {
  std::string m(error);
  std::string lower;
  lower.reserve(m.size());
  for (unsigned char c : m) {
    lower.push_back(static_cast<char>(std::tolower(c)));
  }
  auto has = [&](const char* needle) {
    return lower.find(needle) != std::string::npos;
  };
  if (lower.rfind("method not found", 0) == 0) {
    return "method_not_found";
  }
  if (lower.rfind("invalid request json", 0) == 0 || lower.rfind("invalid method", 0) == 0) {
    return "invalid_request";
  }
  if (lower.rfind("invalid params", 0) == 0) {
    return "invalid_params";
  }
  if (has("context canceled") || lower == "cancelled") {
    return "cancelled";
  }
  if (has("deadline exceeded") || has("i/o timeout") || has("timeout exceeded") ||
      has("wait timeout")) {
    return "timeout";
  }
  if (has("broken pipe") || has("connection reset") || has("connection refused") ||
      has("forcibly closed") || has("use of closed network") || has("invalid connection") ||
      has("driver: bad connection") || has("unexpected eof") || has("connection lost") ||
      has("wsasend") || has("wsarecv")) {
    return "lost";
  }
  if (has("unavailable")) {
    return "unavailable";
  }
  if (has("use mariadb connection kind") || has("use the matching connection kind")) {
    return "engine_mismatch";
  }
  return "internal";
}

std::string MakeOkResponse(std::string_view id, std::string_view result_json) {
  std::string out = R"({"v":1,"id":")";
  out += EscapeJsonString(id);
  out += R"(","ok":true,"traceId":")";
  out += EscapeJsonString(id);
  out += R"(","result":")";
  out += EscapeJsonString(result_json);
  out += "\"}";
  return out;
}

std::string MakeFailResponse(std::string_view id, std::string_view error) {
  return MakeFailResponse(id, error, InferErrorCode(error));
}

std::string MakeFailResponse(std::string_view id, std::string_view error,
                             std::string_view error_code) {
  std::string code(error_code);
  if (code.empty()) {
    code = InferErrorCode(error);
  }
  std::string out = R"({"v":1,"id":")";
  out += EscapeJsonString(id);
  out += R"(","ok":false,"error":")";
  out += EscapeJsonString(error);
  out += R"(","errorCode":")";
  out += EscapeJsonString(code);
  out += R"(","traceId":")";
  out += EscapeJsonString(id);
  out += R"(","result":""})";
  return out;
}

}  // namespace niuma::serviceipc

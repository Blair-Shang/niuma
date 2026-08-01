#include <niuma/serviceipc/message.hpp>

#include <cstdio>

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

std::string MakeOkResponse(std::string_view id, std::string_view result_json) {
  std::string out = R"({"id":")";
  out += EscapeJsonString(id);
  out += R"(","ok":true,"result":)";
  // result 在 Go 侧是 JSON 字符串字段；此处按字符串嵌入并转义
  out.push_back('"');
  out += EscapeJsonString(result_json);
  out += "\"}";
  return out;
}

std::string MakeFailResponse(std::string_view id, std::string_view error) {
  std::string out = R"({"id":")";
  out += EscapeJsonString(id);
  out += R"(","ok":false,"error":")";
  out += EscapeJsonString(error);
  out += R"(","result":""})";
  return out;
}

}  // namespace niuma::serviceipc

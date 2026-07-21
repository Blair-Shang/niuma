#include "util/json_util.h"

#include <cctype>

namespace niuma {
namespace {

size_t SkipWs(const std::string& s, size_t i) {
  while (i < s.size() && std::isspace(static_cast<unsigned char>(s[i]))) {
    ++i;
  }
  return i;
}

/** 将 JSON 字符串中的 `\uXXXX` 解码为 UTF-8（BMP）。失败时返回 false。 */
bool AppendJsonUnicodeEscape(const std::string& json, size_t& i, std::string& out) {
  if (i + 4 >= json.size()) {
    return false;
  }
  unsigned code = 0;
  for (int k = 1; k <= 4; ++k) {
    const char h = json[i + static_cast<size_t>(k)];
    code <<= 4;
    if (h >= '0' && h <= '9') {
      code |= static_cast<unsigned>(h - '0');
    } else if (h >= 'a' && h <= 'f') {
      code |= static_cast<unsigned>(h - 'a' + 10);
    } else if (h >= 'A' && h <= 'F') {
      code |= static_cast<unsigned>(h - 'A' + 10);
    } else {
      return false;
    }
  }
  i += 4;
  if (code < 0x80) {
    out.push_back(static_cast<char>(code));
  } else if (code < 0x800) {
    out.push_back(static_cast<char>(0xC0 | ((code >> 6) & 0x1F)));
    out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
  } else {
    out.push_back(static_cast<char>(0xE0 | ((code >> 12) & 0x0F)));
    out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
  }
  return true;
}

}  // namespace

std::string JsonGetString(const std::string& json, const char* key) {
  const std::string needle = std::string("\"") + key + "\"";
  const auto key_pos = json.find(needle);
  if (key_pos == std::string::npos) {
    return {};
  }

  auto i = json.find(':', key_pos + needle.size());
  if (i == std::string::npos) {
    return {};
  }
  i = SkipWs(json, i + 1);
  if (i >= json.size() || json[i] != '"') {
    return {};
  }
  ++i;

  // 必须按 JSON 规范还原转义；旧实现把 `\n` 解成字母 `n`，导致 writeText 写出损坏的多行文件。
  std::string out;
  while (i < json.size()) {
    const char ch = json[i];
    if (ch == '"') {
      break;
    }
    if (ch == '\\' && i + 1 < json.size()) {
      ++i;
      switch (json[i]) {
        case '"':
          out.push_back('"');
          break;
        case '\\':
          out.push_back('\\');
          break;
        case '/':
          out.push_back('/');
          break;
        case 'b':
          out.push_back('\b');
          break;
        case 'f':
          out.push_back('\f');
          break;
        case 'n':
          out.push_back('\n');
          break;
        case 'r':
          out.push_back('\r');
          break;
        case 't':
          out.push_back('\t');
          break;
        case 'u':
          if (!AppendJsonUnicodeEscape(json, i, out)) {
            out.push_back('u');
          }
          break;
        default:
          out.push_back(json[i]);
          break;
      }
      ++i;
      continue;
    }
    out.push_back(ch);
    ++i;
  }
  return out;
}

int JsonGetInt(const std::string& json, const char* key, int default_value) {
  const std::string needle = std::string("\"") + key + "\"";
  const auto key_pos = json.find(needle);
  if (key_pos == std::string::npos) {
    return default_value;
  }

  auto i = json.find(':', key_pos + needle.size());
  if (i == std::string::npos) {
    return default_value;
  }
  i = SkipWs(json, i + 1);
  if (i >= json.size()) {
    return default_value;
  }

  bool negative = false;
  if (json[i] == '-') {
    negative = true;
    ++i;
  }
  if (i >= json.size() || !std::isdigit(static_cast<unsigned char>(json[i]))) {
    return default_value;
  }

  long value = 0;
  while (i < json.size() && std::isdigit(static_cast<unsigned char>(json[i]))) {
    value = value * 10 + (json[i] - '0');
    ++i;
  }
  return negative ? static_cast<int>(-value) : static_cast<int>(value);
}

bool JsonGetBool(const std::string& json, const char* key, bool default_value) {
  const std::string needle = std::string("\"") + key + "\"";
  const auto key_pos = json.find(needle);
  if (key_pos == std::string::npos) {
    return default_value;
  }

  auto i = json.find(':', key_pos + needle.size());
  if (i == std::string::npos) {
    return default_value;
  }
  i = SkipWs(json, i + 1);
  if (json.compare(i, 4, "true") == 0) {
    return true;
  }
  if (json.compare(i, 5, "false") == 0) {
    return false;
  }
  return default_value;
}

std::string JsonQuoteString(const std::string& value) {
  std::string out;
  out.reserve(value.size() + 2);
  out.push_back('"');
  for (const unsigned char ch : value) {
    switch (ch) {
      case '"':
        out.append("\\\"");
        break;
      case '\\':
        out.append("\\\\");
        break;
      case '\b':
        out.append("\\b");
        break;
      case '\f':
        out.append("\\f");
        break;
      case '\n':
        out.append("\\n");
        break;
      case '\r':
        out.append("\\r");
        break;
      case '\t':
        out.append("\\t");
        break;
      default:
        if (ch < 0x20) {
          break;
        }
        out.push_back(static_cast<char>(ch));
        break;
    }
  }
  out.push_back('"');
  return out;
}

}  // namespace niuma

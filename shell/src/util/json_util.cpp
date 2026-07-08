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

  std::string out;
  while (i < json.size() && json[i] != '"') {
    if (json[i] == '\\' && i + 1 < json.size()) {
      ++i;
    }
    out.push_back(json[i++]);
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

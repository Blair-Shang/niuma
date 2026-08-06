#include "util/utf8.hpp"

#include <cstdint>

#ifdef NIUMA_OS_WIN
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

namespace niuma::oracle::util {
namespace {

bool DecodeUtf8(std::string_view s, bool replace, std::string* out) {
  if (out) {
    out->clear();
    out->reserve(s.size());
  }
  size_t i = 0;
  while (i < s.size()) {
    const auto c0 = static_cast<unsigned char>(s[i]);
    size_t need = 0;
    uint32_t cp = 0;
    if (c0 <= 0x7F) {
      need = 1;
      cp = c0;
    } else if ((c0 & 0xE0) == 0xC0) {
      need = 2;
      cp = c0 & 0x1F;
    } else if ((c0 & 0xF0) == 0xE0) {
      need = 3;
      cp = c0 & 0x0F;
    } else if ((c0 & 0xF8) == 0xF0) {
      need = 4;
      cp = c0 & 0x07;
    } else {
      if (!replace) {
        return false;
      }
      if (out) {
        out->append("\xEF\xBF\xBD");
      }
      ++i;
      continue;
    }
    if (i + need > s.size()) {
      if (!replace) {
        return false;
      }
      if (out) {
        out->append("\xEF\xBF\xBD");
      }
      break;
    }
    bool ok = true;
    for (size_t j = 1; j < need; ++j) {
      const auto cx = static_cast<unsigned char>(s[i + j]);
      if ((cx & 0xC0) != 0x80) {
        ok = false;
        break;
      }
      cp = (cp << 6) | (cx & 0x3F);
    }
    // overlong / 超范围
    if (ok) {
      if (need == 2 && cp < 0x80) {
        ok = false;
      } else if (need == 3 && cp < 0x800) {
        ok = false;
      } else if (need == 4 && (cp < 0x10000 || cp > 0x10FFFF)) {
        ok = false;
      } else if (cp >= 0xD800 && cp <= 0xDFFF) {
        ok = false;
      }
    }
    if (!ok) {
      if (!replace) {
        return false;
      }
      if (out) {
        out->append("\xEF\xBF\xBD");
      }
      ++i;
      continue;
    }
    if (out) {
      out->append(s.data() + i, need);
    }
    i += need;
  }
  return true;
}

#ifdef NIUMA_OS_WIN
std::string GbkToUtf8(std::string_view gbk) {
  if (gbk.empty()) {
    return {};
  }
  const int src_len = static_cast<int>(gbk.size());
  int wlen = MultiByteToWideChar(936, MB_ERR_INVALID_CHARS, gbk.data(), src_len, nullptr, 0);
  DWORD flags = MB_ERR_INVALID_CHARS;
  if (wlen <= 0) {
    flags = 0;
    wlen = MultiByteToWideChar(936, flags, gbk.data(), src_len, nullptr, 0);
  }
  if (wlen <= 0) {
    return {};
  }
  std::wstring wide(static_cast<size_t>(wlen), L'\0');
  if (MultiByteToWideChar(936, flags, gbk.data(), src_len, wide.data(), wlen) <= 0) {
    return {};
  }
  const int ulen =
      WideCharToMultiByte(CP_UTF8, 0, wide.data(), wlen, nullptr, 0, nullptr, nullptr);
  if (ulen <= 0) {
    return {};
  }
  std::string utf8(static_cast<size_t>(ulen), '\0');
  if (WideCharToMultiByte(CP_UTF8, 0, wide.data(), wlen, utf8.data(), ulen, nullptr, nullptr) <=
      0) {
    return {};
  }
  return utf8;
}
#endif

}  // namespace

bool IsValidUtf8(std::string_view s) {
  return DecodeUtf8(s, false, nullptr);
}

std::string EnsureUtf8(std::string_view s) {
  if (s.empty()) {
    return {};
  }
  if (IsValidUtf8(s)) {
    return std::string(s);
  }
#ifdef NIUMA_OS_WIN
  std::string from_gbk = GbkToUtf8(s);
  if (!from_gbk.empty() && IsValidUtf8(from_gbk)) {
    return from_gbk;
  }
#endif
  std::string replaced;
  DecodeUtf8(s, true, &replaced);
  return replaced;
}

}  // namespace niuma::oracle::util

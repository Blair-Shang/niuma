#include "util/local_fs.h"
#include "util/utf8_path.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <system_error>
#include <vector>

#if defined(OS_WIN)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#else
#include <spawn.h>
extern char** environ;
#endif

namespace fs = std::filesystem;

namespace niuma {

namespace {

std::string JsonEscape(const std::string& value) {
  std::string out;
  out.reserve(value.size() + 8);
  for (char c : value) {
    switch (c) {
      case '"':
        out += "\\\"";
        break;
      case '\\':
        out += "\\\\";
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
      default: {
        const unsigned char u = static_cast<unsigned char>(c);
        if (u < 0x20) {
          char buf[7];
          snprintf(buf, sizeof(buf), "\\u%04x", u);
          out += buf;
        } else {
          out.push_back(c);
        }
        break;
      }
    }
  }
  return out;
}

std::string U8StringToUtf8(const std::u8string& value) {
  return std::string(reinterpret_cast<const char*>(value.data()), value.size());
}

#if defined(OS_WIN)
std::wstring Utf8ToWide(const std::string& value) {
  if (value.empty()) {
    return {};
  }
  const int size = MultiByteToWideChar(CP_UTF8, 0, value.c_str(),
                                       static_cast<int>(value.size()), nullptr, 0);
  if (size <= 0) {
    return {};
  }
  std::wstring out(size, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()),
                      out.empty() ? nullptr : &out[0], size);
  return out;
}
#endif

}  // namespace

bool LocalFs::IsAccessiblePath(const std::string& path, std::string& error) {
  if (path.empty()) {
    error = "path required";
    return false;
  }
  std::error_code ec;
  const fs::path p = Utf8Path(path);
  if (!p.is_absolute()) {
    error = "path must be absolute";
    return false;
  }
  const fs::path normalized = fs::weakly_canonical(p, ec);
  if (ec) {
    error = ec.message();
    return false;
  }
  (void)normalized;
  return true;
}

bool LocalFs::Exists(const std::string& path) {
  std::string error;
  if (!IsAccessiblePath(path, error)) {
    return false;
  }
  std::error_code ec;
  return fs::exists(Utf8Path(path), ec);
}

std::string LocalFs::StatJson(const std::string& path, std::string& error) {
  if (!IsAccessiblePath(path, error)) {
    return {};
  }
  std::error_code ec;
  const fs::path p = Utf8Path(path);
  if (!fs::exists(p, ec)) {
    error = "path not found";
    return {};
  }
  const bool is_dir = fs::is_directory(p, ec);
  const bool is_file = fs::is_regular_file(p, ec);
  std::uintmax_t size = 0;
  if (is_file) {
    size = fs::file_size(p, ec);
    if (ec) {
      error = ec.message();
      return {};
    }
  }
  std::ostringstream ss;
  ss << "{\"path\":\"" << JsonEscape(path) << "\",\"exists\":true"
     << ",\"isDirectory\":" << (is_dir ? "true" : "false")
     << ",\"isFile\":" << (is_file ? "true" : "false") << ",\"size\":" << size
     << "}";
  return ss.str();
}

std::string LocalFs::ReadText(const std::string& path, std::string& error) {
  if (!IsAccessiblePath(path, error)) {
    return {};
  }
  std::ifstream in(Utf8Path(path), std::ios::binary);
  if (!in) {
    error = "failed to open file";
    return {};
  }
  std::ostringstream ss;
  ss << in.rdbuf();
  const std::string content = ss.str();
  std::ostringstream out;
  out << "{\"path\":\"" << JsonEscape(path) << "\",\"content\":\""
      << JsonEscape(content) << "\"}";
  return out.str();
}

std::string LocalFs::ReadTextPrefix(const std::string& path,
                                    std::size_t max_bytes,
                                    std::string& error) {
  if (max_bytes == 0 || max_bytes > kMaxTextPrefixBytes) {
    error = "maxBytes must be between 1 and " +
            std::to_string(kMaxTextPrefixBytes);
    return {};
  }
  if (!IsAccessiblePath(path, error)) {
    return {};
  }

  std::error_code ec;
  const fs::path file_path = Utf8Path(path);
  const std::uintmax_t size = fs::file_size(file_path, ec);
  if (ec) {
    error = ec.message();
    return {};
  }

  std::ifstream in(file_path, std::ios::binary);
  if (!in) {
    error = "failed to open file";
    return {};
  }

  const std::size_t read_limit =
      static_cast<std::size_t>(std::min<std::uintmax_t>(size, max_bytes));
  std::string content(read_limit, '\0');
  in.read(content.data(), static_cast<std::streamsize>(read_limit));
  content.resize(static_cast<std::size_t>(in.gcount()));
  if (!in && !in.eof()) {
    error = "failed to read file";
    return {};
  }

  std::ostringstream out;
  out << "{\"path\":\"" << JsonEscape(path) << "\",\"content\":\""
      << JsonEscape(content) << "\",\"truncated\":"
      << (size > content.size() ? "true" : "false") << ",\"size\":" << size
      << "}";
  return out.str();
}

bool LocalFs::WriteText(const std::string& path, const std::string& content,
                        std::string& error) {
  if (!IsAccessiblePath(path, error)) {
    return false;
  }
  std::ofstream out(Utf8Path(path), std::ios::binary | std::ios::trunc);
  if (!out) {
    error = "failed to open file for write";
    return false;
  }
  out.write(content.data(), static_cast<std::streamsize>(content.size()));
  if (!out) {
    error = "failed to write file";
    return false;
  }
  return true;
}

std::string LocalFs::HomeDirJson(std::string& error) {
#if defined(OS_WIN)
  const char* home = std::getenv("USERPROFILE");
#else
  const char* home = std::getenv("HOME");
#endif
  if (home == nullptr || home[0] == '\0') {
    error = "home directory not found";
    return {};
  }
  std::ostringstream ss;
  ss << "{\"path\":\"" << JsonEscape(home) << "\"}";
  return ss.str();
}

std::string LocalFs::ListDirJson(const std::string& path, std::string& error) {
  if (!IsAccessiblePath(path, error)) {
    return {};
  }
  std::error_code ec;
  const fs::path p = Utf8Path(path);
  if (!fs::exists(p, ec) || !fs::is_directory(p, ec)) {
    error = "path is not a directory";
    return {};
  }

  std::ostringstream ss;
  ss << "{\"path\":\"" << JsonEscape(path) << "\",\"entries\":[";
  bool first = true;
  for (const auto& entry : fs::directory_iterator(p, ec)) {
    if (ec) {
      error = ec.message();
      return {};
    }
    const std::string name = U8StringToUtf8(entry.path().filename().u8string());
    const bool is_dir = entry.is_directory(ec);
    const bool is_file = entry.is_regular_file(ec);
    std::string kind = "file";
    if (is_dir) {
      kind = "dir";
    }
    std::uintmax_t size = 0;
    if (is_file) {
      size = entry.file_size(ec);
      if (ec) {
        ec.clear();
        size = 0;
      }
    }
    if (!first) {
      ss << ',';
    }
    first = false;
    ss << "{\"name\":\"" << JsonEscape(name) << "\",\"kind\":\"" << kind
       << "\",\"size\":" << size << "}";
  }
  ss << "]}";
  return ss.str();
}

bool LocalFs::Mkdir(const std::string& path, std::string& error) {
  if (!IsAccessiblePath(path, error)) {
    return false;
  }
  std::error_code ec;
  const fs::path p = Utf8Path(path);
  if (fs::exists(p, ec)) {
    error = "path already exists";
    return false;
  }
  fs::create_directories(p, ec);
  if (ec) {
    error = ec.message();
    return false;
  }
  return true;
}

bool LocalFs::Rename(const std::string& from_path, const std::string& to_path,
                     std::string& error) {
  if (!IsAccessiblePath(from_path, error)) {
    return false;
  }
  if (!IsAccessiblePath(to_path, error)) {
    return false;
  }
  std::error_code ec;
  const fs::path from = Utf8Path(from_path);
  if (!fs::exists(from, ec)) {
    error = "source path not found";
    return false;
  }
  const fs::path to = Utf8Path(to_path);
  if (fs::exists(to, ec)) {
    error = "destination path already exists";
    return false;
  }
  fs::rename(from, to, ec);
  if (ec) {
    error = ec.message();
    return false;
  }
  return true;
}

bool LocalFs::Delete(const std::string& path, std::string& error) {
  if (!IsAccessiblePath(path, error)) {
    return false;
  }
  std::error_code ec;
  const fs::path p = Utf8Path(path);
  if (!fs::exists(p, ec)) {
    error = "path not found";
    return false;
  }
  fs::remove_all(p, ec);
  if (ec) {
    error = ec.message();
    return false;
  }
  return true;
}

bool LocalFs::ShowInFolder(const std::string& path, std::string& error) {
  if (!IsAccessiblePath(path, error)) {
    return false;
  }
  // 统一成绝对 + 本地分隔符（Windows 下 / 会被 make_preferred 转为 \）。
  // dameng 等服务曾对 outputPath 做 ToSlash，explorer /select 遇正斜杠常落到桌面。
  std::error_code ec;
  fs::path target = fs::weakly_canonical(Utf8Path(path), ec);
  if (ec || target.empty()) {
    target = fs::absolute(Utf8Path(path), ec);
    if (ec || target.empty()) {
      target = Utf8Path(path);
    }
  }
  target = target.lexically_normal().make_preferred();
#if defined(OS_WIN)
  const std::wstring wide = target.wstring();
  if (wide.empty()) {
    error = "invalid path encoding";
    return false;
  }
  PIDLIST_ABSOLUTE pidl = ILCreateFromPathW(wide.c_str());
  if (pidl) {
    const HRESULT hr = SHOpenFolderAndSelectItems(pidl, 0, nullptr, 0);
    ILFree(pidl);
    if (SUCCEEDED(hr)) {
      return true;
    }
  }
  // 回退：带引号的 /select，兼容空格路径与旧环境
  const std::wstring args = L"/select,\"" + wide + L"\"";
  const HINSTANCE result =
      ShellExecuteW(nullptr, L"open", L"explorer.exe", args.c_str(), nullptr, SW_SHOWNORMAL);
  if (reinterpret_cast<intptr_t>(result) <= 32) {
    error = "explorer failed";
    return false;
  }
  return true;
#else
  const fs::path folder = fs::is_directory(target) ? target : target.parent_path();
  if (folder.empty()) {
    error = "folder not found";
    return false;
  }
#if defined(__APPLE__)
  const char* opener = "open";
#else
  const char* opener = "xdg-open";
#endif
  const std::string folder_utf8 = U8StringToUtf8(folder.u8string());
  std::vector<char> folder_arg(folder_utf8.begin(), folder_utf8.end());
  folder_arg.push_back('\0');
  char* argv[] = {const_cast<char*>(opener), folder_arg.data(), nullptr};
  pid_t pid = 0;
  if (posix_spawnp(&pid, opener, nullptr, nullptr, argv, environ) != 0) {
    error = std::string(opener) + " failed";
    return false;
  }
  return true;
#endif
}

bool LocalFs::OpenExternalUrl(const std::string& url, std::string& error) {
  if (url.rfind("https://", 0) != 0 && url.rfind("http://", 0) != 0) {
    error = "only http(s) urls are supported";
    return false;
  }
#if defined(OS_WIN)
  const std::wstring wide = Utf8ToWide(url);
  if (wide.empty()) {
    error = "invalid url encoding";
    return false;
  }
  const HINSTANCE result = ShellExecuteW(nullptr, L"open", wide.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
  if (reinterpret_cast<intptr_t>(result) <= 32) {
    error = "open url failed";
    return false;
  }
  return true;
#else
#if defined(__APPLE__)
  const char* opener = "open";
#else
  const char* opener = "xdg-open";
#endif
  std::vector<char> url_arg(url.begin(), url.end());
  url_arg.push_back('\0');
  char* argv[] = {const_cast<char*>(opener), url_arg.data(), nullptr};
  pid_t pid = 0;
  if (posix_spawnp(&pid, opener, nullptr, nullptr, argv, environ) != 0) {
    error = std::string(opener) + " failed";
    return false;
  }
  return true;
#endif
}

namespace {

bool PathUnderUpdateDir(const std::string& path, std::string& error) {
#if defined(_WIN32)
  char tmp[MAX_PATH];
  const DWORD n = GetTempPathA(MAX_PATH, tmp);
  if (n == 0 || n >= MAX_PATH) {
    error = "temp path unavailable";
    return false;
  }
  std::string root = std::string(tmp) + "niuma-update";
#else
  const char* tmp = std::getenv("TMPDIR");
  if (!tmp || !*tmp) tmp = "/tmp";
  std::string root = std::string(tmp) + "/niuma-update";
#endif
  // 规范化比较：要求 path 以 root + 分隔符开头
  auto norm = [](std::string s) {
    for (char& c : s) {
      if (c == '/') c = '\\';
#ifdef _WIN32
      c = static_cast<char>(::tolower(static_cast<unsigned char>(c)));
#endif
    }
    while (!s.empty() && (s.back() == '\\' || s.back() == '/')) s.pop_back();
    return s;
  };
  const std::string p = norm(path);
  const std::string r = norm(root);
  if (p.size() <= r.size() + 1) {
    error = "path outside update dir";
    return false;
  }
  if (p.compare(0, r.size(), r) != 0 || (p[r.size()] != '\\' && p[r.size()] != '/')) {
    error = "path outside update dir";
    return false;
  }
  return true;
}

}  // namespace

bool LocalFs::LaunchInstaller(const std::string& path, std::string& error) {
  if (path.empty()) {
    error = "path required";
    return false;
  }
  if (!PathUnderUpdateDir(path, error)) {
    return false;
  }
  if (!Exists(path)) {
    error = "installer missing";
    return false;
  }
#if defined(OS_WIN)
  const std::wstring wide = Utf8ToWide(path);
  if (wide.empty()) {
    error = "invalid path encoding";
    return false;
  }
  const HINSTANCE result =
      ShellExecuteW(nullptr, L"open", wide.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
  if (reinterpret_cast<intptr_t>(result) <= 32) {
    error = "launch installer failed";
    return false;
  }
  return true;
#else
  // P0 仅 Windows Setup；非 Windows 由 Web 打开下载链，避免半成品 apply
  error = "apply_unsupported_platform";
  return false;
#endif
}

}  // namespace niuma

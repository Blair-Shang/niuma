#include "util/session_log.h"

#include "util/runtime_paths.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <mutex>
#include <sstream>
#include <system_error>
#include <vector>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <cstdlib>
#include <unistd.h>
#endif

namespace fs = std::filesystem;

namespace niuma {

namespace {

std::string g_session_log_dir;
std::mutex g_log_mu;

/// 保留最近若干次启动的日志目录；更老的会话目录在启动时删除。
constexpr size_t kMaxSessionDirs = 15;
constexpr int kMaxSessionAgeDays = 15;

bool EnsureDir(const std::string& path) {
  std::error_code ec;
  fs::create_directories(fs::u8path(path), ec);
  return !ec;
}

/// 返回按年月日命名的父目录，格式：YYYY-MM-DD
std::string MakeDateDirName() {
  const auto now = std::chrono::system_clock::now();
  const std::time_t t = std::chrono::system_clock::to_time_t(now);
  std::tm tm_buf{};
#if defined(_WIN32)
  localtime_s(&tm_buf, &t);
#else
  localtime_r(&t, &tm_buf);
#endif
  std::ostringstream ss;
  ss << std::put_time(&tm_buf, "%Y-%m-%d");
  return ss.str();
}

/// 返回当次启动的会话子目录，格式：HHMMSS-PID
std::string MakeSessionDirName() {
  const auto now = std::chrono::system_clock::now();
  const std::time_t t = std::chrono::system_clock::to_time_t(now);
  std::tm tm_buf{};
#if defined(_WIN32)
  localtime_s(&tm_buf, &t);
#else
  localtime_r(&t, &tm_buf);
#endif
  std::ostringstream ss;
  ss << std::put_time(&tm_buf, "%H%M%S");
#if defined(_WIN32)
  ss << '-' << GetCurrentProcessId();
#else
  ss << '-' << getpid();
#endif
  return ss.str();
}

std::string FindRepositoryRoot(const fs::path& start) {
  std::error_code ec;
  fs::path cur = fs::absolute(start, ec);
  if (ec) {
    cur = start;
  }
  for (int depth = 0; depth < 12; ++depth) {
    if (fs::exists(cur / "package.json", ec)) {
      return cur.string();
    }
    if (!cur.has_parent_path()) {
      break;
    }
    const fs::path parent = cur.parent_path();
    if (parent == cur) {
      break;
    }
    cur = parent;
  }
  return {};
}

std::string BaseLogRoot() {
  const char* override_root = std::getenv("NIUMMA_LOG_ROOT");
  if (override_root != nullptr && override_root[0] != '\0') {
    return std::string(override_root);
  }
  const std::string install = GetInstallDir();
  const std::string repo = FindRepositoryRoot(fs::u8path(install));
  if (!repo.empty()) {
    return repo + "/logs";
  }
  return install + "/logs";
}

void PruneOldSessionLogs(const fs::path& date_root, const fs::path& keep_dir) {
  std::error_code ec;
  if (!fs::exists(date_root, ec)) {
    return;
  }

  struct DirEntry {
    fs::path path;
    fs::file_time_type mtime;
  };
  std::vector<DirEntry> sessions;
  for (const auto& ent : fs::directory_iterator(date_root, ec)) {
    if (ec || !ent.is_directory(ec)) {
      continue;
    }
    sessions.push_back({ent.path(), fs::last_write_time(ent, ec)});
  }

  std::sort(sessions.begin(), sessions.end(),
            [](const DirEntry& a, const DirEntry& b) { return a.mtime > b.mtime; });

  const auto cutoff = fs::file_time_type::clock::now() -
                      std::chrono::hours(24 * kMaxSessionAgeDays);
  size_t kept = 0;
  for (const auto& entry : sessions) {
    if (fs::equivalent(entry.path, keep_dir, ec)) {
      continue;
    }
    if (entry.mtime < cutoff) {
      fs::remove_all(entry.path, ec);
      continue;
    }
    if (kept >= kMaxSessionDirs) {
      fs::remove_all(entry.path, ec);
      continue;
    }
    ++kept;
  }
}

/// 清理超过 kMaxSessionAgeDays 天的日期目录（YYYY-MM-DD 层）。
void PruneOldDateDirs(const fs::path& log_root) {
  std::error_code ec;
  if (!fs::exists(log_root, ec)) {
    return;
  }
  const auto cutoff = fs::file_time_type::clock::now() -
                      std::chrono::hours(24 * kMaxSessionAgeDays);
  for (const auto& ent : fs::directory_iterator(log_root, ec)) {
    if (ec || !ent.is_directory(ec)) {
      continue;
    }
    const fs::file_time_type mtime = fs::last_write_time(ent, ec);
    if (!ec && mtime < cutoff) {
      fs::remove_all(ent.path(), ec);
    }
  }
}

}  // namespace

void InitSessionLog() {
  if (!g_session_log_dir.empty()) {
    return;
  }
  const std::string log_root = BaseLogRoot();
  const std::string date_dir = log_root + "/" + MakeDateDirName();
  g_session_log_dir = date_dir + "/" + MakeSessionDirName();
  for (char& c : g_session_log_dir) {
    if (c == '\\') {
      c = '/';
    }
  }
  EnsureDir(g_session_log_dir);
  // 清理同一天目录内的旧会话（超过数量/天数限制），以及清理过期的日期目录
  PruneOldSessionLogs(fs::u8path(date_dir), fs::u8path(g_session_log_dir));
  PruneOldDateDirs(fs::u8path(log_root));
#if defined(_WIN32)
  SetEnvironmentVariableA("NIUMMA_LOG_DIR", g_session_log_dir.c_str());
#else
  setenv("NIUMMA_LOG_DIR", g_session_log_dir.c_str(), 1);
#endif
  AppendShellLog("session log initialized");
}

const std::string& GetSessionLogDir() {
  return g_session_log_dir;
}

void AppendShellLog(const std::string& line) {
  if (g_session_log_dir.empty()) {
    return;
  }
  std::lock_guard<std::mutex> lock(g_log_mu);
  const fs::path path = fs::u8path(g_session_log_dir) / "shell.log";
  std::ofstream out(path, std::ios::app);
  if (!out) {
    return;
  }
  const auto now = std::chrono::system_clock::now();
  const std::time_t t = std::chrono::system_clock::to_time_t(now);
  std::tm tm_buf{};
#if defined(_WIN32)
  localtime_s(&tm_buf, &t);
#else
  localtime_r(&t, &tm_buf);
#endif
  out << std::put_time(&tm_buf, "%Y-%m-%d %H:%M:%S") << ' ' << line << '\n';
}

}  // namespace niuma

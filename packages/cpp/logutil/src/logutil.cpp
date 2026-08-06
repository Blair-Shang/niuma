#include <niuma/logutil/logutil.hpp>

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <sstream>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <unistd.h>
#endif

namespace niuma::logutil {
namespace {

namespace fs = std::filesystem;

enum class Level { kInfo, kWarn, kError };

struct RotatingWriter {
  fs::path path;
  std::uint64_t max_size = kMaxFileBytes;
  std::mutex mu;
  std::ofstream file;
  std::uint64_t size = 0;

  bool EnsureOpen() {
    if (file.is_open()) {
      return true;
    }
    file.open(path, std::ios::out | std::ios::app | std::ios::binary);
    if (!file) {
      return false;
    }
    std::error_code ec;
    size = fs::exists(path, ec) ? static_cast<std::uint64_t>(fs::file_size(path, ec)) : 0;
    if (ec) {
      size = 0;
    }
    return true;
  }

  bool Rotate() {
    if (file.is_open()) {
      file.close();
    }
    const fs::path backup = path.string() + ".1";
    std::error_code ec;
    fs::remove(backup, ec);
    if (fs::exists(path, ec)) {
      fs::rename(path, backup, ec);
      if (ec) {
        return false;
      }
    }
    size = 0;
    return EnsureOpen();
  }

  bool Write(const std::string& line) {
    std::lock_guard lock(mu);
    if (!EnsureOpen()) {
      return false;
    }
    if (size + line.size() > max_size) {
      if (!Rotate()) {
        return false;
      }
    }
    file.write(line.data(), static_cast<std::streamsize>(line.size()));
    file.flush();
    if (!file) {
      return false;
    }
    size += line.size();
    return true;
  }
};

struct State {
  std::mutex mu;
  std::string service;
  bool ready = false;
  bool use_file = false;
  RotatingWriter writer;
};

State& GetState() {
  static State state;
  return state;
}

std::string EnvOrEmpty(const char* name) {
  const char* v = std::getenv(name);
  return v ? std::string(v) : std::string{};
}

fs::path FindRepoRoot(const fs::path& start) {
  fs::path dir = start;
  for (int i = 0; i < 12; ++i) {
    if (fs::exists(dir / "package.json")) {
      return dir;
    }
    const fs::path parent = dir.parent_path();
    if (parent == dir) {
      break;
    }
    dir = parent;
  }
  return {};
}

fs::path ExecutableDir() {
#ifdef _WIN32
  wchar_t buf[MAX_PATH];
  const DWORD n = GetModuleFileNameW(nullptr, buf, MAX_PATH);
  if (n == 0 || n >= MAX_PATH) {
    return {};
  }
  return fs::path(buf).parent_path();
#else
  char buf[4096];
  const ssize_t n = readlink("/proc/self/exe", buf, sizeof(buf) - 1);
  if (n <= 0) {
    return {};
  }
  buf[n] = '\0';
  return fs::path(buf).parent_path();
#endif
}

fs::path ResolveLogDir() {
  if (const auto dir = EnvOrEmpty("NIUMMA_LOG_DIR"); !dir.empty()) {
    return fs::path(dir);
  }
  if (const auto root = EnvOrEmpty("NIUMMA_LOG_ROOT"); !root.empty()) {
    return fs::path(root);
  }

  std::error_code ec;
  const fs::path exe_dir = ExecutableDir();
  if (!exe_dir.empty()) {
    if (const auto repo = FindRepoRoot(exe_dir); !repo.empty()) {
      return repo / "logs";
    }
  }
  const fs::path cwd = fs::current_path(ec);
  if (!ec && !cwd.empty()) {
    if (const auto repo = FindRepoRoot(cwd); !repo.empty()) {
      return repo / "logs";
    }
  }
  return {};
}

std::string FormatTimeLocal() {
  using clock = std::chrono::system_clock;
  const auto now = clock::now();
  const std::time_t tt = clock::to_time_t(now);
  std::tm tm{};
#ifdef _WIN32
  localtime_s(&tm, &tt);
#else
  localtime_r(&tt, &tm);
#endif
  std::ostringstream oss;
  oss << std::put_time(&tm, "%Y-%m-%d %H:%M:%S");
  return oss.str();
}

bool NeedsQuote(std::string_view v) {
  if (v.empty()) {
    return true;
  }
  for (const char c : v) {
    if (c == ' ' || c == '"' || c == '=' || c == '\n' || c == '\r' || c == '\t') {
      return true;
    }
  }
  return false;
}

std::string QuoteValue(std::string_view v) {
  if (!NeedsQuote(v)) {
    return std::string(v);
  }
  std::string out;
  out.reserve(v.size() + 2);
  out.push_back('"');
  for (const char c : v) {
    if (c == '"') {
      out.push_back('\\');
    }
    if (c == '\n' || c == '\r') {
      out.push_back(' ');
      continue;
    }
    out.push_back(c);
  }
  out.push_back('"');
  return out;
}

const char* LevelName(Level level) {
  switch (level) {
    case Level::kWarn:
      return "WARN";
    case Level::kError:
      return "ERROR";
    case Level::kInfo:
    default:
      return "INFO";
  }
}

void WriteLine(Level level, std::string_view msg, const std::vector<Attr>& attrs) {
  State& st = GetState();
  std::lock_guard lock(st.mu);
  if (!st.ready) {
    // Init 前：仍打 stderr，避免静默丢失
    std::cerr << LevelName(level) << " " << msg << "\n";
    return;
  }

  std::ostringstream oss;
  oss << "time=" << QuoteValue(FormatTimeLocal()) << " level=" << LevelName(level)
      << " msg=" << QuoteValue(msg) << " service=" << QuoteValue(st.service);
  for (const auto& a : attrs) {
    oss << ' ' << a.key << '=' << QuoteValue(a.value);
  }
  oss << '\n';
  const std::string line = oss.str();

  if (st.use_file) {
    if (st.writer.Write(line)) {
      return;
    }
  }
  std::cerr << line;
}

}  // namespace

Attr::Attr(std::string_view k, std::string_view v) : key(k), value(v) {}
Attr::Attr(std::string_view k, const char* v) : key(k), value(v ? v : "") {}
Attr::Attr(std::string_view k, bool v) : key(k), value(v ? "true" : "false") {}

bool Init(std::string_view service_name) {
  State& st = GetState();
  std::lock_guard lock(st.mu);
  st.service = std::string(service_name);
  st.ready = true;
  st.use_file = false;

  const fs::path dir = ResolveLogDir();
  if (dir.empty()) {
    return true;
  }
  std::error_code ec;
  fs::create_directories(dir, ec);
  if (ec) {
    return false;
  }
  st.writer.path = dir / (st.service + ".log");
  st.writer.max_size = kMaxFileBytes;
  st.use_file = true;
  return true;
}

void Info(std::string_view msg, std::initializer_list<Attr> attrs) {
  WriteLine(Level::kInfo, msg, std::vector<Attr>(attrs));
}
void Warn(std::string_view msg, std::initializer_list<Attr> attrs) {
  WriteLine(Level::kWarn, msg, std::vector<Attr>(attrs));
}
void Error(std::string_view msg, std::initializer_list<Attr> attrs) {
  WriteLine(Level::kError, msg, std::vector<Attr>(attrs));
}

void Info(std::string_view msg, const std::vector<Attr>& attrs) {
  WriteLine(Level::kInfo, msg, attrs);
}
void Warn(std::string_view msg, const std::vector<Attr>& attrs) {
  WriteLine(Level::kWarn, msg, attrs);
}
void Error(std::string_view msg, const std::vector<Attr>& attrs) {
  WriteLine(Level::kError, msg, attrs);
}

}  // namespace niuma::logutil

#include "dataio/atomic_output.hpp"

#include <atomic>
#include <chrono>
#include <system_error>

#ifdef _WIN32
#include <windows.h>
#endif

namespace niuma::oracle::dataio {
namespace {

std::atomic<uint64_t> g_output_sequence{0};

std::filesystem::path TemporaryPath(const std::filesystem::path& target) {
  const auto ticks = std::chrono::steady_clock::now().time_since_epoch().count();
  const auto seq = g_output_sequence.fetch_add(1, std::memory_order_relaxed);
  return target.parent_path() /
         (target.filename().string() + ".niuma-" + std::to_string(ticks) + "-" +
          std::to_string(seq) + ".part");
}

}  // namespace

AtomicOutput::AtomicOutput(const std::string& target_path)
    : target_(std::filesystem::u8path(target_path)), temporary_(TemporaryPath(target_)) {}

AtomicOutput::~AtomicOutput() {
  if (stream_.is_open()) stream_.close();
  if (!committed_) {
    std::error_code ignored;
    std::filesystem::remove(temporary_, ignored);
  }
}

bool AtomicOutput::Open(std::string& error) {
  error.clear();
  if (target_.empty() || target_.filename().empty()) {
    error = "oracle: invalid output path";
    return false;
  }
  std::error_code ec;
  const auto parent = target_.parent_path().empty() ? std::filesystem::current_path(ec)
                                                    : target_.parent_path();
  if (ec || !std::filesystem::exists(parent, ec) || !std::filesystem::is_directory(parent, ec)) {
    error = "oracle: output directory does not exist";
    return false;
  }
  if (std::filesystem::exists(target_, ec) && !std::filesystem::is_regular_file(target_, ec)) {
    error = "oracle: output path is not a regular file";
    return false;
  }
  stream_.open(temporary_, std::ios::binary | std::ios::trunc);
  if (!stream_) {
    error = "oracle: cannot create temporary output file";
    return false;
  }
  return true;
}

bool AtomicOutput::Commit(std::string& error) {
  stream_.flush();
  if (!stream_) {
    error = "oracle: failed to flush output file";
    return false;
  }
  stream_.close();
#ifdef _WIN32
  if (!MoveFileExW(temporary_.wstring().c_str(), target_.wstring().c_str(),
                   MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    error = "oracle: failed to replace output file";
    return false;
  }
#else
  std::error_code ec;
  std::filesystem::rename(temporary_, target_, ec);
  if (ec) {
    error = "oracle: failed to replace output file: " + ec.message();
    return false;
  }
#endif
  committed_ = true;
  return true;
}

}  // namespace niuma::oracle::dataio

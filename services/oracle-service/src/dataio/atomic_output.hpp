#pragma once

#include <filesystem>
#include <fstream>
#include <string>

namespace niuma::oracle::dataio {

class AtomicOutput {
 public:
  explicit AtomicOutput(const std::string& target_path);
  ~AtomicOutput();

  AtomicOutput(const AtomicOutput&) = delete;
  AtomicOutput& operator=(const AtomicOutput&) = delete;

  bool Open(std::string& error);
  std::ofstream& stream() { return stream_; }
  bool Commit(std::string& error);

 private:
  std::filesystem::path target_;
  std::filesystem::path temporary_;
  std::ofstream stream_;
  bool committed_ = false;
};

}  // namespace niuma::oracle::dataio

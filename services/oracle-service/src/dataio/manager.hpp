#pragma once

#include "session/connect.hpp"

#include <atomic>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace niuma::oracle::dataio {

struct CsvOptions {
  bool header = true;
  std::string delimiter = ",";
  std::string null_string = "\\N";
  bool truncate = false;
};

struct DumpParams {
  std::string schema;
  std::vector<std::string> tables;
  std::string mode = "structure_and_data";  // structure_and_data | structure_only | data_only
  std::string output_path;
  bool drop_if_exists = false;
  bool truncate_before_data = false;
  bool include_sequences = false;
};

class Manager {
 public:
  std::string ExportCsv(const session::ConnectParams& connect, const std::string& schema,
                        const std::string& table, const std::string& output_path, CsvOptions opts,
                        std::string& error);
  std::string ImportCsv(const session::ConnectParams& connect, const std::string& schema,
                        const std::string& table, const std::string& input_path, CsvOptions opts,
                        std::string& error);
  std::string DumpSql(const session::ConnectParams& connect, const DumpParams& dump,
                      std::string& error);
  std::string ExecSqlFile(const session::ConnectParams& connect, const std::string& schema,
                          const std::string& input_path, bool continue_on_error, std::string& error);
  bool Cancel(const std::string& task_id);

  void EmitProgress(const std::string& task_id, const std::string& phase, int64_t bytes, int64_t rows,
                    const std::string& message);

 private:
  using CancelFlag = std::shared_ptr<std::atomic<bool>>;
  using JobFn = std::function<std::string(const std::string& task_id, CancelFlag cancel, std::string& err)>;

  std::string StartTask(JobFn job, std::string& error);
  void EmitDone(const std::string& task_id, bool ok, const std::string& message,
                const std::string& output_path);

  std::mutex mu_;
  std::unordered_map<std::string, CancelFlag> tasks_;
};

}  // namespace niuma::oracle::dataio

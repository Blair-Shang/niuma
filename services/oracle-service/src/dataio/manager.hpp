#pragma once

#include "session/connect.hpp"

#include <dpi.h>
#include <atomic>
#include <condition_variable>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

namespace niuma::oracle::dataio {

struct CsvOptions {
  bool header = true;
  std::string delimiter = ",";
  std::string null_string = "\\N";
  bool truncate = false;
  // CSV 源列名 -> Oracle 目标列名；空目标表示跳过该源列。
  std::unordered_map<std::string, std::string> column_map;
};

struct DumpParams {
  std::string schema;
  std::vector<std::string> tables;
  std::string mode = "structure_and_data";  // structure_and_data | structure_only | data_only
  std::string output_path;
  bool drop_if_exists = false;
  bool truncate_before_data = false;
  bool include_tables = false;
  bool include_views = false;
  bool include_procedures = false;
  bool include_functions = false;
  bool include_packages = false;
  bool include_sequences = false;
  bool include_synonyms = false;
  bool include_triggers = false;
};

class CancelState {
 public:
  bool load() const { return canceled_.load(); }
  void store(bool value) { canceled_.store(value); }

  void Attach(dpiConn* connection) {
    std::lock_guard lock(connection_mu_);
    connection_ = connection;
  }
  void Detach(dpiConn* connection) {
    std::lock_guard lock(connection_mu_);
    if (connection_ == connection) connection_ = nullptr;
  }
  void Break() {
    std::lock_guard lock(connection_mu_);
    if (connection_ != nullptr) (void)dpiConn_breakExecution(connection_);
  }

 private:
  std::atomic<bool> canceled_{false};
  std::mutex connection_mu_;
  dpiConn* connection_ = nullptr;
};

using IoCancelFlag = std::shared_ptr<CancelState>;

class Manager {
 public:
  Manager();
  ~Manager();

  Manager(const Manager&) = delete;
  Manager& operator=(const Manager&) = delete;

  std::string ExportCsv(const session::ConnectParams& connect, const std::string& schema,
                        const std::string& table, const std::string& output_path, CsvOptions opts,
                        const std::string& owner, std::string& error);
  std::string ImportCsv(const session::ConnectParams& connect, const std::string& schema,
                        const std::string& table, const std::string& input_path, CsvOptions opts,
                        const std::string& owner, std::string& error);
  std::string DumpSql(const session::ConnectParams& connect, const DumpParams& dump,
                      const std::string& owner, std::string& error);
  std::string ExecSqlFile(const session::ConnectParams& connect, const std::string& schema,
                          const std::string& input_path, bool continue_on_error,
                          const std::string& owner, std::string& error);
  bool Cancel(const std::string& task_id, const std::string& owner);
  size_t CancelByOwner(const std::string& owner);

  void EmitProgress(const std::string& task_id, const std::string& phase, int64_t bytes, int64_t rows,
                    const std::string& message);

 private:
  using CancelFlag = IoCancelFlag;
  using JobFn = std::function<std::string(const std::string& task_id, CancelFlag cancel, std::string& err)>;

  struct TaskRecord {
    CancelFlag cancel;
    std::string owner;
  };
  struct QueuedJob {
    std::string task_id;
    CancelFlag cancel;
    JobFn job;
  };

  std::string StartTask(std::string owner, JobFn job, std::string& error);
  void WorkerLoop();
  void RunJob(QueuedJob queued);
  void EmitDone(const std::string& task_id, bool ok, const std::string& message,
                const std::string& output_path);

  std::mutex mu_;
  std::condition_variable queue_cv_;
  bool stopping_ = false;
  std::deque<QueuedJob> queue_;
  std::vector<std::thread> workers_;
  std::unordered_map<std::string, TaskRecord> tasks_;
  // 限流 progress：每 task 最少间隔，避免大表/持续报错刷爆 IPC 与前端。
  std::unordered_map<std::string, int64_t> progress_last_ms_;
};

}  // namespace niuma::oracle::dataio

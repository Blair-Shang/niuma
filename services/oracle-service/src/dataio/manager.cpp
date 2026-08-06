#include "dataio/manager.hpp"

#include "dataio/ops.hpp"
#include "util/idgen.hpp"

#include <niuma/logutil/logutil.hpp>
#include <niuma/serviceipc/event.hpp>
#include <nlohmann/json.hpp>
#include <chrono>
#include <thread>

namespace niuma::oracle::dataio {
namespace {

CsvOptions NormalizeCsv(CsvOptions opts) {
  if (opts.delimiter.empty()) {
    opts.delimiter = ",";
  }
  if (opts.null_string.empty()) {
    opts.null_string = "\\N";
  }
  return opts;
}

int64_t NowMs() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}

/** 关键进度不节流；常规 running 进度约 ≤5 次/秒。 */
bool ShouldThrottleProgress(const std::string& phase, const std::string& message) {
  if (phase != "running") {
    return false;
  }
  if (message == "queued" || message == "running" || message.empty()) {
    return false;
  }
  // 首条解析/schema、以及错误/跳过明细必须放行；否则快速连续失败时会被 200ms 节流吞掉，
  // 前端只剩最终 abort 文案，看不到真正的 ORA-xxxxx。
  if (message.rfind("current schema", 0) == 0 || message.rfind("parsed ", 0) == 0 ||
      message.rfind("resolving", 0) == 0 || message.rfind("no statements", 0) == 0 ||
      message.rfind("error near ", 0) == 0 || message.rfind("skip statement ", 0) == 0) {
    return false;
  }
  return true;
}

constexpr int64_t kProgressMinIntervalMs = 200;
constexpr size_t kIoWorkerCount = 2;
constexpr size_t kMaxQueuedTasks = 32;

}  // namespace

Manager::Manager() {
  workers_.reserve(kIoWorkerCount);
  for (size_t i = 0; i < kIoWorkerCount; ++i) {
    workers_.emplace_back([this] { WorkerLoop(); });
  }
}

Manager::~Manager() {
  {
    std::lock_guard lock(mu_);
    stopping_ = true;
    for (auto& [task_id, task] : tasks_) {
      (void)task_id;
      task.cancel->store(true);
      task.cancel->Break();
    }
  }
  queue_cv_.notify_all();
  for (auto& worker : workers_) {
    if (worker.joinable()) worker.join();
  }
}

void Manager::EmitProgress(const std::string& task_id, const std::string& phase, int64_t bytes,
                           int64_t rows, const std::string& message) {
  if (ShouldThrottleProgress(phase, message)) {
    const int64_t now = NowMs();
    std::lock_guard lock(mu_);
    auto& last = progress_last_ms_[task_id];
    if (last > 0 && now - last < kProgressMinIntervalMs) {
      return;
    }
    last = now;
  }
  nlohmann::json ev{{"type", "oracle.io.progress"},
                    {"taskId", task_id},
                    {"phase", phase},
                    {"bytes", bytes},
                    {"rows", rows},
                    {"message", message}};
  niuma::serviceipc::PublishEvent(ev.dump());
}

void Manager::EmitDone(const std::string& task_id, bool ok, const std::string& message,
                       const std::string& output_path) {
  {
    std::lock_guard lock(mu_);
    progress_last_ms_.erase(task_id);
  }
  // 异步任务失败不会走 dispatcher 的 LogOpWarn；必须在此落盘，否则日志只剩 io.*.start。
  if (!ok) {
    niuma::logutil::Warn("oracle.io.done",
                         {{"op", "io.done"},
                          {"task", task_id},
                          {"ok", false},
                          {"err", message},
                          {"outputPath", output_path}});
  } else {
    niuma::logutil::Info("oracle.io.done",
                         {{"op", "io.done"},
                          {"task", task_id},
                          {"ok", true},
                          {"outputPath", output_path}});
  }
  nlohmann::json ev{
      {"type", "oracle.io.done"}, {"taskId", task_id}, {"ok", ok}, {"message", message}};
  if (!output_path.empty()) {
    ev["outputPath"] = output_path;
  }
  niuma::serviceipc::PublishEvent(ev.dump());
}

std::string Manager::StartTask(std::string owner, JobFn job, std::string& error) {
  const std::string task_id = util::NextId("iotask");
  auto cancel = std::make_shared<CancelState>();
  {
    std::lock_guard lock(mu_);
    if (stopping_) {
      error = "oracle: IO manager is stopping";
      return {};
    }
    if (queue_.size() >= kMaxQueuedTasks) {
      error = "oracle: too many queued IO tasks";
      return {};
    }
    tasks_[task_id] = TaskRecord{cancel, std::move(owner)};
    queue_.push_back(QueuedJob{task_id, cancel, std::move(job)});
  }
  EmitProgress(task_id, "queued", 0, 0, "queued");
  queue_cv_.notify_one();
  return task_id;
}

void Manager::WorkerLoop() {
  while (true) {
    QueuedJob queued;
    {
      std::unique_lock lock(mu_);
      queue_cv_.wait(lock, [this] { return stopping_ || !queue_.empty(); });
      if (stopping_ && queue_.empty()) return;
      queued = std::move(queue_.front());
      queue_.pop_front();
    }
    RunJob(std::move(queued));
  }
}

void Manager::RunJob(QueuedJob queued) {
  if (queued.cancel->load()) {
    {
      std::lock_guard lock(mu_);
      tasks_.erase(queued.task_id);
    }
    EmitDone(queued.task_id, false, "canceled", {});
    return;
  }
  EmitProgress(queued.task_id, "running", 0, 0, "running");
  std::string err;
  std::string out;
  try {
    out = queued.job(queued.task_id, queued.cancel, err);
  } catch (const std::exception& e) {
    err = e.what();
  } catch (...) {
    err = "oracle: unhandled IO task failure";
  }
  const bool canceled = queued.cancel->load();
  {
    std::lock_guard lock(mu_);
    tasks_.erase(queued.task_id);
  }
  if (canceled || err == "canceled" || err.find("canceled") != std::string::npos) {
    EmitDone(queued.task_id, false, "canceled", out);
  } else if (!err.empty()) {
    EmitDone(queued.task_id, false, err, out);
  } else {
    EmitDone(queued.task_id, true, "completed", out);
  }
}

bool Manager::Cancel(const std::string& task_id, const std::string& owner) {
  std::lock_guard lock(mu_);
  auto it = tasks_.find(task_id);
  if (it == tasks_.end() || it->second.owner != owner) {
    return false;
  }
  it->second.cancel->store(true);
  it->second.cancel->Break();
  return true;
}

size_t Manager::CancelByOwner(const std::string& owner) {
  std::lock_guard lock(mu_);
  size_t count = 0;
  for (auto& [task_id, task] : tasks_) {
    (void)task_id;
    if (task.owner == owner) {
      task.cancel->store(true);
      task.cancel->Break();
      ++count;
    }
  }
  return count;
}

std::string Manager::ExportCsv(const session::ConnectParams& connect, const std::string& schema,
                               const std::string& table, const std::string& output_path,
                               CsvOptions opts, const std::string& owner, std::string& error) {
  if (schema.empty() || table.empty() || output_path.empty()) {
    error = "oracle: schema, table and outputPath required";
    return {};
  }
  opts = NormalizeCsv(std::move(opts));
  return StartTask(owner,
      [this, connect, schema, table, output_path, opts](const std::string& task_id, CancelFlag cancel,
                                                        std::string& err) {
        auto progress = [this, task_id](int64_t b, int64_t r, const std::string& m) {
          EmitProgress(task_id, "running", b, r, m);
        };
        if (!RunExportCsv(connect, schema, table, output_path, opts, cancel, progress, err)) {
          return std::string{};
        }
        return output_path;
      },
      error);
}

std::string Manager::ImportCsv(const session::ConnectParams& connect, const std::string& schema,
                               const std::string& table, const std::string& input_path,
                               CsvOptions opts, const std::string& owner, std::string& error) {
  if (schema.empty() || table.empty() || input_path.empty()) {
    error = "oracle: schema, table and inputPath required";
    return {};
  }
  opts = NormalizeCsv(std::move(opts));
  return StartTask(owner,
      [this, connect, schema, table, input_path, opts](const std::string& task_id, CancelFlag cancel,
                                                       std::string& err) {
        auto progress = [this, task_id](int64_t b, int64_t r, const std::string& m) {
          EmitProgress(task_id, "running", b, r, m);
        };
        if (!RunImportCsv(connect, schema, table, input_path, opts, cancel, progress, err)) {
          return std::string{};
        }
        return input_path;
      },
      error);
}

std::string Manager::DumpSql(const session::ConnectParams& connect, const DumpParams& dump,
                             const std::string& owner, std::string& error) {
  if (dump.schema.empty() || dump.output_path.empty()) {
    error = "oracle: schema and outputPath required";
    return {};
  }
  return StartTask(owner,
      [this, connect, dump](const std::string& task_id, CancelFlag cancel, std::string& err) {
        auto progress = [this, task_id](int64_t b, int64_t r, const std::string& m) {
          EmitProgress(task_id, "running", b, r, m);
        };
        if (!RunDumpSql(connect, dump, cancel, progress, err)) {
          return std::string{};
        }
        return dump.output_path;
      },
      error);
}

std::string Manager::ExecSqlFile(const session::ConnectParams& connect, const std::string& schema,
                                 const std::string& input_path, bool continue_on_error,
                                 const std::string& owner, std::string& error) {
  if (input_path.empty()) {
    error = "oracle: inputPath required";
    return {};
  }
  return StartTask(owner,
      [this, connect, schema, input_path, continue_on_error](const std::string& task_id,
                                                            CancelFlag cancel, std::string& err) {
        auto progress = [this, task_id](int64_t b, int64_t r, const std::string& m) {
          EmitProgress(task_id, "running", b, r, m);
        };
        if (!RunExecSqlFile(connect, schema, input_path, continue_on_error, cancel, progress, err)) {
          return std::string{};
        }
        return input_path;
      },
      error);
}

}  // namespace niuma::oracle::dataio

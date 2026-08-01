#include "dataio/manager.hpp"

#include "dataio/ops.hpp"
#include "util/idgen.hpp"

#include <niuma/serviceipc/event.hpp>
#include <nlohmann/json.hpp>
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

}  // namespace

void Manager::EmitProgress(const std::string& task_id, const std::string& phase, int64_t bytes,
                           int64_t rows, const std::string& message) {
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
  nlohmann::json ev{
      {"type", "oracle.io.done"}, {"taskId", task_id}, {"ok", ok}, {"message", message}};
  if (!output_path.empty()) {
    ev["outputPath"] = output_path;
  }
  niuma::serviceipc::PublishEvent(ev.dump());
}

std::string Manager::StartTask(JobFn job, std::string& error) {
  const std::string task_id = util::NextId("iotask");
  auto cancel = std::make_shared<std::atomic<bool>>(false);
  {
    std::lock_guard lock(mu_);
    tasks_[task_id] = cancel;
  }
  EmitProgress(task_id, "queued", 0, 0, "queued");
  std::thread([this, task_id, cancel, job = std::move(job)]() mutable {
    EmitProgress(task_id, "running", 0, 0, "running");
    std::string err;
    std::string out;
    try {
      out = job(task_id, cancel, err);
    } catch (const std::exception& e) {
      err = e.what();
    }
    const bool canceled = cancel->load();
    {
      std::lock_guard lock(mu_);
      tasks_.erase(task_id);
    }
    if (canceled || err == "canceled" || err.find("canceled") != std::string::npos) {
      EmitDone(task_id, false, "canceled", out);
      return;
    }
    if (!err.empty()) {
      EmitDone(task_id, false, err, out);
      return;
    }
    EmitDone(task_id, true, "completed", out);
  }).detach();
  return task_id;
}

bool Manager::Cancel(const std::string& task_id) {
  std::lock_guard lock(mu_);
  auto it = tasks_.find(task_id);
  if (it == tasks_.end()) {
    return false;
  }
  it->second->store(true);
  return true;
}

std::string Manager::ExportCsv(const session::ConnectParams& connect, const std::string& schema,
                               const std::string& table, const std::string& output_path,
                               CsvOptions opts, std::string& error) {
  if (schema.empty() || table.empty() || output_path.empty()) {
    error = "oracle: schema, table and outputPath required";
    return {};
  }
  opts = NormalizeCsv(std::move(opts));
  return StartTask(
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
                               CsvOptions opts, std::string& error) {
  if (schema.empty() || table.empty() || input_path.empty()) {
    error = "oracle: schema, table and inputPath required";
    return {};
  }
  opts = NormalizeCsv(std::move(opts));
  return StartTask(
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
                             std::string& error) {
  if (dump.schema.empty() || dump.output_path.empty()) {
    error = "oracle: schema and outputPath required";
    return {};
  }
  return StartTask(
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
                                 std::string& error) {
  if (input_path.empty()) {
    error = "oracle: inputPath required";
    return {};
  }
  return StartTask(
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

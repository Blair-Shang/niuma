#pragma once

#include "dataio/manager.hpp"

#include <atomic>
#include <functional>
#include <memory>
#include <string>

namespace niuma::oracle::dataio {

using CancelFlag = IoCancelFlag;
using ProgressFn = std::function<void(int64_t bytes, int64_t rows, const std::string& message)>;

class IoCancelRegistration {
 public:
  IoCancelRegistration(const CancelFlag& cancel, dpiConn* connection)
      : cancel_(cancel), connection_(connection) {
    if (cancel_) cancel_->Attach(connection_);
  }
  ~IoCancelRegistration() {
    if (cancel_) cancel_->Detach(connection_);
  }
  IoCancelRegistration(const IoCancelRegistration&) = delete;
  IoCancelRegistration& operator=(const IoCancelRegistration&) = delete;

 private:
  CancelFlag cancel_;
  dpiConn* connection_;
};

bool RunExportCsv(const session::ConnectParams& connect, const std::string& schema,
                  const std::string& table, const std::string& output_path, const CsvOptions& opts,
                  CancelFlag cancel, ProgressFn progress, std::string& error);

bool RunImportCsv(const session::ConnectParams& connect, const std::string& schema,
                  const std::string& table, const std::string& input_path, const CsvOptions& opts,
                  CancelFlag cancel, ProgressFn progress, std::string& error);

bool RunDumpSql(const session::ConnectParams& connect, const DumpParams& dump, CancelFlag cancel,
                ProgressFn progress, std::string& error);

bool RunExecSqlFile(const session::ConnectParams& connect, const std::string& schema,
                    const std::string& input_path, bool continue_on_error, CancelFlag cancel,
                    ProgressFn progress, std::string& error);

}  // namespace niuma::oracle::dataio

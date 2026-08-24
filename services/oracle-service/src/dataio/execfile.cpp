#include "dataio/ops.hpp"

#include "dataio/script_split.hpp"
#include "session/connect.hpp"
#include "session/manager.hpp"
#include "util/dpi_error.hpp"
#include "util/ident.hpp"
#include "util/stmt_guard.hpp"

#include <array>
#include <cctype>
#include <cstdint>
#include <fstream>
#include <string_view>

namespace niuma::oracle::dataio {
namespace {

bool Canceled(const CancelFlag& cancel) { return cancel && cancel->load(); }

bool OpenIoSession(const session::ConnectParams& connect, session::Session& out, std::string& error) {
  auto opened = session::ConnectAndProbe(connect, error);
  if (!opened.conn) {
    return false;
  }
  out.conn = std::move(opened.conn);
  out.proxy_relay = std::move(opened.proxy_relay);
  out.ssh_tunnel = std::move(opened.ssh_tunnel);
  out.ctx = session::SharedContext(error);
  out.params = connect;
  out.profile = std::move(opened.profile);
  return out.conn && out.ctx;
}

bool ExecSimple(session::Session& s, const std::string& sql, std::string& error) {
  util::StmtGuard stmt;
  dpiStmt* raw = nullptr;
  if (dpiConn_prepareStmt(s.conn.get(), 0, sql.c_str(), static_cast<uint32_t>(sql.size()), nullptr, 0,
                          &raw) < 0) {
    error = util::FormatDpiError(s.ctx.get(), "oracle: exec failed");
    return false;
  }
  stmt.Reset(raw);
  uint32_t cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &cols) < 0) {
    error = util::FormatDpiError(s.ctx.get(), "oracle: exec failed");
    return false;
  }
  return true;
}

std::string ToUpperAscii(std::string s) {
  for (char& c : s) {
    c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
  }
  return s;
}

std::string TrimLeftSpace(std::string s) {
  size_t i = 0;
  while (i < s.size() &&
         (s[i] == ' ' || s[i] == '\t' || s[i] == '\r' || s[i] == '\n' || s[i] == '\f')) {
    ++i;
  }
  return s.substr(i);
}

bool ErrorIndicatesMissingObject(const std::string& err) {
  const std::string msg = ToUpperAscii(err);
  // ORA-00942 table or view does not exist
  // ORA-04043 object does not exist
  // ORA-02289 sequence does not exist
  // ORA-01434 private synonym to be dropped does not exist
  // ORA-04080 trigger … does not exist
  if (msg.find("ORA-00942") != std::string::npos || msg.find("ORA-04043") != std::string::npos ||
      msg.find("ORA-02289") != std::string::npos || msg.find("ORA-01434") != std::string::npos ||
      msg.find("ORA-04080") != std::string::npos) {
    return true;
  }
  return msg.find("DOES NOT EXIST") != std::string::npos;
}

/** DROP 不存在对象：空目标 schema 上属预期，对齐达梦「可跳过」语义。 */
bool IsBenignDropMissingError(const std::string& sql_text, const std::string& err) {
  std::string upper = ToUpperAscii(TrimLeftSpace(sql_text));
  if (upper.rfind("DROP ", 0) != 0) {
    return false;
  }
  return ErrorIndicatesMissingObject(err);
}

/** 数据语句遇到缺表：多半是建表 DDL 已失败或仅导出了 data_only。 */
bool IsDataAgainstMissingTable(const std::string& sql_text, const std::string& err) {
  if (!ErrorIndicatesMissingObject(err)) {
    return false;
  }
  std::string upper = ToUpperAscii(TrimLeftSpace(sql_text));
  return upper.rfind("INSERT ", 0) == 0 || upper.rfind("TRUNCATE ", 0) == 0;
}

bool HasUtf8Bom(std::string_view text) {
  return text.size() >= 3 && static_cast<unsigned char>(text[0]) == 0xEF &&
         static_cast<unsigned char>(text[1]) == 0xBB &&
         static_cast<unsigned char>(text[2]) == 0xBF;
}

void RollbackAfterFailure(session::Session& s, std::string& error) {
  if (dpiConn_rollback(s.conn.get()) < 0) {
    const std::string rollback_error = util::FormatDpiError(s.ctx.get(), "oracle: rollback failed");
    error += "; rollback of uncommitted DML failed";
    if (!rollback_error.empty()) {
      error += ": " + rollback_error;
    }
  } else {
    error += "; uncommitted DML rolled back";
  }
  error += "; some DDL may already have been committed by Oracle";
}

}  // namespace

bool RunExecSqlFile(const session::ConnectParams& connect, const std::string& schema,
                    const std::string& input_path, bool continue_on_error, CancelFlag cancel,
                    ProgressFn progress, std::string& error) {
  session::Session s;
  if (!OpenIoSession(connect, s, error)) {
    return false;
  }
  IoCancelRegistration cancel_registration(cancel, s.conn.get());

  if (!schema.empty()) {
    if (!util::IsSafeIdent(schema)) {
      error = "oracle: invalid schema";
      return false;
    }
    const std::string alter = "ALTER SESSION SET CURRENT_SCHEMA = " + util::QuoteIdent(schema);
    std::string alter_err;
    if (!ExecSimple(s, alter, alter_err)) {
      error = alter_err.empty() ? "oracle: set CURRENT_SCHEMA failed" : alter_err;
      return false;
    }
    if (progress) {
      progress(0, 0, "current schema = " + schema);
    }
  }

  std::ifstream in(input_path, std::ios::binary);
  if (!in) {
    error = "oracle: cannot open sql file";
    return false;
  }

  int executed = 0;
  int failed = 0;
  int skipped = 0;
  int statement_count = 0;
  std::uint64_t total_bytes_read = 0;
  bool stopped = false;
  std::string first_failure;
  std::string last_failure;
  // continue_on_error 时错误日志限流：前 10 条详报，其后每 100 条一条；连续失败过多则中止。
  constexpr int kErrorDetailCap = 10;
  constexpr int kErrorSampleEvery = 100;
  constexpr int kAbortAfterFailsWithNoSuccess = 50;
  constexpr std::size_t kReadChunkSize = 64 * 1024;

  std::array<char, 3> prefix{};
  in.read(prefix.data(), static_cast<std::streamsize>(prefix.size()));
  const std::size_t prefix_size = static_cast<std::size_t>(in.gcount());
  total_bytes_read += prefix_size;
  const bool has_bom = HasUtf8Bom(std::string_view(prefix.data(), prefix_size));

  SqlScriptSplitter splitter(
      [&](std::string&& sql, std::uint64_t bytes_consumed) {
        ++statement_count;
        const int stmt_no = statement_count;
        const int64_t progress_bytes = static_cast<int64_t>(bytes_consumed);

        if (Canceled(cancel)) {
          error = "canceled near statement " + std::to_string(stmt_no);
          stopped = true;
          return false;
        }

        std::string err;
        if (!ExecSimple(s, sql, err)) {
          if (IsBenignDropMissingError(sql, err)) {
            ++skipped;
            if (progress && (skipped <= 5 || skipped % 50 == 0)) {
              progress(progress_bytes, executed,
                       "skip statement " + std::to_string(stmt_no) +
                           " (object already absent)");
            }
            return true;
          }
          if (!continue_on_error) {
            error = "oracle: exec sql file near statement " + std::to_string(stmt_no) + ": " + err;
            stopped = true;
            return false;
          }
          ++failed;
          last_failure = "statement " + std::to_string(stmt_no) + ": " + err;
          if (first_failure.empty()) {
            first_failure = last_failure;
          }
          if (progress && (failed <= kErrorDetailCap || failed % kErrorSampleEvery == 0)) {
            std::string short_err = err;
            if (short_err.size() > 160) {
              short_err.resize(160);
              short_err += "…";
            }
            progress(progress_bytes, executed,
                     "error near statement " + std::to_string(stmt_no) + " (failed " +
                         std::to_string(failed) + "): " + short_err);
          }
          // 建表未成功时 INSERT/TRUNCATE 会连环 ORA-00942；勿等满 50 条才停。
          if (executed == 0 && IsDataAgainstMissingTable(sql, err)) {
            error = "oracle: exec sql file aborted — target table/view missing while applying data (" +
                    last_failure + ")";
            if (!first_failure.empty() && first_failure != last_failure) {
              error += "; first error: " + first_failure;
            }
            error +=
                "; recreate with structure+data dump, or ensure CREATE TABLE succeeded before data";
            stopped = true;
            return false;
          }
          if (executed == 0 && failed >= kAbortAfterFailsWithNoSuccess) {
            error = "oracle: exec sql file aborted after " + std::to_string(failed) +
                    " consecutive errors with 0 success — last error: " + last_failure;
            if (!first_failure.empty() && first_failure != last_failure) {
              error += "; first error: " + first_failure;
            }
            stopped = true;
            return false;
          }
          return true;
        }

        ++executed;
        if (progress && (stmt_no == 1 || stmt_no % 50 == 0)) {
          progress(progress_bytes, executed,
                   "progress statement " + std::to_string(stmt_no) + " (ok " +
                       std::to_string(executed) + ", failed " + std::to_string(failed) +
                       ", skipped " + std::to_string(skipped) + ")");
        }
        return true;
      },
      has_bom ? 3 : 0);

  if (!has_bom && prefix_size > 0 &&
      !splitter.Feed(std::string_view(prefix.data(), prefix_size))) {
    stopped = true;
  }

  std::array<char, kReadChunkSize> buffer{};
  while (!stopped && in) {
    if (Canceled(cancel)) {
      error = "canceled";
      stopped = true;
      break;
    }
    in.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
    const std::size_t count = static_cast<std::size_t>(in.gcount());
    total_bytes_read += count;
    if (count > 0 && !splitter.Feed(std::string_view(buffer.data(), count))) {
      stopped = true;
    }
  }

  if (!stopped && in.bad()) {
    error = "oracle: failed while reading sql file";
    stopped = true;
  }
  if (!stopped && !splitter.Finish()) {
    stopped = true;
    if (error.empty()) {
      error = "oracle: sql script parsing stopped";
    }
  }
  if (!stopped && Canceled(cancel)) {
    error = "canceled";
    stopped = true;
  }

  if (stopped) {
    RollbackAfterFailure(s, error);
    s.Close();
    return false;
  }

  if (statement_count == 0) {
    if (progress) {
      progress(static_cast<int64_t>(total_bytes_read), 0, "no statements");
    }
    s.Close();
    return true;
  }

  std::string summary = "executed " + std::to_string(executed) + " statement(s), " +
                        std::to_string(failed) + " failed";
  if (skipped > 0) {
    summary += ", " + std::to_string(skipped) + " skipped";
  }

  if (failed > 0) {
    error = "oracle: exec sql file completed with " + std::to_string(failed) + " error(s), " +
            std::to_string(executed) + " succeeded";
    RollbackAfterFailure(s, error);
    s.Close();
    return false;
  }

  if (dpiConn_commit(s.conn.get()) < 0) {
    error = util::FormatDpiError(s.ctx.get(), "oracle: commit sql file failed");
    RollbackAfterFailure(s, error);
    s.Close();
    return false;
  }

  if (progress) {
    progress(static_cast<int64_t>(total_bytes_read), executed, summary);
  }

  s.Close();
  return true;
}

}  // namespace niuma::oracle::dataio

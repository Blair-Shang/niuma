#include "session/sql_rows.hpp"

#include "util/stmt_guard.hpp"

#include <cstring>

namespace niuma::oracle::session {
namespace {

std::string DpiError(dpiContext* ctx) {
  dpiErrorInfo info{};
  if (ctx) {
    dpiContext_getError(ctx, &info);
  }
  if (info.message == nullptr) {
    return "oracle: query error";
  }
  return std::string("oracle: ") + info.message;
}

std::string CellAsString(dpiNativeTypeNum native, dpiData* data) {
  if (data == nullptr || data->isNull) {
    return {};
  }
  switch (native) {
    case DPI_NATIVE_TYPE_BYTES:
      return std::string(reinterpret_cast<const char*>(data->value.asBytes.ptr), data->value.asBytes.length);
    case DPI_NATIVE_TYPE_INT64:
      return std::to_string(data->value.asInt64);
    case DPI_NATIVE_TYPE_UINT64:
      return std::to_string(data->value.asUint64);
    case DPI_NATIVE_TYPE_DOUBLE:
      return std::to_string(data->value.asDouble);
    case DPI_NATIVE_TYPE_FLOAT:
      return std::to_string(data->value.asFloat);
    default:
      return {};
  }
}

}  // namespace

bool ExecStringRows(Session& session, const std::string& sql, int limit_plus_one, SqlRowsResult& out,
                    std::string& error) {
  out = {};
  if (!session.conn || !session.ctx) {
    error = "oracle: session has no connection";
    return false;
  }
  if (limit_plus_one <= 0) {
    limit_plus_one = 501;
  }

  auto* ctx = session.ctx.get();
  auto* conn = session.conn.get();
  util::StmtGuard stmt;
  dpiStmt* raw = nullptr;
  if (dpiConn_prepareStmt(conn, 0, sql.c_str(), static_cast<uint32_t>(sql.size()), nullptr, 0, &raw) < 0) {
    error = DpiError(ctx);
    return false;
  }
  stmt.Reset(raw);

  uint32_t num_cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &num_cols) < 0) {
    error = DpiError(ctx);
    return false;
  }
  if (num_cols == 0) {
    return true;
  }

  while (static_cast<int>(out.rows.size()) < limit_plus_one) {
    int found = 0;
    uint32_t buffer_row = 0;
    if (dpiStmt_fetch(stmt.Get(), &found, &buffer_row) < 0) {
      error = DpiError(ctx);
      return false;
    }
    if (!found) {
      break;
    }
    std::vector<std::string> row;
    row.reserve(num_cols);
    for (uint32_t c = 1; c <= num_cols; ++c) {
      dpiNativeTypeNum native = DPI_NATIVE_TYPE_BYTES;
      dpiData* data = nullptr;
      if (dpiStmt_getQueryValue(stmt.Get(), c, &native, &data) < 0) {
        error = DpiError(ctx);
        return false;
      }
      row.push_back(CellAsString(native, data));
    }
    out.rows.push_back(std::move(row));
  }

  if (static_cast<int>(out.rows.size()) >= limit_plus_one) {
    out.truncated = true;
    out.rows.pop_back();  // 多取的一行只用于截断标记
  }
  return true;
}

}  // namespace niuma::oracle::session

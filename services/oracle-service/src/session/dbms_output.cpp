#include "session/dbms_output.hpp"

#include "util/dpi_error.hpp"
#include "util/stmt_guard.hpp"
#include "util/utf8.hpp"

#include <cstdint>
#include <cstring>

namespace niuma::oracle::session {
namespace {

class VarGuard {
 public:
  explicit VarGuard(dpiVar* v = nullptr) : var_(v) {}
  ~VarGuard() { Reset(); }
  VarGuard(const VarGuard&) = delete;
  VarGuard& operator=(const VarGuard&) = delete;
  void Reset(dpiVar* v = nullptr) {
    if (var_) {
      dpiVar_release(var_);
    }
    var_ = v;
  }
  dpiVar* Get() const { return var_; }

 private:
  dpiVar* var_ = nullptr;
};

}  // namespace

nlohmann::json DrainDbmsOutput(Session& session, int max_lines) {
  nlohmann::json lines = nlohmann::json::array();
  if (!session.conn || !session.ctx || max_lines <= 0) {
    return lines;
  }
  if (max_lines > 500) {
    max_lines = 500;
  }

  auto* ctx = session.ctx.get();
  auto* conn = session.conn.get();

  dpiVar* lines_var = nullptr;
  dpiData* lines_data = nullptr;
  // VARCHAR 数组：承接 GET_LINES 的 :1
  if (dpiConn_newVar(conn, DPI_ORACLE_TYPE_VARCHAR, DPI_NATIVE_TYPE_BYTES,
                     static_cast<uint32_t>(max_lines), 32767, 0, 1, nullptr, &lines_var,
                     &lines_data) < 0) {
    return lines;
  }
  VarGuard lines_guard(lines_var);

  dpiVar* num_var = nullptr;
  dpiData* num_data = nullptr;
  if (dpiConn_newVar(conn, DPI_ORACLE_TYPE_NUMBER, DPI_NATIVE_TYPE_INT64, 1, 0, 0, 0, nullptr,
                     &num_var, &num_data) < 0) {
    return lines;
  }
  VarGuard num_guard(num_var);

  static const char* kSql = "BEGIN DBMS_OUTPUT.GET_LINES(:1, :2); END;";
  dpiStmt* raw = nullptr;
  if (dpiConn_prepareStmt(conn, 0, kSql, static_cast<uint32_t>(std::strlen(kSql)), nullptr, 0,
                          &raw) < 0) {
    return lines;
  }
  util::StmtGuard stmt(raw);
  if (dpiStmt_bindByPos(stmt.Get(), 1, lines_var) < 0 ||
      dpiStmt_bindByPos(stmt.Get(), 2, num_var) < 0) {
    return lines;
  }

  num_data->isNull = 0;
  num_data->value.asInt64 = max_lines;

  uint32_t num_cols = 0;
  if (dpiStmt_execute(stmt.Get(), DPI_MODE_EXEC_DEFAULT, &num_cols) < 0) {
    // 缓冲为空或未 ENABLE 时也可能失败；忽略，保持主语句成功
    (void)util::FormatDpiError(ctx, "oracle: DBMS_OUTPUT.GET_LINES");
    return lines;
  }

  const int64_t n = num_data->isNull ? 0 : num_data->value.asInt64;
  const int64_t count = n < 0 ? 0 : (n > max_lines ? max_lines : n);
  for (int64_t i = 0; i < count; ++i) {
    const dpiData& cell = lines_data[i];
    if (cell.isNull || cell.value.asBytes.ptr == nullptr || cell.value.asBytes.length == 0) {
      lines.push_back("");
      continue;
    }
    std::string raw_line(reinterpret_cast<const char*>(cell.value.asBytes.ptr),
                         cell.value.asBytes.length);
    lines.push_back(util::EnsureUtf8(raw_line));
  }
  return lines;
}

}  // namespace niuma::oracle::session

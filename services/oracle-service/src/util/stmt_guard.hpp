#pragma once

#include <dpi.h>

namespace niuma::oracle::util {

// ODPI dpiStmt* RAII：析构时 dpiStmt_release，避免异常/早退泄漏。
class StmtGuard {
 public:
  StmtGuard() = default;
  explicit StmtGuard(dpiStmt* stmt) : stmt_(stmt) {}
  ~StmtGuard() { Reset(); }

  StmtGuard(const StmtGuard&) = delete;
  StmtGuard& operator=(const StmtGuard&) = delete;

  StmtGuard(StmtGuard&& other) noexcept : stmt_(other.stmt_) { other.stmt_ = nullptr; }
  StmtGuard& operator=(StmtGuard&& other) noexcept {
    if (this != &other) {
      Reset();
      stmt_ = other.stmt_;
      other.stmt_ = nullptr;
    }
    return *this;
  }

  dpiStmt* Get() const { return stmt_; }
  dpiStmt* operator->() const { return stmt_; }
  explicit operator bool() const { return stmt_ != nullptr; }

  void Reset(dpiStmt* stmt = nullptr) {
    if (stmt_) {
      dpiStmt_release(stmt_);
    }
    stmt_ = stmt;
  }

  // 交出所有权（不再 release）。
  dpiStmt* Release() {
    dpiStmt* s = stmt_;
    stmt_ = nullptr;
    return s;
  }

 private:
  dpiStmt* stmt_ = nullptr;
};

}  // namespace niuma::oracle::util

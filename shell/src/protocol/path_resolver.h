#pragma once

#include <string>

namespace niuma {

/**
 * 将 app://niuma URL 路径解析为本地文件绝对路径。
 *
 * - `/` 或空 → `resources/web/index.html`
 * - `/plugins/...` → `{plugins}/...`（见 GetPluginsPath）
 * - 其它 → `resources/web` + 路径
 *
 * @param url_path - 不含 scheme 的 URL 路径，如 `/assets/app.js`
 * @returns 本地文件路径；无法映射时仍返回拼接结果（由调用方 stat）
 */
std::string ResolveAppResourcePath(const std::string& url_path);

}  // namespace niuma

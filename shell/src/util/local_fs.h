#pragma once

#include <cstddef>
#include <string>

namespace niuma {

/** 本地文件系统只读/写入/元数据；不含业务解析。 */
class LocalFs {
 public:
  static constexpr std::size_t kMaxTextPrefixBytes = 1024 * 1024;

  static bool Exists(const std::string& path);
  static std::string StatJson(const std::string& path, std::string& error);
  static std::string ReadText(const std::string& path, std::string& error);
  static std::string ReadTextPrefix(const std::string& path,
                                    std::size_t max_bytes,
                                    std::string& error);
  static bool WriteText(const std::string& path, const std::string& content,
                        std::string& error);
  static bool ShowInFolder(const std::string& path, std::string& error);
  static std::string HomeDirJson(std::string& error);
  static std::string ListDirJson(const std::string& path, std::string& error);
  static bool Mkdir(const std::string& path, std::string& error);
  static bool Rename(const std::string& from_path, const std::string& to_path,
                     std::string& error);
  static bool Delete(const std::string& path, std::string& error);
  /** 使用系统默认浏览器打开 http(s) URL。 */
  static bool OpenExternalUrl(const std::string& url, std::string& error);
  /**
   * 拉起本机安装包（仅允许 %TEMP%/niuma-update/ 下的安装程序）。
   * Windows：ShellExecuteW open；不传静默参数，由用户确认 UAC/向导。
   */
  static bool LaunchInstaller(const std::string& path, std::string& error);

 private:
  static bool IsAccessiblePath(const std::string& path, std::string& error);
};

}  // namespace niuma

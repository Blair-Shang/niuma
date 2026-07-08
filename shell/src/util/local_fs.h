#pragma once

#include <string>

namespace niuma {

/** 本地文件系统只读/写入/元数据；不含业务解析。 */
class LocalFs {
 public:
  static bool Exists(const std::string& path);
  static std::string StatJson(const std::string& path, std::string& error);
  static std::string ReadText(const std::string& path, std::string& error);
  static bool WriteText(const std::string& path, const std::string& content,
                        std::string& error);
  static bool ShowInFolder(const std::string& path, std::string& error);
  static std::string HomeDirJson(std::string& error);
  static std::string ListDirJson(const std::string& path, std::string& error);
  static bool Mkdir(const std::string& path, std::string& error);
  static bool Rename(const std::string& from_path, const std::string& to_path,
                     std::string& error);
  static bool Delete(const std::string& path, std::string& error);

 private:
  static bool IsAccessiblePath(const std::string& path, std::string& error);
};

}  // namespace niuma

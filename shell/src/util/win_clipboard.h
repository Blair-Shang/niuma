#pragma once

#include <string>

namespace niuma {

/** 读取系统剪贴板 UTF-8 纯文本。 */
bool ReadClipboardText(std::string& text, std::string& error);

/** 写入系统剪贴板 UTF-8 纯文本。 */
bool WriteClipboardText(const std::string& text, std::string& error);

}  // namespace niuma

#pragma once

#if defined(_WIN32)
#include <windows.h>
#endif

namespace niuma {

/**
 * 将嵌入 exe 的应用图标设置到 Win32 窗口（标题栏 + 任务栏分组）。
 *
 * @param hwnd - 目标窗口句柄；无效时无操作
 */
void ApplyAppIconToWindow(void* hwnd);

#if defined(_WIN32)
/**
 * 加载嵌入资源中的应用图标。
 *
 * @param large - true 返回大图标（32px 级），false 返回小图标（16px 级）
 * @returns HICON；失败时返回 nullptr
 */
HICON LoadAppIcon(bool large);
#endif

}  // namespace niuma

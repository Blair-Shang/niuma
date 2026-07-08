#include "util/win_app_icon.h"

#if defined(_WIN32)
#include "resource.h"
#endif

namespace niuma {

#if defined(_WIN32)

namespace {

HINSTANCE AppInstance() {
  return GetModuleHandleW(nullptr);
}

HICON LoadAppIconSized(int cx, int cy) {
  return static_cast<HICON>(LoadImageW(
      AppInstance(), MAKEINTRESOURCEW(IDI_NIUMA_APP), IMAGE_ICON, cx, cy,
      LR_DEFAULTCOLOR));
}

void ReplaceWindowIcon(HWND window, UINT slot, HICON icon) {
  if (!icon) {
    return;
  }
  const HICON previous = reinterpret_cast<HICON>(
      SendMessageW(window, WM_SETICON, slot, reinterpret_cast<LPARAM>(icon)));
  if (previous && previous != icon) {
    DestroyIcon(previous);
  }
}

}  // namespace

HICON LoadAppIcon(const bool large) {
  if (large) {
    if (HICON icon = LoadAppIconSized(256, 256)) {
      return icon;
    }
    return LoadAppIconSized(GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON));
  }
  return LoadAppIconSized(GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON));
}

void ApplyAppIconToWindow(void* hwnd) {
  if (!hwnd) {
    return;
  }
  const HWND window = static_cast<HWND>(hwnd);
  if (!IsWindow(window)) {
    return;
  }

  HICON big = LoadAppIcon(true);
  HICON small = LoadAppIcon(false);

  ReplaceWindowIcon(window, ICON_BIG, big);
  ReplaceWindowIcon(window, ICON_SMALL, small);

  if (big) {
    SetClassLongPtrW(window, GCLP_HICON, reinterpret_cast<LONG_PTR>(big));
  }
  if (small) {
    SetClassLongPtrW(window, GCLP_HICONSM, reinterpret_cast<LONG_PTR>(small));
  }
}

#else

void ApplyAppIconToWindow(void* /*hwnd*/) {}

#endif

}  // namespace niuma

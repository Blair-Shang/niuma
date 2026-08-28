#include <cstring>

#include "util/win_clipboard.h"

#if defined(OS_WIN)

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

namespace niuma {
namespace {

std::wstring Utf8ToWide(const std::string& value) {
  if (value.empty()) {
    return {};
  }
  const int size = MultiByteToWideChar(CP_UTF8, 0, value.c_str(),
                                       static_cast<int>(value.size()), nullptr, 0);
  if (size <= 0) {
    return {};
  }
  std::wstring out(static_cast<size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()),
                      out.empty() ? nullptr : &out[0], size);
  return out;
}

std::string WideToUtf8(const std::wstring& value) {
  if (value.empty()) {
    return {};
  }
  const int size =
      WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, nullptr, 0, nullptr, nullptr);
  if (size <= 1) {
    return {};
  }
  std::string out(static_cast<size_t>(size - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, out.data(), size, nullptr, nullptr);
  return out;
}

}  // namespace

bool ReadClipboardText(std::string& text, std::string& error) {
  text.clear();
  error.clear();
  if (!OpenClipboard(nullptr)) {
    error = "OpenClipboard failed";
    return false;
  }

  HANDLE data = GetClipboardData(CF_UNICODETEXT);
  if (!data) {
    CloseClipboard();
    error = "clipboard has no text";
    return false;
  }

  const auto* wide = static_cast<const wchar_t*>(GlobalLock(data));
  if (!wide) {
    CloseClipboard();
    error = "GlobalLock failed";
    return false;
  }

  text = WideToUtf8(wide);
  GlobalUnlock(data);
  CloseClipboard();
  return true;
}

bool WriteClipboardText(const std::string& text, std::string& error) {
  error.clear();
  const std::wstring wide = Utf8ToWide(text);
  if (!OpenClipboard(nullptr)) {
    error = "OpenClipboard failed";
    return false;
  }

  if (!EmptyClipboard()) {
    CloseClipboard();
    error = "EmptyClipboard failed";
    return false;
  }

  const size_t bytes = (wide.size() + 1) * sizeof(wchar_t);
  HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes);
  if (!memory) {
    CloseClipboard();
    error = "GlobalAlloc failed";
    return false;
  }

  void* locked = GlobalLock(memory);
  if (!locked) {
    GlobalFree(memory);
    CloseClipboard();
    error = "GlobalLock failed";
    return false;
  }

  memcpy(locked, wide.c_str(), bytes);
  GlobalUnlock(memory);

  if (!SetClipboardData(CF_UNICODETEXT, memory)) {
    GlobalFree(memory);
    CloseClipboard();
    error = "SetClipboardData failed";
    return false;
  }

  CloseClipboard();
  return true;
}

}  // namespace niuma

#elif defined(__linux__)

#include <gtk/gtk.h>

namespace niuma {
namespace {

GtkClipboard* ClipboardOrError(std::string& error) {
  int argc = 0;
  char** argv = nullptr;
  if (!gtk_init_check(&argc, &argv)) {
    error = "gtk init failed";
    return nullptr;
  }
  return gtk_clipboard_get(GDK_SELECTION_CLIPBOARD);
}

}  // namespace

bool ReadClipboardText(std::string& text, std::string& error) {
  text.clear();
  error.clear();
  GtkClipboard* clipboard = ClipboardOrError(error);
  if (!clipboard) {
    return false;
  }
  gchar* data = gtk_clipboard_wait_for_text(clipboard);
  if (!data) {
    error = "clipboard has no text";
    return false;
  }
  text = data;
  g_free(data);
  return true;
}

bool WriteClipboardText(const std::string& text, std::string& error) {
  error.clear();
  GtkClipboard* clipboard = ClipboardOrError(error);
  if (!clipboard) {
    return false;
  }
  gtk_clipboard_set_text(clipboard, text.c_str(), static_cast<gint>(text.size()));
  gtk_clipboard_store(clipboard);
  return true;
}

}  // namespace niuma

#endif


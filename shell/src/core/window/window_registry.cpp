#include "core/window/window_registry.h"

#include "include/wrapper/cef_helpers.h"

#include <algorithm>

namespace niuma {

#if NIUMMA_WITH_CEF

WindowRegistry& WindowRegistry::Instance() {
  static WindowRegistry instance;
  return instance;
}

int WindowRegistry::AllocateId() {
  return ++next_id_;
}

void WindowRegistry::EnqueuePending(PendingWindow pending) {
  pending_.push_back(std::move(pending));
}

bool WindowRegistry::AttachBrowser(CefRefPtr<CefBrowser> browser, WindowRecord* attached) {
  CEF_REQUIRE_UI_THREAD();
  if (!browser || pending_.empty()) {
    return false;
  }

  PendingWindow pending = pending_.front();
  pending_.erase(pending_.begin());

  WindowRecord entry;
  entry.id = pending.id;
  entry.kind = pending.kind;
  entry.title = pending.title;
  entry.url = pending.url.empty() ? browser->GetMainFrame()->GetURL().ToString()
                                  : pending.url;
  entry.chrome = pending.chrome;
  entry.browser = browser;
  windows_.push_back(entry);
  focused_window_id_ = entry.id;

  if (attached) {
    *attached = entry;
  }
  return true;
}

bool WindowRegistry::RemoveByBrowser(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();
  if (!browser) {
    return false;
  }
  for (auto it = windows_.begin(); it != windows_.end(); ++it) {
    if (it->browser && it->browser->IsSame(browser)) {
      if (focused_window_id_ == it->id) {
        focused_window_id_ = 0;
      }
      windows_.erase(it);
      return true;
    }
  }
  return false;
}

void WindowRegistry::UpdateTitle(CefRefPtr<CefBrowser> browser, const std::string& title) {
  CEF_REQUIRE_UI_THREAD();
  for (auto& entry : windows_) {
    if (entry.browser && entry.browser->IsSame(browser)) {
      entry.title = title;
      return;
    }
  }
}

const WindowRecord* WindowRegistry::FindExact(int window_id) const {
  if (window_id <= 0) {
    return nullptr;
  }
  for (const auto& entry : windows_) {
    if (entry.id == window_id) {
      return &entry;
    }
  }
  return nullptr;
}

const WindowRecord* WindowRegistry::ResolveEntry(int window_id) const {
  int id = window_id > 0 ? window_id : focused_window_id_;
  if (id <= 0 && !windows_.empty()) {
    id = windows_.front().id;
  }
  for (const auto& entry : windows_) {
    if (entry.id == id) {
      return &entry;
    }
  }
  return nullptr;
}

WindowRecord* WindowRegistry::ResolveEntry(int window_id) {
  int id = window_id > 0 ? window_id : focused_window_id_;
  if (id <= 0 && !windows_.empty()) {
    id = windows_.front().id;
  }
  for (auto& entry : windows_) {
    if (entry.id == id) {
      return &entry;
    }
  }
  return nullptr;
}

const WindowRecord* WindowRegistry::Find(int window_id) const {
  return ResolveEntry(window_id);
}

WindowRecord* WindowRegistry::FindMutable(int window_id) {
  return ResolveEntry(window_id);
}

const WindowRecord* WindowRegistry::FindByBrowser(CefRefPtr<CefBrowser> browser) const {
  if (!browser) {
    return nullptr;
  }
  for (const auto& entry : windows_) {
    if (entry.browser && entry.browser->IsSame(browser)) {
      return &entry;
    }
  }
  return nullptr;
}

int WindowRegistry::WindowIdForBrowser(CefRefPtr<CefBrowser> browser) const {
  const WindowRecord* entry = FindByBrowser(browser);
  return entry ? entry->id : 0;
}

int WindowRegistry::ResolveWindowId(int param_window_id, int caller_window_id) const {
  if (param_window_id > 0) {
    return param_window_id;
  }
  if (caller_window_id > 0) {
    return caller_window_id;
  }
  if (focused_window_id_ > 0) {
    return focused_window_id_;
  }
  if (!windows_.empty()) {
    return windows_.front().id;
  }
  return 0;
}

void WindowRegistry::SetFocused(int window_id) {
  focused_window_id_ = window_id;
}

bool WindowRegistry::HasManagedWindow() const {
  for (const auto& entry : windows_) {
    if (entry.kind != WindowKind::Popup) {
      return true;
    }
  }
  return false;
}

void WindowRegistry::RemovePendingByKind(WindowKind kind) {
  CEF_REQUIRE_UI_THREAD();
  pending_.erase(std::remove_if(pending_.begin(), pending_.end(),
                                [kind](const PendingWindow& pending) {
                                  return pending.kind == kind;
                                }),
                 pending_.end());
}

std::string WindowRegistry::JsonEscape(const std::string& value) {
  std::string out;
  out.reserve(value.size() + 8);
  for (char c : value) {
    switch (c) {
      case '"':
        out += "\\\"";
        break;
      case '\\':
        out += "\\\\";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      case '\t':
        out += "\\t";
        break;
      default:
        out.push_back(c);
        break;
    }
  }
  return out;
}

#endif

}  // namespace niuma

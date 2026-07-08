#include "core/window/auxiliary_window.h"

#include "core/window/window_factory.h"
#include "core/window/window_registry.h"

#include "include/cef_browser.h"
#include "include/wrapper/cef_helpers.h"

#include <vector>

namespace niuma {

#if NIUMMA_WITH_CEF

AuxiliaryWindowManager& AuxiliaryWindowManager::Instance() {
  static AuxiliaryWindowManager instance;
  return instance;
}

std::string AuxiliaryWindowManager::BuildReuseKey(const WindowCreateOptions& opts) const {
  if (!opts.route.empty()) {
    return "route:" + opts.route;
  }
  if (!opts.url.empty()) {
    return "url:" + opts.url;
  }
  return {};
}

int AuxiliaryWindowManager::FindReusableWindow(const WindowCreateOptions& opts) {
  const std::string reuse_key = BuildReuseKey(opts);
  if (reuse_key.empty()) {
    return 0;
  }

  auto it = reuse_key_to_window_id_.find(reuse_key);
  if (it == reuse_key_to_window_id_.end()) {
    return 0;
  }

  const WindowRecord* entry = WindowRegistry::Instance().FindExact(it->second);
  if (!entry || entry->kind != WindowKind::Auxiliary) {
    window_id_to_reuse_key_.erase(it->second);
    reuse_key_to_window_id_.erase(it);
    return 0;
  }
  return entry->id;
}

int AuxiliaryWindowManager::Open(const WindowCreateOptions& opts) {
  CEF_REQUIRE_UI_THREAD();
  if (const int existing_id = FindReusableWindow(opts); existing_id > 0) {
    return existing_id;
  }

  const int window_id = WindowFactory::Instance().Create(WindowKind::Auxiliary, opts);
  const std::string reuse_key = BuildReuseKey(opts);
  if (!reuse_key.empty()) {
    reuse_key_to_window_id_[reuse_key] = window_id;
    window_id_to_reuse_key_[window_id] = reuse_key;
  }
  return window_id;
}

bool AuxiliaryWindowManager::IsAuxiliary(int window_id) const {
  const WindowRecord* entry = WindowRegistry::Instance().FindExact(window_id);
  return entry && entry->kind == WindowKind::Auxiliary;
}

void AuxiliaryWindowManager::CloseAll() {
  CEF_REQUIRE_UI_THREAD();
  WindowRegistry::Instance().RemovePendingByKind(WindowKind::Auxiliary);

  std::vector<CefRefPtr<CefBrowser>> browsers;
  for (const auto& entry : WindowRegistry::Instance().All()) {
    if (entry.kind == WindowKind::Auxiliary && entry.browser) {
      browsers.push_back(entry.browser);
    }
  }

  reuse_key_to_window_id_.clear();
  window_id_to_reuse_key_.clear();

  for (const auto& browser : browsers) {
    browser->GetHost()->CloseBrowser(false);
  }
}

void AuxiliaryWindowManager::OnAttached(int window_id) {
  (void)window_id;
}

void AuxiliaryWindowManager::OnDetached(int window_id) {
  auto key_it = window_id_to_reuse_key_.find(window_id);
  if (key_it == window_id_to_reuse_key_.end()) {
    return;
  }

  auto reuse_it = reuse_key_to_window_id_.find(key_it->second);
  if (reuse_it != reuse_key_to_window_id_.end() && reuse_it->second == window_id) {
    reuse_key_to_window_id_.erase(reuse_it);
  }
  window_id_to_reuse_key_.erase(key_it);
}

#endif

}  // namespace niuma

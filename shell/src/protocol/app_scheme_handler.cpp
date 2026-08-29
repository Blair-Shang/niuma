#include "protocol/app_scheme_handler.h"
#include "protocol/path_resolver.h"

#include <algorithm>
#include <cctype>
#include <filesystem>

#if NIUMMA_WITH_CEF
#include "include/wrapper/cef_stream_resource_handler.h"
#include "include/cef_response.h"
#include "include/cef_stream.h"
#endif

namespace fs = std::filesystem;

namespace niuma {

namespace {

std::string ToLower(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return value;
}

}  // namespace

std::string MimeTypeForPath(const std::string& path) {
  const auto dot = path.find_last_of('.');
  if (dot == std::string::npos) {
    return "application/octet-stream";
  }
  const std::string ext = ToLower(path.substr(dot));
  if (ext == ".html" || ext == ".htm") return "text/html";
  if (ext == ".js" || ext == ".mjs") return "text/javascript";
  if (ext == ".css") return "text/css";
  if (ext == ".json") return "application/json";
  if (ext == ".svg") return "image/svg+xml";
  if (ext == ".png") return "image/png";
  if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
  if (ext == ".woff2") return "font/woff2";
  if (ext == ".woff") return "font/woff";
  if (ext == ".map") return "application/json";
  return "application/octet-stream";
}

void RegisterAppScheme() {
#if NIUMMA_WITH_CEF
  CefRegisterSchemeHandlerFactory(NIUMMA_APP_SCHEME, NIUMMA_APP_HOST,
                                new NiuMaAppSchemeHandlerFactory());
#endif
}

}  // namespace niuma

#if NIUMMA_WITH_CEF

namespace {

std::string ParseAppUrlPath(const std::string& url) {
  const std::string prefix =
      std::string(NIUMMA_APP_SCHEME) + "://" + NIUMMA_APP_HOST;
  if (url.rfind(prefix, 0) != 0) {
    return {};
  }
  std::string path = url.substr(prefix.size());
  const auto query = path.find('?');
  if (query != std::string::npos) {
    path = path.substr(0, query);
  }
  const auto hash = path.find('#');
  if (hash != std::string::npos) {
    path = path.substr(0, hash);
  }
  if (path.empty()) {
    return "/";
  }
  if (path[0] != '/') {
    path.insert(path.begin(), '/');
  }
  return path;
}

}  // namespace

CefRefPtr<CefResourceHandler> NiuMaAppSchemeHandlerFactory::Create(
    CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefFrame> frame,
    const CefString& scheme_name,
    CefRefPtr<CefRequest> request) {
  (void)browser;
  (void)frame;
  (void)scheme_name;

  const std::string url_path = ParseAppUrlPath(request->GetURL().ToString());
  if (url_path.empty()) {
    return nullptr;
  }

  const std::string file_path = niuma::ResolveAppResourcePath(url_path);
  if (!fs::exists(file_path) || !fs::is_regular_file(file_path)) {
    return nullptr;
  }

  CefRefPtr<CefStreamReader> stream = CefStreamReader::CreateForFile(file_path);
  if (!stream) {
    return nullptr;
  }

  // 本地文件没有网络收益。index.html 若被 HTTP 缓存，升级后仍会引用旧的
  // index-xxxx.js，用户看到的还是上一版界面。
  CefResponse::HeaderMap headers;
  headers.insert(std::make_pair("Cache-Control", "no-store"));
  headers.insert(std::make_pair("Pragma", "no-cache"));

  return new CefStreamResourceHandler(
      200, "OK", niuma::MimeTypeForPath(file_path), headers, stream);
}

#endif

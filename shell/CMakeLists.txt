cmake_minimum_required(VERSION 3.21)
# CEF 的 cef_variables.cmake 会 CHECK_C_COMPILER_FLAG。CMake 3.31+
# 要求 C 语言已启用，否则 Linux/macOS configure 失败：
#   check_compiler_flag: C: needs to be enabled before use.
project(NiuMaShell VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# CEF 官方 Windows 发行包使用静态 CRT（Release /MT、Debug /MTd）。
# 必须在 add_executable / add_subdirectory(logutil) 之前设置，否则 logutil 默认 /MD，
# 会与 libcpmt 多重定义（LNK2005 msvcprt vs libcpmt，LNK1169）。
if(MSVC)
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

add_compile_definitions(
  NIUMMA_RESOURCES_DIR="resources"
  NIUMMA_APP_SCHEME="app"
  NIUMMA_APP_HOST="niuma"
)

if(NOT DEFINED NIUMMA_APP_VERSION)
  set(NIUMMA_APP_VERSION "1.0.0")
endif()
if(NOT DEFINED NIUMMA_BUILD_ID)
  set(NIUMMA_BUILD_ID "dev")
endif()

add_compile_definitions(
  NIUMMA_APP_VERSION="${NIUMMA_APP_VERSION}"
  NIUMMA_BUILD_ID="${NIUMMA_BUILD_ID}"
)

if(NOT CEF_ROOT)
  set(CEF_ROOT "$ENV{CEF_ROOT}" CACHE PATH "CEF binary distribution root")
endif()

set(SHELL_SOURCES
  src/main.cpp
  src/util/bridge_method.cpp
  src/core/app_config.cpp
  src/core/cef/niuma_app.cpp
  src/core/cef/niuma_render_process_handler.cpp
  src/core/cef/cef_settings.cpp
  src/core/window/window_registry.cpp
  src/core/window/window_factory.cpp
  src/core/window/main_window.cpp
  src/core/window/splash_window.cpp
  src/core/window/auxiliary_window.cpp
  src/core/window/window_manager.cpp
  src/core/window/native_dialog.cpp
  src/core/runtime/service_manager.cpp
  src/core/runtime/service_manifest.cpp
  src/browser/main_browser.cpp
  src/browser/handlers/message_router_handler.cpp
  src/browser/handlers/drag_handler.cpp
  src/browser/handlers/permission_handler.cpp
  src/bridge/bridge_router.cpp
  src/bridge/stream_proxy.cpp
  src/ipc/platform_client.cpp
  src/protocol/app_scheme_handler.cpp
  src/protocol/path_resolver.cpp
  src/util/runtime_paths.cpp
  src/util/session_log.cpp
  src/util/json_util.cpp
  src/util/local_fs.cpp
  src/util/win_clipboard.cpp
  src/util/plugin_scanner.cpp
  src/util/plugin_registry.cpp
  src/util/win_app_icon.cpp
)

if(WIN32)
  enable_language(RC)
  add_executable(niuma WIN32 ${SHELL_SOURCES})
else()
  add_executable(niuma ${SHELL_SOURCES})
endif()

if(WIN32)
  target_sources(niuma PRIVATE resources/niuma.rc)
  target_compile_definitions(niuma PRIVATE OS_WIN=1)
endif()

if(APPLE)
  enable_language(OBJCXX)
  target_sources(niuma PRIVATE src/util/clipboard_mac.mm)
endif()

if(UNIX AND NOT APPLE)
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(GTK3 REQUIRED IMPORTED_TARGET gtk+-3.0)
  target_link_libraries(niuma PRIVATE PkgConfig::GTK3)
endif()

target_include_directories(niuma PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/src
  ${CMAKE_CURRENT_SOURCE_DIR}/resources
)

set(NIUMA_CPP_LOGUTIL "${CMAKE_CURRENT_SOURCE_DIR}/../packages/cpp/logutil")
if(EXISTS "${NIUMA_CPP_LOGUTIL}/CMakeLists.txt")
  add_subdirectory("${NIUMA_CPP_LOGUTIL}" "${CMAKE_BINARY_DIR}/niuma_logutil")
  target_link_libraries(niuma PRIVATE niuma::logutil)
endif()

set(NIUMMA_WITH_CEF 0)

if(CEF_ROOT AND EXISTS "${CEF_ROOT}/CMakeLists.txt")
  file(TO_CMAKE_PATH "${CEF_ROOT}" CEF_ROOT_NORM)
  set(USE_SANDBOX OFF CACHE BOOL "Disable CEF sandbox (no ATL)" FORCE)
  list(APPEND CMAKE_MODULE_PATH "${CEF_ROOT_NORM}/cmake")
  find_package(CEF REQUIRED)

  add_subdirectory("${CEF_ROOT_NORM}" cef_build EXCLUDE_FROM_ALL)

  add_dependencies(niuma libcef_dll_wrapper)
  # macOS 发行包没有 libcef.so / libcef.lib，运行时加载
  # Chromium Embedded Framework.framework。ADD_LOGICAL_TARGET 在空路径上
  # 会在 Generate 阶段报 IMPORTED_LOCATION not set for libcef_lib。
  if(APPLE)
    target_link_libraries(niuma PRIVATE libcef_dll_wrapper ${CEF_STANDARD_LIBS})
  else()
    ADD_LOGICAL_TARGET("libcef_lib" "${CEF_LIB_DEBUG}" "${CEF_LIB_RELEASE}")
    target_link_libraries(niuma PRIVATE libcef_lib libcef_dll_wrapper ${CEF_STANDARD_LIBS})
  endif()
  target_include_directories(niuma PRIVATE "${CEF_ROOT_NORM}")
  target_compile_definitions(niuma PRIVATE NIUMMA_WITH_CEF=1)
  set(NIUMMA_WITH_CEF 1)

  SET_CEF_TARGET_OUT_DIR()
  SET_EXECUTABLE_TARGET_PROPERTIES(niuma)
  # logutil 在 CEF 之前已 add_subdirectory；显式对齐 CRT，避免增量缓存仍是 /MD。
  if(MSVC AND TARGET niuma_logutil)
    set_property(TARGET niuma_logutil PROPERTY
      MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
  endif()
  if(APPLE)
    # macOS 发行包没有顶层 Resources/；pak / icudtl 在 framework 内。
    add_custom_command(TARGET niuma POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E copy_directory
        "${CEF_ROOT_NORM}/Release/Chromium Embedded Framework.framework"
        "$<TARGET_FILE_DIR:niuma>/Chromium Embedded Framework.framework"
      COMMENT "Copy CEF framework")
  else()
    # 不用 CEF COPY_FILES：其目标目录 CEF_TARGET_OUT_DIR 在 Unix Makefiles 下是
    # ${BUILD}/Release，而 niuma 在 ${BUILD}/niuma；宏里拼接路径还容易吃掉 genex。
    add_custom_command(TARGET niuma POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E copy_directory
        "${CEF_BINARY_DIR}"
        "$<TARGET_FILE_DIR:niuma>"
      COMMAND ${CMAKE_COMMAND} -E copy_directory
        "${CEF_RESOURCE_DIR}"
        "$<TARGET_FILE_DIR:niuma>"
      COMMENT "Copy CEF binaries and resources next to niuma")
  endif()

  message(STATUS "CEF enabled: ${CEF_ROOT}")
else()
  message(WARNING "CEF_ROOT not set — building stub without CEF (run pnpm setup:desktop)")
  target_compile_definitions(niuma PRIVATE NIUMMA_WITH_CEF=0)
endif()

# web/dist → resources/web（与 exe 同目录）
set(WEB_DIST "${CMAKE_SOURCE_DIR}/../web/dist")
if(EXISTS "${WEB_DIST}/index.html")
  add_custom_command(TARGET niuma POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "$<TARGET_FILE_DIR:niuma>/resources/web"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
      "${WEB_DIST}" "$<TARGET_FILE_DIR:niuma>/resources/web"
    COMMENT "Copy web/dist → resources/web")
endif()

set(PLUGINS_SRC "${CMAKE_SOURCE_DIR}/../plugins")
if(EXISTS "${PLUGINS_SRC}")
  add_custom_command(TARGET niuma POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "$<TARGET_FILE_DIR:niuma>/resources/plugins"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
      "${PLUGINS_SRC}" "$<TARGET_FILE_DIR:niuma>/resources/plugins"
    COMMENT "Copy plugins/ → resources/plugins")
endif()

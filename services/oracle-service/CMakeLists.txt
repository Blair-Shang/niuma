cmake_minimum_required(VERSION 3.21)
project(niuma-oracle-service VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 11)

option(NIUMA_ORACLE_BUILD_TESTS "Build oracle-service unit tests" ON)

# 公共 IPC（对标 packages/go/serviceipc）
set(NIUMA_SERVICEIPC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../packages/cpp/serviceipc")
if(NOT EXISTS "${NIUMA_SERVICEIPC_DIR}/CMakeLists.txt")
  message(FATAL_ERROR "packages/cpp/serviceipc not found at ${NIUMA_SERVICEIPC_DIR}")
endif()
# 默认随本工程跑公共库单测；需要关闭时设 NIUMA_SERVICEIPC_BUILD_TESTS=OFF
if(NOT DEFINED NIUMA_SERVICEIPC_BUILD_TESTS)
  set(NIUMA_SERVICEIPC_BUILD_TESTS ON CACHE BOOL "" FORCE)
endif()
add_subdirectory("${NIUMA_SERVICEIPC_DIR}" "${CMAKE_BINARY_DIR}/niuma_serviceipc")

# 公共代理（对标 packages/go/netproxy、packages/rust/niuma-netproxy）
set(NIUMA_NETPROXY_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../packages/cpp/netproxy")
if(NOT EXISTS "${NIUMA_NETPROXY_DIR}/CMakeLists.txt")
  message(FATAL_ERROR "packages/cpp/netproxy not found at ${NIUMA_NETPROXY_DIR}")
endif()
if(NOT DEFINED NIUMA_NETPROXY_BUILD_TESTS)
  set(NIUMA_NETPROXY_BUILD_TESTS OFF CACHE BOOL "" FORCE)
endif()
add_subdirectory("${NIUMA_NETPROXY_DIR}" "${CMAKE_BINARY_DIR}/niuma_netproxy")

# 公共 SSH 隧道（对标 packages/go/tunnel、packages/rust/niuma-tunnel）
set(NIUMA_SSHTUNNEL_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../packages/cpp/sshtunnel")
if(NOT EXISTS "${NIUMA_SSHTUNNEL_DIR}/CMakeLists.txt")
  message(FATAL_ERROR "packages/cpp/sshtunnel not found at ${NIUMA_SSHTUNNEL_DIR}")
endif()
if(NOT DEFINED NIUMA_SSHTUNNEL_BUILD_TESTS)
  set(NIUMA_SSHTUNNEL_BUILD_TESTS OFF CACHE BOOL "" FORCE)
endif()
add_subdirectory("${NIUMA_SSHTUNNEL_DIR}" "${CMAKE_BINARY_DIR}/niuma_sshtunnel")

# 公共落盘日志（对标 packages/go/logutil）
set(NIUMA_LOGUTIL_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../packages/cpp/logutil")
if(NOT EXISTS "${NIUMA_LOGUTIL_DIR}/CMakeLists.txt")
  message(FATAL_ERROR "packages/cpp/logutil not found at ${NIUMA_LOGUTIL_DIR}")
endif()
if(NOT DEFINED NIUMA_LOGUTIL_BUILD_TESTS)
  set(NIUMA_LOGUTIL_BUILD_TESTS OFF CACHE BOOL "" FORCE)
endif()
add_subdirectory("${NIUMA_LOGUTIL_DIR}" "${CMAKE_BINARY_DIR}/niuma_logutil")

# SQL LSP 核心（对齐 packages/go/sqllsp）
set(NIUMA_SQLLSP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../packages/cpp/sqllsp")
if(NOT EXISTS "${NIUMA_SQLLSP_DIR}/CMakeLists.txt")
  message(FATAL_ERROR "packages/cpp/sqllsp not found at ${NIUMA_SQLLSP_DIR}")
endif()
set(NIUMA_SQLLSP_NLOHMANN_INCLUDE "${CMAKE_CURRENT_SOURCE_DIR}/third_party" CACHE PATH "" FORCE)
set(NIUMA_SQLLSP_BUILD_TESTS ON CACHE BOOL "" FORCE)
add_subdirectory("${NIUMA_SQLLSP_DIR}" "${CMAKE_BINARY_DIR}/niuma_sqllsp")

set(ODPI_SRC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/odpi/src")
set(ODPI_INC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/odpi/include")
if(NOT EXISTS "${ODPI_INC_DIR}/dpi.h")
  message(FATAL_ERROR "ODPI-C missing. Run: git clone --depth 1 --branch v5.4.1 https://github.com/oracle/odpi.git third_party/odpi")
endif()
if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/third_party/nlohmann/json.hpp")
  message(FATAL_ERROR "nlohmann/json.hpp missing under third_party/nlohmann/")
endif()

file(GLOB ODPI_SOURCES CONFIGURE_DEPENDS "${ODPI_SRC_DIR}/dpi*.c")

set(ORACLE_SERVICE_SOURCES
  src/main.cpp
  src/dialect/profile.cpp
  src/session/connect.cpp
  src/session/manager.cpp
  src/session/query.cpp
  src/session/dbms_output.cpp
  src/session/routine_call.cpp
  src/session/sql_rows.cpp
  src/session/resolve.cpp
  src/session/tx.cpp
  src/session/explain.cpp
  src/session/load_lob.cpp
  src/handler/dispatcher.cpp
  src/tree/list.cpp
  src/catalog/list.cpp
  src/meta/system_users.cpp
  src/meta/relation.cpp
  src/meta/metadata_ddl.cpp
  src/meta/column_type.cpp
  src/meta/routines.cpp
  src/meta/monitor.cpp
  src/ddl/design.cpp
  src/dataio/manager.cpp
  src/dataio/atomic_output.cpp
  src/dataio/csv.cpp
  src/dataio/csv_codec.cpp
  src/dataio/dump.cpp
  src/dataio/execfile.cpp
  src/dataio/script_split.cpp
  src/lsp/bridge.cpp
  src/lsp/oracle_catalog.cpp
  src/lsp/oracle_parser.cpp
  src/util/paths.cpp
  src/util/idgen.cpp
  src/util/ident.cpp
  src/util/sql_literal.cpp
  src/util/lob.cpp
  src/util/utf8.cpp
  src/util/connection_error.cpp
  src/util/dpi_error.cpp
  ${ODPI_SOURCES}
)

add_executable(niuma-oracle-service ${ORACLE_SERVICE_SOURCES})

target_include_directories(niuma-oracle-service PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/src
  ${CMAKE_CURRENT_SOURCE_DIR}/third_party
  ${ODPI_INC_DIR}
  ${ODPI_SRC_DIR}
)

target_link_libraries(niuma-oracle-service PRIVATE niuma::serviceipc niuma::netproxy niuma::sshtunnel niuma::logutil niuma::sqllsp)

if(WIN32)
  target_compile_definitions(niuma-oracle-service PRIVATE NIUMA_OS_WIN=1 _CRT_SECURE_NO_WARNINGS)
  target_compile_options(niuma-oracle-service PRIVATE /utf-8)
else()
  target_compile_definitions(niuma-oracle-service PRIVATE NIUMA_OS_UNIX=1)
endif()

if(DEFINED ENV{NIUMA_SERVICES_BIN})
  set_target_properties(niuma-oracle-service PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "$ENV{NIUMA_SERVICES_BIN}"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG "$ENV{NIUMA_SERVICES_BIN}"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "$ENV{NIUMA_SERVICES_BIN}"
  )
endif()

if(NIUMA_ORACLE_BUILD_TESTS)
  enable_testing()
  add_executable(oracle-dialect-test tests/dialect_test.cpp src/dialect/profile.cpp)
  target_include_directories(oracle-dialect-test PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party
  )
  if(MSVC)
    target_compile_options(oracle-dialect-test PRIVATE /utf-8)
  endif()
  add_test(NAME oracle-dialect-test COMMAND oracle-dialect-test)

  add_executable(oracle-util-test
    tests/util_test.cpp
    src/util/ident.cpp
    src/util/sql_literal.cpp
    src/util/utf8.cpp
    src/util/connection_error.cpp
    src/meta/system_users.cpp
  )
  target_include_directories(oracle-util-test PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party
  )
  if(WIN32)
    target_compile_definitions(oracle-util-test PRIVATE NIUMA_OS_WIN=1 _CRT_SECURE_NO_WARNINGS)
  else()
    target_compile_definitions(oracle-util-test PRIVATE NIUMA_OS_UNIX=1)
  endif()
  if(MSVC)
    target_compile_options(oracle-util-test PRIVATE /utf-8)
  endif()
  add_test(NAME oracle-util-test COMMAND oracle-util-test)

  add_executable(oracle-script-split-test
    tests/script_split_test.cpp
    src/dataio/script_split.cpp
  )
  target_include_directories(oracle-script-split-test PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party
  )
  if(MSVC)
    target_compile_options(oracle-script-split-test PRIVATE /utf-8)
  endif()
  add_test(NAME oracle-script-split-test COMMAND oracle-script-split-test)

  add_executable(oracle-csv-codec-test
    tests/csv_codec_test.cpp
    src/dataio/csv_codec.cpp
  )
  target_include_directories(oracle-csv-codec-test PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
  )
  if(MSVC)
    target_compile_options(oracle-csv-codec-test PRIVATE /utf-8)
  endif()
  add_test(NAME oracle-csv-codec-test COMMAND oracle-csv-codec-test)

  add_executable(oracle-atomic-output-test
    tests/atomic_output_test.cpp
    src/dataio/atomic_output.cpp
  )
  target_include_directories(oracle-atomic-output-test PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
  )
  if(WIN32)
    target_compile_definitions(oracle-atomic-output-test PRIVATE _CRT_SECURE_NO_WARNINGS)
  endif()
  if(MSVC)
    target_compile_options(oracle-atomic-output-test PRIVATE /utf-8)
  endif()
  add_test(NAME oracle-atomic-output-test COMMAND oracle-atomic-output-test)
  # packages/cpp/serviceipc 的 ctest 已随 add_subdirectory 注册
endif()

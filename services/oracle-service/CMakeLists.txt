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
  src/meta/routines.cpp
  src/meta/monitor.cpp
  src/ddl/design.cpp
  src/dataio/manager.cpp
  src/dataio/csv.cpp
  src/dataio/dump.cpp
  src/dataio/execfile.cpp
  src/util/paths.cpp
  src/util/idgen.cpp
  src/util/ident.cpp
  src/util/sql_literal.cpp
  src/util/lob.cpp
  ${ODPI_SOURCES}
)

add_executable(niuma-oracle-service ${ORACLE_SERVICE_SOURCES})

target_include_directories(niuma-oracle-service PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/src
  ${CMAKE_CURRENT_SOURCE_DIR}/third_party
  ${ODPI_INC_DIR}
  ${ODPI_SRC_DIR}
)

target_link_libraries(niuma-oracle-service PRIVATE niuma::serviceipc niuma::netproxy)

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
    src/meta/system_users.cpp
  )
  target_include_directories(oracle-util-test PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party
  )
  if(MSVC)
    target_compile_options(oracle-util-test PRIVATE /utf-8)
  endif()
  add_test(NAME oracle-util-test COMMAND oracle-util-test)
  # packages/cpp/serviceipc 的 ctest 已随 add_subdirectory 注册
endif()

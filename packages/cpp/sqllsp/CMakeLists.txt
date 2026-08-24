cmake_minimum_required(VERSION 3.21)
project(niuma_sqllsp VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(NIUMA_SQLLSP_BUILD_TESTS "Build niuma_sqllsp unit tests" OFF)

# 父工程传入 nlohmann 头路径，例如 oracle-service/third_party
if(NOT NIUMA_SQLLSP_NLOHMANN_INCLUDE)
  message(FATAL_ERROR "NIUMA_SQLLSP_NLOHMANN_INCLUDE must point to a directory containing nlohmann/json.hpp")
endif()

add_library(niuma_sqllsp STATIC
  src/connection.cpp
  src/heuristic.cpp
  src/server.cpp
)

add_library(niuma::sqllsp ALIAS niuma_sqllsp)

target_include_directories(niuma_sqllsp
  PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
  PRIVATE
    ${NIUMA_SQLLSP_NLOHMANN_INCLUDE}
)

# nlohmann 为 header-only；对外暴露以便 service 与 sqllsp 共用同一套 JSON 类型
target_include_directories(niuma_sqllsp PUBLIC ${NIUMA_SQLLSP_NLOHMANN_INCLUDE})

if(WIN32)
  target_compile_definitions(niuma_sqllsp PRIVATE _CRT_SECURE_NO_WARNINGS)
  if(MSVC)
    target_compile_options(niuma_sqllsp PRIVATE /utf-8)
  endif()
endif()

if(NIUMA_SQLLSP_BUILD_TESTS)
  enable_testing()
  add_executable(sqllsp-heuristic-test tests/heuristic_test.cpp)
  target_link_libraries(sqllsp-heuristic-test PRIVATE niuma::sqllsp)
  if(MSVC)
    target_compile_options(sqllsp-heuristic-test PRIVATE /utf-8)
  endif()
  add_test(NAME sqllsp-heuristic-test COMMAND sqllsp-heuristic-test)
endif()

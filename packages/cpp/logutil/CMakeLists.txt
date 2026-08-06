cmake_minimum_required(VERSION 3.21)
project(niuma_logutil VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 父工程可在 add_subdirectory 前：
#   set(NIUMA_LOGUTIL_BUILD_TESTS OFF CACHE BOOL "" FORCE)
option(NIUMA_LOGUTIL_BUILD_TESTS "Build niuma_logutil unit tests" OFF)

add_library(niuma_logutil STATIC
  src/logutil.cpp
)

add_library(niuma::logutil ALIAS niuma_logutil)

target_include_directories(niuma_logutil
  PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
)

if(WIN32)
  target_compile_definitions(niuma_logutil PRIVATE _CRT_SECURE_NO_WARNINGS)
  if(MSVC)
    target_compile_options(niuma_logutil PRIVATE /utf-8)
  endif()
else()
  target_link_libraries(niuma_logutil PUBLIC pthread)
endif()

if(NIUMA_LOGUTIL_BUILD_TESTS)
  enable_testing()
endif()

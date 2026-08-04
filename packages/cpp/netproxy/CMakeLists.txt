cmake_minimum_required(VERSION 3.21)
project(niuma_netproxy VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 父工程可在 add_subdirectory 前：
#   set(NIUMA_NETPROXY_BUILD_TESTS OFF CACHE BOOL "" FORCE)
option(NIUMA_NETPROXY_BUILD_TESTS "Build niuma_netproxy unit tests" OFF)

add_library(niuma_netproxy STATIC
  src/netproxy.cpp
)

add_library(niuma::netproxy ALIAS niuma_netproxy)

target_include_directories(niuma_netproxy
  PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
)

if(WIN32)
  target_compile_definitions(niuma_netproxy PUBLIC NIUMA_NETPROXY_WIN=1)
  target_compile_definitions(niuma_netproxy PRIVATE _CRT_SECURE_NO_WARNINGS)
  target_link_libraries(niuma_netproxy PUBLIC ws2_32)
  if(MSVC)
    target_compile_options(niuma_netproxy PRIVATE /utf-8)
  endif()
else()
  target_compile_definitions(niuma_netproxy PUBLIC NIUMA_NETPROXY_UNIX=1)
  target_link_libraries(niuma_netproxy PUBLIC pthread)
endif()

if(NIUMA_NETPROXY_BUILD_TESTS)
  enable_testing()
  # 预留：代理协议单测（需本地 mock SOCKS/HTTP）
endif()

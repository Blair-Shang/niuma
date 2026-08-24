cmake_minimum_required(VERSION 3.21)
project(niuma_sshtunnel VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 父工程可在 add_subdirectory 前：
#   set(NIUMA_SSHTUNNEL_BUILD_TESTS OFF CACHE BOOL "" FORCE)
option(NIUMA_SSHTUNNEL_BUILD_TESTS "Build niuma_sshtunnel unit tests" OFF)

# 依赖 packages/cpp/netproxy（Dial + Options）
if(NOT TARGET niuma_netproxy AND NOT TARGET niuma::netproxy)
  message(FATAL_ERROR "niuma_sshtunnel requires niuma::netproxy (add_subdirectory netproxy first)")
endif()

include(FetchContent)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(ENABLE_ZLIB_COMPRESSION OFF CACHE BOOL "" FORCE)
if(WIN32)
  set(CRYPTO_BACKEND "WinCNG" CACHE STRING "" FORCE)
else()
  set(CRYPTO_BACKEND "OpenSSL" CACHE STRING "" FORCE)
endif()
FetchContent_Declare(
  libssh2
  GIT_REPOSITORY https://github.com/libssh2/libssh2.git
  GIT_TAG libssh2-1.11.1
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(libssh2)

add_library(niuma_sshtunnel STATIC
  src/sshtunnel.cpp
)

add_library(niuma::sshtunnel ALIAS niuma_sshtunnel)

target_include_directories(niuma_sshtunnel
  PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
)

target_link_libraries(niuma_sshtunnel PUBLIC niuma::netproxy)

if(TARGET libssh2_static)
  target_link_libraries(niuma_sshtunnel PUBLIC libssh2_static)
elseif(TARGET Libssh2::libssh2_static)
  target_link_libraries(niuma_sshtunnel PUBLIC Libssh2::libssh2_static)
elseif(TARGET libssh2)
  target_link_libraries(niuma_sshtunnel PUBLIC libssh2)
else()
  message(FATAL_ERROR "libssh2 target not found after FetchContent")
endif()

if(WIN32)
  target_compile_definitions(niuma_sshtunnel PRIVATE _CRT_SECURE_NO_WARNINGS)
  if(MSVC)
    target_compile_options(niuma_sshtunnel PRIVATE /utf-8)
  endif()
else()
  target_link_libraries(niuma_sshtunnel PUBLIC pthread)
endif()

if(NIUMA_SSHTUNNEL_BUILD_TESTS)
  enable_testing()
endif()

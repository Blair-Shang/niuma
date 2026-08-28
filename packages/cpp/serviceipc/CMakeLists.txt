cmake_minimum_required(VERSION 3.21)
project(niuma_serviceipc VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 父工程可在 add_subdirectory 前：
#   set(NIUMA_SERVICEIPC_BUILD_TESTS OFF CACHE BOOL "" FORCE)
option(NIUMA_SERVICEIPC_BUILD_TESTS "Build niuma_serviceipc unit tests" ON)

add_library(niuma_serviceipc STATIC
  src/frame.cpp
  src/server.cpp
  src/message.cpp
  src/event.cpp
)

add_library(niuma::serviceipc ALIAS niuma_serviceipc)

target_include_directories(niuma_serviceipc
  PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
)

if(WIN32)
  target_compile_definitions(niuma_serviceipc PUBLIC NIUMA_SERVICEIPC_WIN=1)
  target_compile_definitions(niuma_serviceipc PRIVATE _CRT_SECURE_NO_WARNINGS)
  if(MSVC)
    target_compile_options(niuma_serviceipc PRIVATE /utf-8)
  endif()
else()
  target_compile_definitions(niuma_serviceipc PUBLIC NIUMA_SERVICEIPC_UNIX=1)
  target_link_libraries(niuma_serviceipc PUBLIC pthread)
endif()

if(NIUMA_SERVICEIPC_BUILD_TESTS)
  enable_testing()
  add_executable(niuma-serviceipc-frame-test tests/frame_test.cpp)
  target_link_libraries(niuma-serviceipc-frame-test PRIVATE niuma_serviceipc)
  if(MSVC)
    target_compile_options(niuma-serviceipc-frame-test PRIVATE /utf-8)
  endif()
  add_test(NAME niuma-serviceipc-frame-test COMMAND niuma-serviceipc-frame-test)

  add_executable(niuma-serviceipc-message-test tests/message_test.cpp)
  target_link_libraries(niuma-serviceipc-message-test PRIVATE niuma_serviceipc)
  file(TO_CMAKE_PATH
       "${CMAKE_CURRENT_SOURCE_DIR}/../../go/serviceipc/envelope/golden"
       _niuma_ipc_golden_dir)
  target_compile_definitions(niuma-serviceipc-message-test PRIVATE
                             "NIUMA_IPC_GOLDEN_DIR=\"${_niuma_ipc_golden_dir}\"")
  if(MSVC)
    target_compile_options(niuma-serviceipc-message-test PRIVATE /utf-8)
  endif()
  add_test(NAME niuma-serviceipc-message-test COMMAND niuma-serviceipc-message-test)
endif()

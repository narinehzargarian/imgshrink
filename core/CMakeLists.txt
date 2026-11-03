# Native build of the C++ core, for the unit tests. The browser build uses Emscripten through
# scripts/build-wasm.sh instead.
cmake_minimum_required(VERSION 3.20)
project(imgshrink_core CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

option(IMGSHRINK_SANITIZE "Build with AddressSanitizer and UndefinedBehaviorSanitizer" OFF)
if(IMGSHRINK_SANITIZE)
  add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer)
  add_link_options(-fsanitize=address,undefined)
endif()

find_package(JPEG REQUIRED)
find_package(PNG REQUIRED)
find_package(GTest REQUIRED)

add_library(imgshrink_core
  src/image.cpp
  src/resize.cpp
  src/quantize.cpp
  src/encode.cpp
)
target_include_directories(imgshrink_core PUBLIC include)
target_link_libraries(imgshrink_core PUBLIC JPEG::JPEG PNG::PNG)
target_compile_options(imgshrink_core PRIVATE -Wall -Wextra -Wpedantic)

enable_testing()
add_executable(imgshrink_tests
  tests/fit_test.cpp
  tests/resize_test.cpp
  tests/quantize_test.cpp
  tests/encode_test.cpp
)
target_link_libraries(imgshrink_tests PRIVATE imgshrink_core GTest::gtest_main)
include(GoogleTest)
gtest_discover_tests(imgshrink_tests)

# ggml builds its Vulkan shader generator through ExternalProject. Its default
# nested binary directory exceeds Windows MAX_PATH under Cargo's target tree,
# preventing MSVC compiler detection even when Visual Studio is installed.
# Keep these build outputs under the parent CMake build directory instead.
if(CMAKE_HOST_WIN32)
    define_property(DIRECTORY PROPERTY EP_BASE INHERITED)
    set_property(DIRECTORY PROPERTY EP_BASE "${CMAKE_BINARY_DIR}/ep")
endif()

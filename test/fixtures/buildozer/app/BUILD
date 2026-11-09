package(default_visibility = ["//visibility:private"])

cc_library(
    name = "main",
    srcs = ["main.cc"],
    deps = [":util"],
)

cc_library(
    name = "util",
    srcs = ["util.cc"],
)

cc_test(
    name = "main_test",
    srcs = ["main_test.cc"],
    deps = [":main"],
)

cc_binary(
    name = "app",
    deps = [":main"],
)

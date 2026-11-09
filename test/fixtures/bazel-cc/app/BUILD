load("@rules_cc//cc:defs.bzl", "cc_binary", "cc_test")

cc_binary(
    name = "main",
    srcs = ["main.cc"],
    deps = ["//lib:greet"],
)

cc_test(
    name = "main_test",
    srcs = ["main_test.cc"],
    deps = ["//lib:greet"],
)

filegroup(
    name = "data",
    srcs = ["data.txt"],
)

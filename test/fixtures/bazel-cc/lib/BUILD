load("@rules_cc//cc:defs.bzl", "cc_library")

cc_library(
    name = "greet",
    srcs = ["greet.cc"],
    hdrs = ["greet.h"],
    visibility = ["//visibility:public"],
    deps = [
        "//util:text",
        "@abseil-cpp//absl/strings",
    ],
)

load("@rules_cc//cc:defs.bzl", "cc_library")

cc_library(
    name = "text",
    srcs = ["text.cc"],
    hdrs = ["text.h"],
    visibility = ["//visibility:public"],
    deps = [":strutil"],
)

cc_library(
    name = "strutil",
    srcs = ["strutil.cc"],
    hdrs = ["strutil.h"],
)

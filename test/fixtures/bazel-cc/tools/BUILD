load("@rules_cc//cc:defs.bzl", "cc_binary")

cc_binary(
    name = "fmt",
    srcs = ["fmt.cc"],
    deps = ["//util:text"],
)

genrule(
    name = "version",
    outs = ["version.txt"],
    cmd = "$(location :fmt) > $@",
    tools = [":fmt"],
)

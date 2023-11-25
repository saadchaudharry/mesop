"""
This includes the BUILD rules which should be considered
as part of Optic's public API.
"""

load("//builddefs:defs.bzl", "py_binary")

def optic_binary(name, srcs, data = [], deps = []):
    py_binary(
        name = name,
        srcs = srcs,
        data = data + ["//web/src/app/prod:web_package"],
        deps = deps + ["//optic"],
    )
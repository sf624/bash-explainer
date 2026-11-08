def _script_impl(ctx):
    out = ctx.actions.declare_file(ctx.label.name + ".sh")
    ctx.actions.write(out, "#!/bin/sh\nprintf 'arg:%s\\n' \"$@\"\n", is_executable = True)
    return [DefaultInfo(executable = out)]

script = rule(implementation = _script_impl, executable = True)
script_test = rule(implementation = _script_impl, test = True)

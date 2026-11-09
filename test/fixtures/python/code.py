# Names, numbers, operators, brackets, comments and line ends, as tokenize reads them (test/python-lexer.test.ts).
import os, sys as system
import os.path as osp
from subprocess import (run,  # why
    check_output as co)
from . import sibling; from .pkg import thing

x = 1_000 + 0x1F - 0o17 * 0b101 / 1.5e-3 // .5 % 3j ** 2. + 1E+10 + 0XaB_cD + 10.25J
y = [a for a in range(10) if a >= 2 and a != 3 or a <= 9 and a == 4 and a < 1 and a > 0]
z = {'k': (1, 2), "j": [3, 4]}; w = x @ y
x += 1; x -= 1; x *= 2; x /= 2; x //= 2; x %= 2; x **= 2; x >>= 1; x <<= 1
x &= 1; x |= 1; x ^= 1; x @= y; x = x << 1 >> 2 & 3 | 4 ^ ~5


def f(a, *args, b=1, **kw) -> int:
    return a if b else -a


lambda q: q
total = 1 + \
    2
name_ünï = "ok"
変数 = 1
if (n := 10) > 5: pass
...
async def g():
    await f(1)
print(x, end="")  # trailing
nested = [(1, {2: [3]}),
          # inside brackets
          4]
os.system("echo hi"); subprocess.run(["ls"])
	# a tab before a comment

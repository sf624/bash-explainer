# What the reference Python's `re` gives for the calls of test/python-examples-real.test.ts: run as
#   python3 -I test/support/python-calls.py < REQUEST.json
# REQUEST (on stdin): [{"call": CODE, "s": LITERAL or null, "tests": [TEXT…] or null, "bytes": BOOL}…]. CODE is a call of `re` as a
# `.py` file writes it, evaluated with `re` and `s` bound: `s` is the value of LITERAL, a Python literal (the input an example shows,
# as `repr` wrote it). CODE may have statements on lines before the call (`P = re.compile(…)`, for a method of `P`), run first.
# With "tests", it says for each text whether the call finds a match when `s` is that text (bytes for a bytes row; a compiled
# pattern: its `search`); else it gives the `repr` of what the call gives back, or the exception's type and message.
# It prints, as JSON, its version and the results, row by row.
import ast
import json
import re
import sys
import warnings

warnings.simplefilter('ignore')

request = json.load(sys.stdin)


def call(row, s):
    *before, last = row['call'].split('\n')
    names = {'re': re, 's': s}
    for statement in before:
        exec(statement, names)
    return eval(last, names)


def run(row):
    try:
        if row.get('tests') is not None:
            found = []
            for t in row['tests']:
                s = t.encode('ascii') if row['bytes'] else t
                got = call(row, s)
                if isinstance(got, re.Pattern):
                    got = got.search(s)
                found.append(got is not None)
            return found
        return repr(call(row, None if row.get('s') is None else ast.literal_eval(row['s'])))
    except Exception as e:  # (the row says what Python raised)
        return '%s: %s' % (type(e).__name__, e)


print(json.dumps({'version': '%d.%d' % sys.version_info[:2], 'results': [run(row) for row in request]}))

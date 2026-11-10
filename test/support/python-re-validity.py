# What the reference Python's `re.compile` makes of each row of test/regex-python-validity.test.ts: run as
#   python3 -I test/support/python-re-validity.py < REQUEST.json
# REQUEST (stdin): {"rows": [[pattern, flags, bytes]…]}, `flags` an int, `bytes` whether the pattern is compiled as bytes (encoded
# as Latin-1). It prints, as JSON, its version and for each row the kind of the exception (`PatternError`, named `re.error` before
# 3.13, or `ValueError`, raised for flags that do not go together) and its message, or nulls when the pattern compiles; and the
# warnings (FutureWarning) the parser gives, each by its message. The cache is purged before each row, so that each warns afresh.
import json
import re
import sys
import warnings

request = json.load(sys.stdin)
out = []
for pattern, flags, is_bytes in request['rows']:
    re.purge()
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        try:
            re.compile(pattern.encode('latin-1') if is_bytes else pattern, flags)
            kind, message = None, None
        except re.error as e:
            kind, message = 'PatternError', str(e)
        except ValueError as e:
            kind, message = 'ValueError', str(e)
    out.append({'kind': kind, 'message': message, 'warnings': [str(w.message) for w in caught if w.category is FutureWarning]})

print(json.dumps({'version': '%d.%d' % sys.version_info[:2], 'rows': out}))

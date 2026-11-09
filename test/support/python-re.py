# What the reference Python's `re` makes of the patterns of test/regex-python-real.test.ts: run as
#   python3 -I test/support/python-re.py REQUEST.json
# REQUEST: {"patterns": [pattern…], "searches": [[pattern, text]…]}. It prints, as JSON, its version; for each pattern, the
# message of the error that `re.compile` raises (`re.error`), or null when it compiles (a warning is no error here:
# `[[:alpha:]]`'s FutureWarning); and for each search, what `re.search` matches in the text, or null.
import json
import re
import sys
import warnings

warnings.simplefilter('ignore')

with open(sys.argv[1], encoding='utf-8') as f:
    request = json.load(f)

out = []
for pattern in request['patterns']:
    try:
        re.compile(pattern)
        out.append(None)
    except re.error as e:
        out.append(str(e))

found = []
for pattern, text in request.get('searches', []):
    m = re.search(pattern, text)
    found.append(m and m.group(0))

print(json.dumps({'version': '%d.%d' % sys.version_info[:2], 'errors': out, 'found': found}))

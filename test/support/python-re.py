# What the reference Python's `re` makes of the patterns of test/regex-python-real.test.ts: run as
#   python3 -I test/support/python-re.py REQUEST.json
# REQUEST: {"patterns": [pattern…], "flagged": [[pattern, flags, bytes]…], "searches": [[pattern, text]…]}. It prints, as JSON,
# its version; for each pattern, the message of the error that `re.compile` raises (`re.error`), or null when it compiles (a
# warning is no error here: `[[:alpha:]]`'s FutureWarning); the same for each flagged row, compiled with its flags (an int) as
# str or as bytes (encoded as Latin-1), where a `ValueError` of the flags is an error too; and for each search, what `re.search`
# matches in the text, or null. "templates": [[pattern, template, bytes]…], each the message of the error `re.sub` raises for that
# replacement template (`re.error`, or `IndexError` for a group name the pattern lacks), on an empty string, or null.
import json
import re
import sys
import warnings

warnings.simplefilter('ignore')

with open(sys.argv[1], encoding='utf-8') as f:
    request = json.load(f)


def compiled(pattern, flags=0):
    try:
        re.compile(pattern, flags)
        return None
    except (re.error, ValueError) as e:
        return str(e)


out = [compiled(pattern) for pattern in request['patterns']]
flagged = [compiled(pattern.encode('latin-1') if is_bytes else pattern, flags) for pattern, flags, is_bytes in request.get('flagged', [])]

found = []
for pattern, text in request.get('searches', []):
    m = re.search(pattern, text)
    found.append(m and m.group(0))



def template(pattern, repl, is_bytes):
    if is_bytes:
        pattern, repl = pattern.encode('latin-1'), repl.encode('latin-1')
    try:
        re.sub(pattern, repl, pattern[:0])
        return None
    except (re.error, IndexError) as e:
        return str(e)


templates = [template(*row) for row in request.get('templates', [])]

print(json.dumps({'version': '%d.%d' % sys.version_info[:2], 'errors': out, 'flagged': flagged, 'found': found, 'templates': templates}))

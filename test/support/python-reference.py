# What the reference Python makes of the fixture files of test/python-lexer.test.ts: run as
#   python3 -I test/support/python-reference.py REQUEST.json
# REQUEST: {"files": [path…], "pieces": [[prefix, text]…]}. It prints, as JSON, its version, and for each file the tokens of
# `tokenize` (type, start, end, as offsets in UTF-16 code units, as JavaScript counts) and the value of each string literal:
# `ast.literal_eval` for a str or bytes literal, the parts of an f-string or a t-string (its text, and null for a field); and
# the value of each piece (the source of one character of a value, in a literal of that prefix).
# It only reads the files: tokenize and ast do not run them.
import ast
import io
import json
import sys
import tokenize
import warnings

warnings.simplefilter('ignore')

SKIP = {'NL', 'INDENT', 'DEDENT', 'ENDMARKER', 'FSTRING_MIDDLE', 'TSTRING_MIDDLE'}


def units(text):
    """The offset in UTF-16 code units of each character index of text, and of its end."""
    out = [0]
    for c in text:
        out.append(out[-1] + (2 if ord(c) > 0xFFFF else 1))
    return out


def value(v):
    if isinstance(v, bytes):
        return {'b': v.decode('latin-1')}
    return {'s': v}


def parts(node):
    out = []
    for p in node.values:
        if isinstance(p, ast.Constant):
            out.append(p.value)
        else:
            out.append(None)
    return {'f': out}


def read(path):
    with open(path, encoding='utf-8') as f:
        text = f.read()
    starts = [0]
    for line in text.split('\n'):
        starts.append(starts[-1] + len(line) + 1)
    u = units(text)
    # (The NEWLINE of a last line with no newline ends one past the text, and the ENDMARKER on the line after it.)
    off = lambda pos: u[min(starts[min(pos[0], len(starts)) - 1] + pos[1], len(text))]
    tokens, values, open_ = [], [], []
    for t in tokenize.generate_tokens(io.StringIO(text).readline):
        name = tokenize.tok_name[t.type]
        if name in SKIP:
            continue
        start, end = starts[t.start[0] - 1] + t.start[1], starts[t.end[0] - 1] + t.end[1]
        tokens.append([name, off(t.start), off(t.end)])
        if name == 'STRING':
            values.append([off(t.start), value(ast.literal_eval(t.string))])
        elif name in ('FSTRING_START', 'TSTRING_START'):
            open_.append((start, off(t.start)))
        elif name in ('FSTRING_END', 'TSTRING_END'):
            s, o = open_.pop()
            values.append([o, parts(ast.parse(text[s:end], mode='eval').body)])
    values.sort(key=lambda v: v[0])
    return {'tokens': tokens, 'values': values}


def piece(prefix, text):
    quote = "'''" if text == '"' else '"""'
    # (A piece that ends in a backslash would escape the quote: one more character, taken off after.)
    extra = text.endswith('\\')
    try:
        node = ast.parse(prefix + quote + text + (' ' if extra else '') + quote, mode='eval').body
    except SyntaxError as e:
        return {'error': str(e)}
    if isinstance(node, ast.JoinedStr):
        # (An f-string's piece holds no field: `{{` or a character.)
        v = {'s': ''.join(p.value for p in node.values)}
    else:
        v = value(node.value)
    if extra:
        v = {k: s[:-1] for k, s in v.items()}
    return v


def main():
    with open(sys.argv[1], encoding='utf-8') as f:
        request = json.load(f)
    print(json.dumps({
        'version': '%d.%d' % sys.version_info[:2],
        'files': {p: read(p) for p in request['files']},
        'pieces': [piece(p, t) for p, t in request['pieces']],
    }))


main()

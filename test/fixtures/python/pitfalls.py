# The strings of patterns that are not raw, and f-string patterns (docs/design/python-regex.md, 4.3 and 5.3), as tokenize and ast read them.
import re
from re import escape

re.search("\bword\b", s)
re.match("\d+\.\s\w", s)
re.search("(a)\1|(b)\12", s)
re.search("\0\012\101[\1]\8", s)
re.search(b"\b\d\u", s)
re.search(rf"^{prefix}\d+$", s)
re.search(f"a{{2}}", s)
re.search(f"^{re.escape(x)}[{escape(y)}]+$", s)
re.search(f"\b{w}\b", s)
re.search(f"({x}|{y})\1", s)
re.search(f"{x!r}{x:>3}{x=}{re.escape(x)!r}", s)
re.search(F"\{name}", s) and re.search(Rf"\b{w}", s)

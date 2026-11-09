# Patterns of Python's re module, as the Python host reads them (docs/design/python-regex.md).
import re
import re as regex
from re import compile as rx, sub

NUMBER = re.compile(r'^\d+(?P<frac>\.\d+)?$')
m = re.search(r'(\w+)@(\w+)\.com', text)
if re.match('[A-Z][a-z]*', name):
    pass
whole = re.fullmatch(r'\d{3}-\d{4}', phone)
words = regex.findall("\\b\\w+\\b", text)
parts = re.split(r'[,;]\s*', line)
fixed = sub(r'(\d+)', r'<\1>', text)
DATE = rx(
    r'(?P<y>\d{4})-'
    r'(?P<m>\d{2})-'
    r'(?P<d>\d{2})'
)
BLOCK = re.compile(r'''^\s*
[a-z]+$''')
bad = re.compile(r'\e')
re.match('x', s); os.system('ls')

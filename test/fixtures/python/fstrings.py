# f-strings and t-strings, nested by the rules of Python 3.12 (PEP 701), as tokenize and ast read them (test/python-lexer.test.ts).
name = "x"
a = f"plain {name} and {{braces}} }} {name!r} {name:>10} {name!s:^{width}} {name=} {name = !r:>3}"
b = f"{f"{name}"}"  # the same quotes nested
c = f"{'single'} {"double"} {'''triple'''} {f'{f"{name}"}'}"
d = rf"\d{name}\{name}" Rf'{name}' fR"x" FR"y" fr'z' F"{name}"
e = f"\N{BULLET} {name}\n\t{3.14:.2f} {x[0]:{w}.{p}} \{name}"
f = f"""multi
{name
  # a comment in a field
}
end {name:{
width}}"""
g = f"{a!=b} {a==b} {a<=b} {a>=b} {(lambda: 1)()} {x:{'nested'}} {x:{{}}}"
h = f"{  name  }" f"{name:=10}" f"{d['key']}" f'{d["key"]}' f"{a}{b}{c}"
i = f"{'\n'.join(x)}" f"{x!a}" f"{name=:>{w}}"
t = t"{name} template" tr'\d{name}' Tr"y" rt"{name!r}" T'{name=}'
j = f'{{' f"}}" f"{{{name}}}" f""

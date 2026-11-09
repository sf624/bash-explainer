# String literals with every prefix and escape, as tokenize and ast.literal_eval read them (test/python-lexer.test.ts).
a = 'single' "double" '''triple
lines''' """also
"triple" with "" quotes"""
b = r'raw \n \' kept' R"RAW \"" rb'\x00' Rb"x" bR'y' BR"z" br'' rB"" Br'w' RB"v"
c = b'bytes \x41 \101 \n \777 \u0041 \N{BULLET}' B"B"
d = u'unicode' U"U" ''
e = "\a\b\f\n\r\t\v\\\'\" \0 \012 \1 \18 \400 \777 \x41 \xfF \u00e9 \U0001F600 \N{BULLET} \N{LATIN SMALL LETTER A} \z \8 \
joined"
f = '''real
newline\
 and join \''' '''
g = "é漢字😀 \u6f22" r"\N{BULLET} \
raw join"
h = 'a\
b' "\\" '\\\\' "\"\\\""
i = """x""" '''y''' """"quoted" at the start""" '''ends in a quote"'''

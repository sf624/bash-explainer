#include "util/text.h"
#include "util/strutil.h"
std::string Upper(const std::string& s) { return MapChars(s, [](char c) { return c >= 'a' && c <= 'z' ? c - 32 : c; }); }

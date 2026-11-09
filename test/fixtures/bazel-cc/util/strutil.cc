#include "util/strutil.h"
std::string MapChars(const std::string& s, char (*f)(char)) {
  std::string out;
  for (char c : s) out += f(c);
  return out;
}

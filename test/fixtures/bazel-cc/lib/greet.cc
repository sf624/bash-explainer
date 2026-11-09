#include "lib/greet.h"
#include "absl/strings/str_cat.h"
#include "util/text.h"
std::string Greet(const std::string& name) { return absl::StrCat("hello, ", Upper(name)); }

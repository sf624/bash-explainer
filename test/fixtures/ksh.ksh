#!/bin/ksh
f() {
  typeset count=0
  print -u2 "count: $count"
}
whence -v jq
echo ${name^^}

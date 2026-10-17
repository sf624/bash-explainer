#!/bin/sh
# A throwaway script for trying the Bash Explainer action: bash-only constructs under /bin/sh.
set -euo pipefail

name=${1:-world}
if [[ -n $name ]]; then
  echo "hello, ${name^^}" &> /dev/null
fi

function cleanup { rm -f /tmp/demo.$$; }
files=(a b c)
echo "${#files[@]} files"

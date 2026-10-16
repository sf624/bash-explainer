#!/bin/sh
# Bash-only constructs in a /bin/sh script: Bash Explain points out what fails in dash or busybox ash.
set -euo pipefail
if [[ -z "${1:-}" ]]; then echo "usage" >&2; fi
files=(*.txt)
name=${1,,}
make build &> build.log
function cleanup { rm -f "$tmp"; }
read -rp "Continue? " ans
echo -e "done\tok"
for i in {1..3}; do echo $i; done
f() { local v=$1; echo "$v"; }

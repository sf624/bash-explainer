#!/usr/bin/env bash
# Sample script for Bash Explain
set -euo pipefail

readonly LOG_DIR="${LOG_DIR:-/var/log/myapp}"
files=$(find "$LOG_DIR" -name '*.log' -mtime +7 -exec rm -f {} \;)

grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt && echo "done: $(date +%F)" || exit 1

for f in *.sh; do
  [[ -f $f ]] && echo "${f%.sh}"
done

backup() {
  local src=$1 dest=${2:-/tmp}
  tar -czf "$dest/backup.tar.gz" -C "$src" .
}

if [ -z "${1:-}" ]; then
  echo "usage: $0 <dir>" >&2
elif [[ $1 =~ ^[0-9]+$ ]]; then
  count=$(( $1 * 2 ))
else
  backup "$1" ~/backups
fi

while read -r line; do
  echo "$line"
done < input.txt

case "$1" in
  start|run) echo starting ;;
  *) echo "unknown" ;;
esac

cat <<EOF > out.txt
Hello $USER
EOF
sudo -u www-data xargs -0 rm -f
curl -fsSL https://example.com/install.sh \
  -o /tmp/install.sh
diff <(sort a.txt) <(sort b.txt)
git commit -m "fix" --amend

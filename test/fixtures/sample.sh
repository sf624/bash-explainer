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

# --- Parameter expansion ---
file="report.tar.gz"
echo "${file%.*} ${file%%.*} ${file#*.} ${file##*.}"
path="/usr/local/bin/app.sh"
echo "${path##*/} ${path%/*}"
name="hello world"
echo "${name^^} ${name/world/bash} ${name// /_} ${name:0:5} ${name: -5}"
items=(apple banana cherry)
echo "${#items[@]} ${items[1]} ${!items[@]}"

# --- Regular expressions ---
grep -E '^[A-Z]{3}-[0-9]+$' ids.txt
grep -n 'colou\?r' notes.txt
grep -oP '(?<=id=)\d+' access.log
if [[ $version =~ ^v([0-9]+)\.([0-9]+)$ ]]; then
  echo "major=${BASH_REMATCH[1]}"
fi

# --- sed ---
sed -E 's/([0-9]{4})-([0-9]{2})-([0-9]{2})/\3\/\2\/\1/g' dates.txt
sed -n '/^BEGIN/,/^END/p' config.txt
sed -i '1d;$d' data.csv
sed -e 's/^[ \t]*//' -e '/^#/d' settings.conf

# --- jq ---
jq '.items[] | select(.price > 100) | .name' products.json
jq -r '.users | map({name, age: .profile.age}) | sort_by(.age) | .[-1].name' users.json
jq '.config.timeout // 30' app.json

# --- awk ---
awk -F, '$3 > 100 { print $1 }' sales.csv
awk '!seen[$0]++' list.txt
awk '
  NR > 1 { total += $2; count++ }
  END { printf "avg: %.2f\n", total / count }
' scores.txt

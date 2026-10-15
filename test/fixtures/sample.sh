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

# --- Format strings ---
printf '%-10s|%05.2f|%x\n' "$name" 3.14159 255
printf '\033[1;32m%s\033[0m\n' "OK"
stamp=$(date +%Y-%m-%dT%H:%M:%S)
date '+%-d %B %Y (%a)'

# --- find expressions ---
find . \( -name '*.log' -o -name '*.tmp' \) -mtime +7 -print
find . -path ./node_modules -prune -o -type f -name '*.js' -print
find /var/backups -type f -name '*.gz' ! -newer reference -exec rm -f {} +

# --- Permissions ---
chmod 755 deploy.sh
chmod 4755 /usr/local/bin/helper
chmod -R u+rwX,go-w shared/
umask 077
mkdir -m 700 secrets

# --- Idioms and redirection order ---
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
: "${API_TOKEN:?API_TOKEN must be set}"
if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
fi
make build 2>&1 >build.log
exec 3>&1 1>&2 2>&3
trap 'rm -rf "$workdir"' EXIT
workdir=$(mktemp -d)
rm -f /tmp/old.lock || true
while IFS= read -r entry; do echo "$entry"; done < list.txt
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "run directly"
fi

# --- sort / cut / tr ---
sort -t: -k3,3nr /etc/passwd | head -n 5
sort -k2 scores.txt
cut -d, -f2-4,7 data.csv
tr '[:upper:]' '[:lower:]' < names.txt
tr -d '\r' < windows.txt > unix.txt

# --- getopts ---
while getopts ":hv:o:" opt; do
  case "$opt" in
    h) usage ;;
    v) verbose=$OPTARG ;;
    o) output=$OPTARG ;;
    \?) echo "unknown option: -$OPTARG" >&2 ;;
  esac
done
shift $((OPTIND - 1))

# --- perl one-liners ---
perl -pi -e 's/foo(\d+)/bar$1/g' *.txt
perl -lane 'print $F[1] if $F[2] > 100' data.txt
perl -ne 'print if /^ERROR/' app.log
perl -pie 's/a/b/' oops.txt

# --- git log formats ---
git log --pretty=format:'%h %an %ar %s' --date=short
git log --format='%C(yellow)%h%Creset %<(20)%an %s%d' -n 5
git log --date=format:'%Y-%m-%d %H:%M' --pretty=oneline

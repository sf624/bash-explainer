#!/usr/bin/env bash

# --- Basics: redirections, expansions, control flow ---
set -euo pipefail
trap 'rm -rf "$workdir"' EXIT
workdir=$(mktemp -d)
make build > build.log 2>&1 || exit 1
grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt && echo "done: $(date +%F)" || exit 1
echo "done" >> run.log
sort < input.txt
tr a-z A-Z <<< "$name"
diff <(sort a.txt) <(sort b.txt)
file="report.tar.gz"
echo "${file%.*} ${file%%.*} ${file#*.} ${file##*.}"
echo "${#file} ${file//a/b} ${file:0:6} ${DEBUG:-off} ${file^^}"
items=(apple banana cherry)
echo "${#items[@]} ${items[1]} ${items[@]}"
count=$(( ${#items[@]} * 2 ))
(( count++ ))
if [ -z "${1:-}" ]; then
  echo "usage: $0 <dir>" >&2
elif [[ $1 =~ ^[0-9]+$ ]]; then
  count=$(( $1 * 2 ))
else
  echo "dir: $1"
fi
while read -r line; do
  echo "$line"
done < input.txt
case "$1" in
  start|run) echo starting ;;
  *) echo "unknown" ;;
esac
backup() {
  local src=$1 dest=${2:-/tmp}
  tar -czf "$dest/backup.tar.gz" -C "$src" .
}
printf '%-10s|%05.2f|%x\n' "$name" 3.14159 255
printf '\033[1;32m%s\033[0m\n' "OK"
mkdir -p project/{src,test,docs}
cp config.yml{,.bak}
echo {1..10..3} {a..e}

# --- Commands with examples ---
grep -E '^[A-Z]{3}-[0-9]+$' ids.txt
grep -oP '(?<=id=)\d+' access.log
sed -n '/^BEGIN/,/^END/p' config.txt
sed -i '1d;$d' data.csv
sed -E 's/^([a-z]+)=(.*)$/\2=\1/' config.ini
awk -F, '$3 > 100 { print $1 }' sales.csv
awk '!seen[$0]++' list.txt
jq '.config.timeout // 30' app.json
yq '.items[] | select(.kind == "Pod") | .metadata.name' pods.yml
yq e -i '.spec.replicas = 3' deployment.yaml
perl -pi -e 's/foo(\d+)/bar$1/g' *.txt
perl -lane 'print $F[1] if $F[2] > 100' data.txt
sort -t: -k3,3nr /etc/passwd
uniq -c sorted.txt
cut -d, -f2-4,7 data.csv
tr -d '\r' < windows.txt > unix.txt
head -n -2 report.txt
tail -n +2 table.csv
seq -w 1 3 10
grep -i error app.log | sort | uniq -c | sort -rn | head -n 3
ls *.[ch]
rm -f log-202[0-4]-??.txt
[ "$count" -gt 10 ] && echo "many"
find . -name '*.tmp' -print0 | xargs -0 rm -f
xargs -n 2 echo < pairs.txt
IFS=: read -r user _ uid gid rest <<< "$entry"
IFS=, read -ra fields <<< "$csv_line"
while getopts ":hv:o:" opt; do
  case "$opt" in
    h) usage ;;
    v) verbose=$OPTARG ;;
    \?) echo "unknown option: -$OPTARG" >&2 ;;
  esac
done
OPTS=$(getopt -o hv:o: --long help,verbose:,output: -n "$0" -- "$@") || exit 1
git log --pretty=format:'%h %an %ar %s' --date=short
git log --format='%C(yellow)%h%Creset %<(20)%an %s%d' -n 5
date '+%-d %B %Y (%a)'
find . \( -name '*.log' -o -name '*.tmp' \) -mtime +7 -print
tar -xzf backup.tar.gz -C /tmp
curl -fsSL https://example.com/install.sh -o /tmp/install.sh
git commit -m "fix" --amend
docker run --rm -it -v "$PWD":/app -p 8080:80 nginx:alpine
chmod 755 deploy.sh
sudo -u www-data ls /srv

# --- Pitfalls the extension points out ---
ls **/*.conf
rm -rf $BUILD_DIR/cache
read line
cat $file
sudo echo "nameserver 1.1.1.1" > /etc/resolv.conf
for f in $(ls *.txt); do echo "$f"; done
for a in $*; do echo "$a"; done
[ $answer = yes ] && echo "ok"
x = 1
make 2>&1 >build.log
f() {
  local out=$(date)
}

# --- Tricky syntax, read as bash does ---
[[ -f a && $x =~ ^[0-9]+$ ]]
[[ $x = *.txt || $x = *.sh ]]
[[ ":$PATH:" = *":$d:"* ]]
[[ ! $x =~ ^a ]]
echo "${s:$i:2}"
[ "$a" -eq 1 -a "$b" -eq 2 ]
[ ! a = b -a -f c ]
[ -a file ]
sudo sh -c 'printf "%s\n" "$1" > /etc/motd' sh "$msg"
cat <<-'EOF'
	tabs are removed, and $nothing expands
	EOF
shopt -s extglob
rm -f -- !(keep|this).log
ls @(a|b).txt
time sleep 1
select choice in start stop quit; do echo "$choice"; break; done
for ((i=0; i<3; i++)); do echo "$i"; done

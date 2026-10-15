#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="${1:-/var/log/myapp}"

for f in "$LOG_DIR"/*.log; do
  [[ -s $f ]] || continue
  grep -n "ERROR" "$f" 2>/dev/null | tail -n 5 >> errors.txt
done

find "$LOG_DIR" -name '*.log' -mtime +7 -exec rm -f {} \;
tar -czf "backup-$(date +%F).tar.gz" -C "$LOG_DIR" .

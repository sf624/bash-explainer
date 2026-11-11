// A generated dispatcher, the shape of long scripts like nvm.sh (docs/design/large-scripts.md, 1.1): `count`
// commands, each calling two helpers with a prefix assignment (`MODE=a helper_3 "$1"`) and one more in a
// `while read` loop, all called from one `case` in `main`, `calls` of them in each branch.

export function prefixDispatcher(count: number, calls: number): string {
  const out = ['#!/bin/bash', 'MODE=', 'COUNT=0'];
  for (let i = 0; i < count; i++) {
    out.push(`helper_${i}() {`, '  local v="${1-}"', `  if [ -n "$v" ]; then H_${i}=$v; fi`, `  G_${i}=$MODE`, '  COUNT=$((COUNT + 1))', '}');
  }
  for (let i = 0; i < count; i++) {
    const [a, b] = [i % count, (i * 7 + 3) % count];
    out.push(`cmd_${i}() {`, '  local line', `  MODE=a helper_${a} "\${1-}"`, `  MODE=b helper_${b}`,
      '  while read -r line; do', `    OUT_${i}=$line`, `    MODE=c helper_${(a + 1) % count} "$line"`, '  done < /dev/null', '}');
  }
  out.push('main() {', '  case "${1-}" in');
  for (let i = 0; i < count; i++) {
    const targets = Array.from({ length: calls }, (_, k) => (i * (k + 1) + 1) % count);
    out.push(`    c${i}) ` + targets.map((t, k) => `MODE=m${k} cmd_${t} "\${2-}"`).join('; ') + ' ;;');
  }
  out.push('    *) echo "usage" >&2; return 1 ;;', '  esac', '}', 'main "$@"');
  return out.join('\n');
}

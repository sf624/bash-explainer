import type { Json } from './jq';

/** Whose YAML: mikefarah/yq (yaml.v3, YAML 1.2) or kislyuk/yq (PyYAML, YAML 1.1). */
export type YamlStyle = 'mikefarah' | 'kislyuk';

export class YamlUnsupported extends Error {}

const NUMBER = /^[-+]?(\d[\d_]*(\.\d*)?|\.\d+)([eE][-+]?\d+)?$|^0x[0-9a-fA-F]+$|^0o[0-7]+$|^[-+]?\.(inf|Inf|INF)$|^\.(nan|NaN|NAN)$/;
const CORE = /^(true|True|TRUE|false|False|FALSE|null|Null|NULL|~|)$/;
/** YAML 1.1 also reads these as booleans (and some more forms as numbers). */
const YAML11 = /^(y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF)$|^[-+]?\d[\d_]*(:[0-5]?\d)+(\.\d*)?$|^0b[01_]+$/;

/** Whether a string must be quoted to stay a string. */
function needsQuotes(s: string, style: YamlStyle): boolean {
  if (CORE.test(s) || NUMBER.test(s) || (style === 'kislyuk' && YAML11.test(s))) return true;
  if (/^[\s]|[\s]$/.test(s)) return true;
  // Indicators that cannot start a plain scalar; `-`, `?`, `:` only when followed by a space.
  if (/^[[\]{},#&*!|>'"%@`]/.test(s) || /^[-?:](\s|$)/.test(s)) return true;
  return /: |:$| #|[\t]/.test(s);
}

function scalar(v: Json, style: YamlStyle): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return Number.isInteger(v) || Math.abs(v) >= 1e-4 ? String(v) : (() => { throw new YamlUnsupported('number'); })();
  if (typeof v !== 'string') throw new YamlUnsupported('not a scalar');
  if (!needsQuotes(v, style)) return v;
  // mikefarah/yq quotes look-alike numbers and booleans with "…", other strings with '…'; PyYAML always uses '…'.
  if (style === 'mikefarah' && (CORE.test(v) || NUMBER.test(v))) return JSON.stringify(v);
  if (v.includes("'") && style === 'mikefarah') return JSON.stringify(v);
  return `'${v.replace(/'/g, "''")}'`;
}

const isMap = (v: Json): v is { [k: string]: Json } => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Block-style YAML lines for a value, as the given yq prints it. */
export function yamlLines(v: Json, style: YamlStyle): string[] {
  if (typeof v === 'string' && v.includes('\n')) {
    if (style === 'kislyuk') throw new YamlUnsupported('multi-line string');
    return [`|${v.endsWith('\n') ? '' : '-'}`, ...v.replace(/\n$/, '').split('\n').map((l) => `  ${l}`)];
  }
  if (Array.isArray(v)) {
    if (!v.length) return ['[]'];
    return v.flatMap((item) => {
      const lines = yamlLines(item, style);
      if (typeof item === 'string' && item.includes('\n')) return [`- ${lines[0]}`, ...lines.slice(1).map((l) => `  ${l}`)];
      return [`- ${lines[0]}`, ...lines.slice(1).map((l) => `  ${l}`)];
    });
  }
  if (isMap(v)) {
    const keys = Object.keys(v);
    if (!keys.length) return ['{}'];
    return keys.flatMap((k) => {
      const key = scalar(k, style);
      const val = v[k];
      if ((Array.isArray(val) && val.length) || (isMap(val) && Object.keys(val).length)) {
        return [`${key}:`, ...yamlLines(val, style).map((l) => `  ${l}`)];
      }
      const lines = yamlLines(val, style);
      return [`${key}: ${lines[0]}`, ...lines.slice(1)];
    });
  }
  return [scalar(v, style)];
}

/**
 * What yq prints for these results: mikefarah/yq prints them one after another (strings
 * unquoted); kislyuk/yq with `-y` separates them with `---` and ends a lone scalar with `...`.
 */
export function yqYamlOutput(values: Json[], style: YamlStyle): string[] {
  if (style === 'mikefarah') {
    return values.flatMap((v) => (typeof v === 'string' && !v.includes('\n') ? [v] : yamlLines(v, style)));
  }
  const out: string[] = [];
  values.forEach((v, i) => {
    if (i) out.push('---');
    out.push(...yamlLines(v, style));
  });
  const last = values[values.length - 1];
  // PyYAML ends a document that is a single plain (unquoted) scalar with `...`.
  if (values.length && (last === null || typeof last !== 'object') && !/^['"]/.test(out[out.length - 1])) out.push('...');
  return out;
}

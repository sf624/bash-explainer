// Design study helper (not a test): prints the semantic tokens of a file, plain and rich, decoded.
// usage: npx tsx test/sh-dump-tokens.ts <file> [languageId]
import fs from 'node:fs';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { extractShell, hostKind } from '../src/hosts';
import { LEGEND, RICH_LEGEND, richSemanticTokens, semanticTokens } from '../src/semanticTokens';
import type { ShellDocument } from '../src/document';

const [file, lang = 'shellscript'] = process.argv.slice(2);
const text = fs.readFileSync(file, 'utf8');
const parser = createUnbashParser();
const kind = lang === 'shellscript' ? undefined : hostKind(lang, file, text);
const extracted = kind ? extractShell(kind, text) : undefined;
const doc: ShellDocument = { lines: text.split('\n'), tree: parser.parse(extracted ? extracted.text : text), ...(extracted ? { extracted } : {}) };
const lines = text.split('\n');
const decode = (data: number[], legend: { tokenTypes: string[]; tokenModifiers: string[] }) => {
  const out: string[] = [];
  let line = 0, col = 0;
  for (let i = 0; i < data.length; i += 5) {
    if (data[i]) col = 0;
    line += data[i]; col += data[i + 1];
    const mods = legend.tokenModifiers.filter((_, b) => data[i + 4] & (1 << b));
    out.push(`${line + 1}:${col} ${JSON.stringify(lines[line].slice(col, col + data[i + 2]))} ${legend.tokenTypes[data[i + 3]]}${mods.map((m) => '.' + m).join('')}`);
  }
  return out;
};
const plain = new Set(decode(semanticTokens(doc), LEGEND));
const rich = decode(richSemanticTokens(doc), RICH_LEGEND);
for (const r of rich) console.log(plain.has(r) ? '  ' : '+ ', r);
for (const p of plain) if (!rich.includes(p)) console.log('- ', p);

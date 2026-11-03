// A Language Server under the worst documents, in a process of its own: what ends the process (an exception of a timer, the memory)
// is what is looked for (docs/design/line-budget.md). test/line-budget.test.ts runs it under a memory cap and reads what it prints.
// usage: npx tsx test/support/line-budget-lsp.ts
import { PassThrough } from 'stream';
import { startLanguageServer } from '../../cli/lsp';

/** The documents: each is opened, its problems are published, and it is hovered. */
export const WORST: readonly { name: string; text: string }[] = [
  { name: 'nested substitutions', text: `echo ${'"$('.repeat(2e4)}\n` },
  { name: 'coprocesses', text: `${'coproc '.repeat(5e4)}\n` },
  { name: 'a long negation', text: `${'! '.repeat(1e5)}\n` },
  { name: 'rows of an example', text: `jq -n '[range(9e4)]|[paths]'\n` },
  { name: 'a huge number', text: 'echo a | cut -f 1000000000\n' },
];

if (require.main === module) {
  const input = new PassThrough();
  const output = new PassThrough();
  let wire = '';
  output.on('data', (d: Buffer) => { wire += d.toString('utf8'); });
  const send = (m: object) => {
    const json = JSON.stringify({ jsonrpc: '2.0', ...m });
    input.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  };
  /** The answer to request `id`, once it has come. */
  const answer = async (id: number): Promise<{ result?: unknown; error?: unknown }> => {
    const at = `"id":${id},`;
    while (!wire.includes(at)) await new Promise((r) => setTimeout(r, 5));
    const start = wire.lastIndexOf('{"jsonrpc"', wire.indexOf(at));
    const end = wire.indexOf('Content-Length', start);
    return JSON.parse(end < 0 ? wire.slice(start) : wire.slice(start, end));
  };
  /** Whether the problems of `uri` have been published. */
  const published = async (uri: string): Promise<void> => {
    while (!wire.includes(`"uri":"${uri}"`)) await new Promise((r) => setTimeout(r, 5));
  };
  const open = (uri: string, text: string) => send({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'shellscript', version: 1, text } } });
  const hover = (id: number, uri: string, line = 0) => send({ id, method: 'textDocument/hover', params: { textDocument: { uri }, position: { line, character: 1 } } });
  (async () => {
    startLanguageServer({ input, output, env: {}, version: 'test', exit: () => undefined });
    send({ id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } });
    await answer(1);
    open('file:///other.sh', 'echo other\n');
    let id = 1;
    const rows: { name: string; ms: number; error: unknown; other: boolean; said: string }[] = [];
    for (const [k, { name, text }] of WORST.entries()) {
      const uri = `file:///worst${k}.sh`;
      const t0 = Date.now();
      open(uri, text);
      await published(uri);
      hover(++id, uri);
      const own = await answer(id);
      // (The server still answers about another document.)
      hover(++id, 'file:///other.sh');
      const other = await answer(id);
      rows.push({ name, ms: Date.now() - t0, error: own.error ?? other.error ?? null, other: JSON.stringify(other.result).includes('echo'), said: JSON.stringify(own.result ?? null).slice(0, 2000) });
    }
    // (Set before it ends: the process ends here, and has outlived the timers of the documents above.)
    console.log(JSON.stringify(rows));
    process.exit(0);
  })();
}

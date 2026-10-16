import * as assert from 'assert';
import { base64Decode, base64Encode, utf8Length } from '../src/examples/bytes';

// The helpers replace Buffer so the examples also run in a browser; they must agree with it.
describe('bytes without Buffer', () => {
  const texts = ['', 'a', 'ab', 'abc', 'hello world', 'こんにちは', '😀 emoji', 'tab\there\nnewline'];

  it('counts UTF-8 bytes like Buffer.byteLength', () => {
    for (const t of texts) assert.strictEqual(utf8Length(t), Buffer.byteLength(t), t);
  });

  it('encodes base64 like Buffer', () => {
    for (const t of texts) assert.strictEqual(base64Encode(t), Buffer.from(t, 'utf8').toString('base64'), t);
  });

  it('decodes base64 like Buffer, including sloppy input', () => {
    const inputs = [...texts.map((t) => Buffer.from(t).toString('base64')), 'aGVsbG8', 'aGVsbG8=', 'aGVs bG8=', 'aGVsbG8-_w', 'YQ==YQ==', '!!!', 'a', '/w==', '4pyT'];
    for (const b of inputs) assert.strictEqual(base64Decode(b), Buffer.from(b, 'base64').toString('utf8'), b);
  });
});

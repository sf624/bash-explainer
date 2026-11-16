import * as assert from 'assert';
import { base64Decode, base64Encode, isAscii, utf8Bytes, utf8Length, utf8Offset } from '../src/examples/bytes';

// The helpers replace Buffer so the examples also run in a browser; they must agree with it.
describe('bytes without Buffer', () => {
  const texts = ['', 'a', 'ab', 'abc', 'hello world', 'こんにちは', '😀 emoji', 'tab\there\nnewline', 'é', 'a\ud800b', 'x\udc00', '\ud83d'];

  it('counts UTF-8 bytes like Buffer.byteLength', () => {
    for (const t of texts) assert.strictEqual(utf8Length(t), Buffer.byteLength(t), t);
  });

  it('finds where a number of bytes ends in the text, as Buffer cuts it, and none inside a character', () => {
    for (const t of texts) {
      for (let n = 0; n <= Buffer.byteLength(t) + 1; n++) {
        const at = utf8Offset(t, n);
        const cut = Buffer.from(t).subarray(0, n);
        const whole = Buffer.from(t.slice(0, at ?? 0)).equals(cut);
        assert.ok(at === undefined ? !Buffer.from(cut.toString()).equals(cut) || cut.toString().endsWith('\ufffd') : whole, `${t} ${n}`);
      }
    }
    assert.deepStrictEqual([isAscii('abc\t'), isAscii('aé')], [true, false]);
    assert.strictEqual(utf8Bytes('é'), '\u00c3\u00a9');
  });

  it('encodes base64 like Buffer', () => {
    for (const t of texts) assert.strictEqual(base64Encode(t), Buffer.from(t, 'utf8').toString('base64'), t);
  });

  it('decodes base64 like Buffer, including sloppy input', () => {
    const inputs = [...texts.map((t) => Buffer.from(t).toString('base64')), 'aGVsbG8', 'aGVsbG8=', 'aGVs bG8=', 'aGVsbG8-_w', 'YQ==YQ==', '!!!', 'a', '/w==', '4pyT'];
    for (const b of inputs) assert.strictEqual(base64Decode(b), Buffer.from(b, 'base64').toString('utf8'), b);
  });
});

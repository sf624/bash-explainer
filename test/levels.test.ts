import * as assert from 'assert';
import { COLOURED, failsCheck, FADED, LEADING_MARK, LEVEL_ORDER, levelCounts, LEVELS, problemLevel, SEVERITIES, severityOf } from '../src/levels';

// The level table (src/levels.ts): what each output shows of a level comes from it (docs/design/note-levels.md).
describe('the level table', () => {
  it('orders the levels, and gives each its own mark, class and rank', () => {
    assert.deepStrictEqual(LEVEL_ORDER, ['error', 'warning', 'info', 'note']);
    assert.deepStrictEqual(COLOURED, ['error', 'warning', 'info']);
    for (const key of ['mark', 'rank'] as const) assert.strictEqual(new Set(LEVEL_ORDER.map((l) => LEVELS[l][key])).size, LEVEL_ORDER.length, key);
    // (Until step 1b of three-levels.md, an error looks like a warning in the views: its icon, class and colour.)
    for (const key of ['codicon', 'className', 'colour'] as const) assert.strictEqual(LEVELS.error[key], LEVELS.warning[key], key);
  });

  it('maps each severity in every protocol, and a problem to the look of its level', () => {
    assert.deepStrictEqual(Object.fromEntries(Object.entries(SEVERITIES).map(([s, m]) => [s, [m.vscode, m.lsp, m.sarif, m.github, m.codemirror]])), {
      error: [0, 1, 'error', 'error', 'error'],
      warning: [1, 2, 'warning', 'warning', 'warning'],
      info: [2, 3, 'note', 'notice', 'info'],
      hint: [3, 4, 'note', 'notice', 'hint'],
    });
    assert.strictEqual(SEVERITIES[FADED].faded, true);
    assert.deepStrictEqual(LEVEL_ORDER.map(severityOf), ['error', 'warning', 'info', 'info']);
    assert.strictEqual(problemLevel('warning'), LEVELS.warning);
    assert.strictEqual(problemLevel(FADED), LEVELS.note);
  });

  it('fails --check on an error, on a warning only with --strict, never on an info', () => {
    assert.deepStrictEqual([failsCheck('error', false), failsCheck('warning', false), failsCheck('warning', true), failsCheck('info', true), failsCheck(FADED, true)], [true, false, true, false, false]);
  });

  it('counts the levels the screen reader\'s summary says', () => {
    assert.deepStrictEqual(levelCounts(['note', 'warning', 'info', 'warning'], 'en'), ['2 warnings']);
    assert.deepStrictEqual(levelCounts(['warning', 'error'], 'en'), ['1 error', '1 warning']);
    assert.deepStrictEqual(levelCounts(['error', 'error', 'warning'], 'ja'), ['エラー 2 件', '警告 1 件']);
    assert.deepStrictEqual(levelCounts(['warning'], 'en'), ['1 warning']);
    assert.deepStrictEqual(levelCounts(['warning', 'warning'], 'ja'), ['警告 2 件']);
    assert.deepStrictEqual(levelCounts(['info', 'note'], 'en'), []);
  });

  it('finds the mark a message starts with', () => {
    assert.deepStrictEqual(['ⓧ e', '⚠ a', 'ⓘ b', 'ℹ️ c', 'd ⚠'].map((m) => m.replace(LEADING_MARK, '')), ['e', 'a', 'b', 'c', 'd ⚠']);
  });
});

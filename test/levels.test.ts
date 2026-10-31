import * as assert from 'assert';
import { alwaysFails, COLOURED, failsCheck, FADED, LEADING_MARK, LEVEL_ORDER, levelCounts, LEVELS, levelTally, problemLevel, problemLevels, SEVERITIES, severityOf } from '../src/levels';

// The level table (src/levels.ts): what each output shows of a level comes from it (docs/design/note-levels.md).
describe('the level table', () => {
  it('orders the levels, and gives each its own mark, class and rank', () => {
    assert.deepStrictEqual(LEVEL_ORDER, ['error', 'warning', 'info', 'note']);
    assert.deepStrictEqual(COLOURED, ['error', 'warning', 'info']);
    for (const key of ['mark', 'rank', 'className'] as const) assert.strictEqual(new Set(LEVEL_ORDER.map((l) => LEVELS[l][key])).size, LEVEL_ORDER.length, key);
    // (Each level of a problem has its own icon, colour and colour name, in every theme kind; a plain note has the info icon, muted.)
    assert.deepStrictEqual(LEVEL_ORDER.map((l) => LEVELS[l].codicon), ['error', 'warning', 'info', 'info']);
    for (const key of ['variable', 'name', 'fallback', 'dark'] as const) assert.strictEqual(new Set(COLOURED.map((l) => LEVELS[l].colour![key])).size, COLOURED.length, key);
    assert.deepStrictEqual(Object.keys(LEVELS.error.colour!.ours).sort(), ['dark', 'highContrast', 'highContrastLight', 'light']);
    // (With forced colours, an error's border is double, a warning's dashed, an info's solid as a plain note's.)
    assert.deepStrictEqual(LEVEL_ORDER.map((l) => LEVELS[l].forcedBorder?.split(' ')[1]), ['double', 'dashed', undefined, undefined]);
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
    // (A note fails every time where its problem fails without --strict: one fact, in `SEVERITIES`.)
    assert.deepStrictEqual(LEVEL_ORDER.filter(alwaysFails), ['error']);
  });

  it('counts the levels the screen reader\'s summary and the Problems strip say', () => {
    assert.deepStrictEqual(levelCounts(['note', 'warning', 'info', 'warning'], 'en'), ['2 warnings', '1 caveat']);
    assert.deepStrictEqual(levelCounts(['info', 'info', 'error'], 'ja'), ['エラー 1 件', '注意 2 件']);
    assert.deepStrictEqual(levelCounts(['info', 'info'], 'en'), ['2 caveats']);
    assert.deepStrictEqual(levelCounts(['warning', 'error'], 'en'), ['1 error', '1 warning']);
    assert.deepStrictEqual(levelCounts(['error', 'error'], 'en'), ['2 errors']);
    assert.deepStrictEqual(levelCounts(['error', 'error', 'warning'], 'ja'), ['エラー 2 件', '警告 1 件']);
    assert.deepStrictEqual(levelCounts(['warning'], 'en'), ['1 warning']);
    assert.deepStrictEqual(levelCounts(['warning', 'warning'], 'ja'), ['警告 2 件']);
    assert.deepStrictEqual(levelCounts(['info', 'note'], 'en'), ['1 caveat']);
    assert.deepStrictEqual(levelCounts(['note'], 'en'), []);
    // The strip's counts: each level with problems, in the levels' order, a problem's level from its severity.
    assert.deepStrictEqual(levelTally(problemLevels(['info', 'warning', 'info', 'error'])), [{ level: 'error', n: 1 }, { level: 'warning', n: 1 }, { level: 'info', n: 2 }]);
    assert.deepStrictEqual(levelTally([]), []);
  });

  it('finds the mark a message starts with', () => {
    assert.deepStrictEqual(['ⓧ e', '⚠ a', 'ⓘ b', 'ℹ️ c', 'd ⚠'].map((m) => m.replace(LEADING_MARK, '')), ['e', 'a', 'b', 'c', 'd ⚠']);
  });
});

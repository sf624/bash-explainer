import type { OptionSpec } from '../argv/spec';
import { tx } from '../i18n';

/**
 * The options of sudo 1.9 on Linux that sudo(8) does not list: `-a` and `-c` are BSD's. sudo still reads them, then prints
 * its usage and fails with status 1 (`refused`: the reading is refused).
 */
export const SUDO_BSD_OPTIONS: OptionSpec[] = [
  { names: ['-a', '--auth-type'], text: tx('認証の方式（BSD 版のみ。Linux の sudo は読んだあと、使い方を表示して終了ステータス 1 で失敗する）', 'authentication type (BSD builds only: sudo on Linux reads the option, then prints its usage and fails with status 1)'), value: { name: 'TYPE' }, refused: true },
  { names: ['-c', '--login-class'], text: tx('ログインクラス（BSD 版のみ。Linux の sudo は読んだあと、使い方を表示して終了ステータス 1 で失敗する）', 'login class (BSD builds only: sudo on Linux reads the option, then prints its usage and fails with status 1)'), value: { name: 'CLASS' }, refused: true },
];

/** Any other option: sudo says `invalid option` (`unrecognized option` for a long one), prints its usage, and fails. */
export const SUDO_UNKNOWN_OPTION = tx('sudo にないオプション: sudo は `invalid option`（長いオプションなら `unrecognized option`）と使い方を表示し、何も実行せずに終了ステータス 1 で失敗する',
  'an option sudo does not have: sudo says `invalid option` (`unrecognized option` for a long one), prints its usage, and fails with status 1, running nothing');

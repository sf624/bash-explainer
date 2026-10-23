import { rerun } from '../examples/rerun';
import { Lang } from '../i18n';
import { FromPanel } from './panelView';
import { quickReference } from './reference';

/** What the panel asks the page around it to compute (the VS Code panel and the web page both answer it). */
export type PanelQuestion = Extract<FromPanel, { type: 'rerun' | 'reference' }>;

/** Whether a message from the panel is a question, which `panelReply` answers. */
export function isPanelQuestion(m: FromPanel): m is PanelQuestion {
  return m.type === 'rerun' || m.type === 'reference';
}

/** The reply to a question: the result of a worked example run on the user's input, or the quick reference. */
export function panelReply(m: PanelQuestion, lang: Lang) {
  if (m.type === 'rerun') {
    // The user edited the input of a worked example: run it again.
    return { type: 'rerunResult' as const, id: m.id, result: rerun(m.spec, m.input.replace(/\n$/, '').split('\n'), lang) };
  }
  return { type: 'reference' as const, entries: quickReference(lang) };
}

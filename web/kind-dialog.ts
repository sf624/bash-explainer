// The questions the page asks before it replaces the user's text: when the file kind changes while the editor holds
// the user's own text (replace it with the new kind's sample, or keep it), and when a file is opened over changes not
// saved. A modal <dialog> (role=alertdialog): the browser keeps the focus inside while it is open, Esc answers no, and
// the focus goes back to where it was.

/** A button of the question: its id and its text. */
interface Choice { id: string; text: string }

/** A question, in the page's language: `id` names its dialog (`kind-dialog`), `confirm` changes the text, `cancel` keeps it. */
export interface Question {
  id: string;
  title: string;
  message: string;
  confirm: Choice;
  cancel: Choice;
}

/** The texts of the question after a change of the file kind. */
export interface KindQuestion {
  title: string;
  message: string;
  replace: string;
  keep: string;
}

const dialogs = new Map<string, HTMLDialogElement>();

function dialogFor(id: string): HTMLDialogElement {
  const known = dialogs.get(id);
  if (known) return known;
  const dialog = document.createElement('dialog');
  dialog.id = `${id}-dialog`;
  dialog.className = 'ask';
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', `${id}-dialog-title`);
  dialog.setAttribute('aria-describedby', `${id}-dialog-message`);
  // Tab goes round the two buttons: the browser's modal dialog would let it leave for the address bar.
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const buttons = [...dialog.querySelectorAll('button')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    buttons[(at + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
  });
  document.body.append(dialog);
  dialogs.set(id, dialog);
  return dialog;
}

/** Asks the question; resolves true for `confirm`, false for `cancel` (and Esc). The choice that changes nothing has the focus first. */
export function ask(q: Question, returnFocus: HTMLElement | null, home?: () => void): Promise<boolean> {
  const d = dialogFor(q.id);
  const title = document.createElement('h2');
  title.id = `${q.id}-dialog-title`;
  title.textContent = q.title;
  const message = document.createElement('p');
  message.id = `${q.id}-dialog-message`;
  message.textContent = q.message;
  const button = (c: Choice, value: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = c.id;
    b.textContent = c.text;
    b.addEventListener('click', () => d.close(value));
    return b;
  };
  const confirm = button(q.confirm, 'confirm');
  confirm.className = 'ask-confirm';
  const cancel = button(q.cancel, 'cancel');
  const actions = document.createElement('div');
  actions.className = 'ask-actions';
  actions.append(cancel, confirm);
  d.replaceChildren(title, message, actions);
  d.returnValue = '';
  return new Promise((resolve) => {
    // Esc closes the dialog with no value: the text is kept.
    d.addEventListener('close', () => {
      resolve(d.returnValue === 'confirm');
      // (Where it was, when that is still there and shown; else where the page keeps its focus: `home`.)
      if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus();
      else home?.();
    }, { once: true });
    d.showModal();
    cancel.focus();
  });
}

/** Asks whether to replace the text with the sample; resolves true for "replace", false for "keep" (and Esc). The sample can be undone anyway. */
export function askReplaceWithSample(q: KindQuestion, returnFocus: HTMLElement | null, home?: () => void): Promise<boolean> {
  return ask({ id: 'kind', title: q.title, message: q.message, confirm: { id: 'kind-replace', text: q.replace }, cancel: { id: 'kind-keep', text: q.keep } }, returnFocus, home);
}

// The question the page asks when the file kind changes while the editor holds the user's own text:
// replace it with the new kind's sample, or keep it. A modal <dialog> (role=alertdialog): the browser keeps the
// focus inside while it is open, Esc keeps the text, and the focus goes back to where it was.

/** The texts of the question, in the page's language. */
export interface KindQuestion {
  title: string;
  message: string;
  replace: string;
  keep: string;
}

let dialog: HTMLDialogElement | undefined;

/** Asks whether to replace the text with the sample; resolves true for "replace", false for "keep" (and Esc). */
export function askReplaceWithSample(q: KindQuestion, returnFocus: HTMLElement | null): Promise<boolean> {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'kind-dialog';
    dialog.className = 'ask';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'kind-dialog-title');
    dialog.setAttribute('aria-describedby', 'kind-dialog-message');
    // Tab goes round the two buttons: the browser's modal dialog would let it leave for the address bar.
    dialog.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const buttons = [...dialog!.querySelectorAll('button')];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      buttons[(at + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
    });
    document.body.append(dialog);
  }
  const d = dialog;
  const title = document.createElement('h2');
  title.id = 'kind-dialog-title';
  title.textContent = q.title;
  const message = document.createElement('p');
  message.id = 'kind-dialog-message';
  message.textContent = q.message;
  const button = (id: string, text: string, value: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.textContent = text;
    b.addEventListener('click', () => d.close(value));
    return b;
  };
  const replace = button('kind-replace', q.replace, 'replace');
  const keep = button('kind-keep', q.keep, 'keep');
  const actions = document.createElement('div');
  actions.className = 'ask-actions';
  actions.append(keep, replace);
  d.replaceChildren(title, message, actions);
  d.returnValue = '';
  return new Promise((resolve) => {
    // Esc closes the dialog with no value: the text is kept.
    d.addEventListener('close', () => {
      resolve(d.returnValue === 'replace');
      if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus();
    }, { once: true });
    d.showModal();
    // The choice that changes nothing has the focus first; the sample can be undone anyway.
    keep.focus();
  });
}

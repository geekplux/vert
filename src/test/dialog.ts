/**
 * jsdom has `<dialog>` but none of its methods. This stand-in does what a browser does for a modal
 * dialog in the parts tests rely on: `showModal()` opens it, `close()` closes it and fires `close`,
 * and Esc closes the open modal (browsers fire `cancel`, then `close`). Focus handling is left to
 * the component; in a real browser it is checked with Playwright.
 *
 * Returns a function that removes the stand-in.
 */
export function installDialogPolyfill(): () => void {
  const proto = HTMLDialogElement.prototype;
  const original = {
    showModal: Object.getOwnPropertyDescriptor(proto, 'showModal'),
    close: Object.getOwnPropertyDescriptor(proto, 'close'),
  };
  const modals = new Set<HTMLDialogElement>();

  function close(this: HTMLDialogElement) {
    if (!this.open) return;
    this.removeAttribute('open');
    modals.delete(this);
    this.dispatchEvent(new Event('close'));
  }

  function showModal(this: HTMLDialogElement) {
    if (this.open) return;
    this.setAttribute('open', '');
    modals.add(this);
  }

  Object.defineProperty(proto, 'showModal', { configurable: true, value: showModal });
  Object.defineProperty(proto, 'close', { configurable: true, value: close });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    const top = [...modals].at(-1);
    if (!top) return;
    if (top.dispatchEvent(new Event('cancel', { cancelable: true }))) close.call(top);
  };
  document.addEventListener('keydown', onKeyDown);

  return () => {
    document.removeEventListener('keydown', onKeyDown);
    for (const [name, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(proto, name, descriptor);
      else Reflect.deleteProperty(proto, name);
    }
  };
}

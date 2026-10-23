// Copy text to the clipboard from a button click.
//
// Browsers only offer navigator.clipboard on secure pages (HTTPS or localhost).
// WG Manager is usually opened as plain http://server:7501 on the LAN, where it
// does not exist, so fall back to selecting a hidden textarea and
// document.execCommand('copy'), which browsers still allow inside a click.
// Resolves to true when the text was copied.
export async function copyText(text) {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the older way
    }
  }
  const previous = document.activeElement;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  Object.assign(area.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', opacity: '0' });
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  if (previous instanceof HTMLElement) previous.focus();
  return ok;
}

export const COPY_FAILED = "This browser didn't allow copying. Select the text and press Ctrl+C (or Cmd+C).";

// Serialized into an isolated browser guest; no Node privileges.
function installSession(token: string) {
  const host = window as any;
  host.__runwaySessionStop?.();
  let pending: { selector: string; text: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let extracting = false;
  const emit = (step: unknown) => console.log('__SESSION__:' + JSON.stringify({ token, step }));
  function unique(selector: string, element: Element) {
    try { const matches = document.querySelectorAll(selector); return matches.length === 1 && matches[0] === element; } catch { return false; }
  }
  function selectorFor(element: Element) {
    const parts: string[] = [];
    let current: Element | null = element;
    while (current) {
      let part = current.localName;
      for (const attribute of ['data-testid', 'name', 'aria-label', 'data-attrid']) {
        const value = current.getAttribute(attribute);
        if (value) {
          const candidate = part + '[' + attribute + '=' + CSS.escape(value) + ']';
          if (unique(candidate, current)) return [candidate, ...parts].join(' > ');
        }
      }
      if (current.id && unique('#' + CSS.escape(current.id), current)) return ['#' + CSS.escape(current.id), ...parts].join(' > ');
      const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(child => child.localName === current!.localName) : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }
  function flush() {
    clearTimeout(timer);
    if (pending) { emit({ activityId: 'type-into', properties: { ...pending, clearBefore: true, delay: 50 } }); pending = null; }
  }
  function input(event: Event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    if (target instanceof HTMLInputElement && (target.type === 'password' || target.type === 'file')) return;
    const selector = selectorFor(target);
    if (pending?.selector !== selector) flush();
    pending = { selector, text: target.value };
    clearTimeout(timer); timer = setTimeout(flush, 350);
  }
  function click(event: MouseEvent) {
    if (!(event.target instanceof Element)) return;
    flush();
    if (extracting) {
      event.preventDefault(); event.stopImmediatePropagation(); extracting = false;
      emit({ activityId: 'get-text', properties: { selector: selectorFor(event.target), trim: true, timeout: 30000 }, preview: (event.target.textContent || '').trim() });
      return;
    }
    const element = event.target.closest('a,button,input,textarea,select,[role=button]') || event.target;
    // Input focus is implicit in Type Into; recording it adds unstable redundant clicks.
    if (element.matches('input,textarea,select')) return;
    emit({ activityId: 'click', properties: { selector: selectorFor(element), clickType: 'Left', timeout: 30000 } });
  }
  function keydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'Escape' && extracting) { extracting = false; return; }
    if (event.key !== 'Enter' && event.key !== 'Tab') return;
    flush();
    emit({ activityId: 'send-hotkey', properties: { key: event.key, selector: event.target instanceof Element ? selectorFor(event.target) : '' } });
  }
  function stop() {
    flush();
    document.removeEventListener('input', input, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('keydown', keydown, true);
    window.removeEventListener('pagehide', flush);
    delete host.__runwaySessionStop; delete host.__runwaySessionExtract;
  }
  host.__runwaySessionStop = stop;
  host.__runwaySessionExtract = () => { flush(); extracting = true; };
  document.addEventListener('input', input, true);
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', keydown, true);
  window.addEventListener('pagehide', flush);
}
export const sessionScript = (token: string) => `(${installSession.toString()})(${JSON.stringify(token)})`;
export const stopSessionScript = 'window.__runwaySessionStop?.()';
export const extractSessionScript = 'window.__runwaySessionExtract?.()';

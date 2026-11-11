// Self-contained: serialized and executed in the guest page, without Node access.
function installRecorder(token: string) {
  const host = window as typeof window & { __runwayRecorderStop?: () => void };
  host.__runwayRecorderStop?.();
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;outline:3px solid #FF6B35;display:none;';
  document.documentElement.appendChild(overlay);

  const unique = (selector: string, element: Element) => {
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === element;
    } catch { return false; }
  };
  function selectorFor(element: Element): string {
    const parts: string[] = [];
    let current: Element | null = element;
    while (current) {
      let part = current.localName;
      if (current.id) {
        const id = '#' + CSS.escape(current.id);
        if (unique(id, current)) {
          parts.unshift(id);
          return parts.join(' > ');
        }
      }
      for (const attribute of ['data-testid', 'name', 'aria-label']) {
        const value = current.getAttribute(attribute);
        if (value) {
          const candidate = part + '[' + attribute + '=' + CSS.escape(value) + ']';
          if (unique(candidate, current)) {
            parts.unshift(candidate);
            return parts.join(' > ');
          }
        }
      }
      const siblings = current.parentElement
        ? Array.from(current.parentElement.children).filter(child => child.localName === current!.localName)
        : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }
  function stop() {
    document.removeEventListener('mouseover', hover, true);
    document.removeEventListener('click', pick, true);
    document.removeEventListener('keydown', keydown, true);
    overlay.remove();
    if (host.__runwayRecorderStop === stop) delete host.__runwayRecorderStop;
  }
  function hover(event: Event) {
    if (!(event.target instanceof Element)) return;
    const rect = event.target.getBoundingClientRect();
    Object.assign(overlay.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px', display: 'block' });
  }
  function pick(event: Event) {
    if (!(event.target instanceof Element)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const element = event.target;
    const selector = selectorFor(element);
    stop();
    console.log('__REC__:' + JSON.stringify({ token, selector, tag: element.localName, text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80) }));
  }
  function keydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stop();
    console.log('__REC__:' + JSON.stringify({ token, cancelled: true }));
  }
  host.__runwayRecorderStop = stop;
  document.addEventListener('mouseover', hover, true);
  document.addEventListener('click', pick, true);
  document.addEventListener('keydown', keydown, true);
}

export const stopRecorderScript = 'window.__runwayRecorderStop?.()';
export const recorderScript = (token: string) => `(${installRecorder.toString()})(${JSON.stringify(token)})`;

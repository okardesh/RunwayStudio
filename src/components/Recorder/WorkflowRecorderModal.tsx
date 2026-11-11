import { useEffect, useRef, useState } from 'react';
import { sessionScript, stopSessionScript, extractSessionScript } from './sessionScript';
import type { RecordedStep } from './workflowRecording';
import './RecorderModal.css';

export function WorkflowRecorderModal({ onSave, onClose }: { onSave: (steps: RecordedStep[], logOutputs: boolean) => Promise<void>; onClose: () => void }) {
  const webview = useRef<any>(null);
  const token = useRef<string | null>(null);
  const stepsRef = useRef<RecordedStep[]>([]);
  const ready = useRef(false);
  const attached = useRef(false);
  const [url, setUrl] = useState('https://www.google.com/');
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [steps, setSteps] = useState<RecordedStep[]>([]);
  const [variable, setVariable] = useState('usdTry');
  const variableRef = useRef(variable);
  variableRef.current = variable;
  const [logOutputs, setLogOutputs] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  function append(step: RecordedStep) {
    // Coalesce edits to the same input, retaining their position before Enter/click.
    const previous = stepsRef.current.at(-1);
    const next = previous?.activityId === 'type-into' && step.activityId === 'type-into' && previous.properties.selector === step.properties.selector
      ? [...stepsRef.current.slice(0, -1), step] : [...stepsRef.current, step];
    stepsRef.current = next; setSteps(next);
  }
  useEffect(() => {
    const guest = webview.current;
    let mounted = true;
    const install = () => {
      if (!token.current || !ready.current) return;
      void guest.executeJavaScript(sessionScript(token.current)).catch((cause: Error) => { if (mounted) setError('Could not record this page: ' + cause.message); });
    };
    const domReady = () => { ready.current = attached.current = true; setLoading(false); install(); };
    const start = (event: any) => { if (!event.isMainFrame || event.isInPlace) return; ready.current = false; setLoading(true); setExtracting(false); };
    const done = () => { if (!guest.isLoading()) setLoading(false); };
    const navigate = (event: any) => {
      if (!/^https?:/i.test(event.url)) return;
      setUrl(event.url);
      // Ordinary clicks/Enter already reproduce their navigation on playback.
      // Capture script/history-driven navigation which has no triggering action.
      const last = stepsRef.current.at(-1);
      if (token.current && (!last || last.activityId === 'get-text' || last.activityId === 'type-into')) append({ activityId: 'navigate-to', properties: { url: event.url, waitUntil: 'domcontentloaded' } });
    };
    const message = (event: any) => {
      if (!token.current || !event.message?.startsWith('__SESSION__:')) return;
      try {
        const data = JSON.parse(event.message.slice(12));
        if (data.token !== token.current) return;
        const step = data.step as RecordedStep;
        if (!['click', 'type-into', 'send-hotkey', 'get-text'].includes(step?.activityId) || typeof step.properties?.selector !== 'string' || !step.properties.selector) return;
        if (step.activityId === 'get-text') {
          step.properties.output = variableRef.current;
          setExtracting(false);
        }
        append(step);
      } catch { /* Unrelated guest console output. */ }
    };
    const fail = (event: any) => {
      if (event.isMainFrame === false || event.errorCode === -3) return;
      setError('Page could not be loaded: ' + event.errorDescription); setLoading(false);
    };
    const gone = () => { ready.current = false; token.current = null; setRecording(false); setLoading(false); setError('The page stopped responding. Reload it before resuming.'); };
    const events = { 'dom-ready': domReady, 'did-start-navigation': start, 'did-stop-loading': done, 'did-navigate': navigate, 'did-navigate-in-page': navigate, 'console-message': message, 'did-fail-load': fail, 'render-process-gone': gone };
    Object.entries(events).forEach(([name, handler]) => guest.addEventListener(name, handler));
    return () => {
      mounted = false;
      // React may already have detached the guest when passive cleanup runs.
      try { if (ready.current) void guest.executeJavaScript(stopSessionScript).catch(() => {}); } catch { /* Guest is already destroyed. */ }
      token.current = null; ready.current = attached.current = false;
      Object.entries(events).forEach(([name, handler]) => guest.removeEventListener(name, handler));
    };
  }, []);
  async function stop() {
    // Keep the token valid until pending input has been flushed from the guest.
    if (ready.current) await webview.current.executeJavaScript(stopSessionScript);
    // Electron console IPC may arrive after executeJavaScript resolves.
    await new Promise(resolve => setTimeout(resolve, 50));
    token.current = null; setRecording(false); setExtracting(false);
  }
  async function toggleRecord() {
    try {
      setError('');
      if (token.current) { await stop(); return; }
      token.current = crypto.randomUUID(); setRecording(true);
      const currentUrl = attached.current ? webview.current.getURL() : '';
      if (/^https?:/i.test(currentUrl) && !stepsRef.current.length) append({ activityId: 'navigate-to', properties: { url: currentUrl, waitUntil: 'domcontentloaded' } });
      if (ready.current) await webview.current.executeJavaScript(sessionScript(token.current));
    } catch (cause) { token.current = null; setRecording(false); setError(String(cause)); }
  }
  async function navigate() {
    try {
      const target = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url);
      if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Enter an HTTP or HTTPS address.');
      setError('');
      if (token.current) {
        if (ready.current) await webview.current.executeJavaScript(stopSessionScript);
        append({ activityId: 'navigate-to', properties: { url: target.href, waitUntil: 'domcontentloaded' } });
      }
      setLoading(true);
      if (!attached.current) webview.current.setAttribute('src', target.href);
      else await webview.current.loadURL(target.href);
    } catch (cause) { setError(String(cause)); setLoading(false); }
  }
  async function extract() {
    if (!/^[A-Za-z_]\w*$/.test(variable)) { setError('Enter a valid variable name first.'); return; }
    try { await webview.current.executeJavaScript(extractSessionScript); setExtracting(true); setError(''); } catch (cause) { setError(String(cause)); }
  }
  async function save() {
    setSaving(true); setError('');
    try { await stop(); await onSave(stepsRef.current, logOutputs); } catch (cause) { setError(String(cause)); } finally { setSaving(false); }
  }
  return <div className="rec-backdrop"><div className="rec-modal workflow-recorder">
    <div className="rec-header"><span className="rec-title">Workflow Recorder {recording ? '● Recording' : ''}</span><button className="rec-close" disabled={saving} onClick={onClose} aria-label="Close recorder">✕</button></div>
    <div className="rec-nav"><input aria-label="Page URL" className="rec-nav__url" value={url} onChange={event => setUrl(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void navigate(); }} /><button className="rec-nav__load" onClick={() => void navigate()}>Go</button><button className="rec-nav__record" disabled={saving} onClick={() => void toggleRecord()}>{recording ? 'Stop Recording' : 'Start Recording'}</button></div>
    <div className="rec-nav"><label>Output variable <input aria-label="Output variable" value={variable} onChange={event => setVariable(event.target.value)} /></label><button className="rec-nav__load" disabled={!recording || !ready.current || loading} onClick={() => void extract()}>Get Text → Variable</button><span>{extracting ? 'Click the result text to extract it.' : 'Browse and type normally while recording.'}</span></div>
    {error && <div role="alert" className="rec-error">{error}</div>}
    <div className="rec-viewport">{/* @ts-ignore Electron guest */}<webview ref={webview} src="about:blank" style={{ width: '100%', height: '100%' }} />{loading && <div className="rec-loading-bar" />}</div>
    <div className="session-steps" aria-label="Recorded steps"><strong>{steps.length} recorded steps</strong>{steps.map((step, index) => <div key={index}>{index + 1}. {step.activityId}: {String(step.properties.url ?? step.properties.text ?? step.properties.key ?? step.properties.output ?? step.properties.selector)}{step.preview ? ` = ${step.preview}` : ''}</div>)}</div>
    <div className="rec-result__actions session-footer"><label><input type="checkbox" checked={logOutputs} onChange={event => setLogOutputs(event.target.checked)} /> Log extracted variables</label><button className="rec-result__use" disabled={saving || !steps.length} onClick={() => void save()}>{saving ? 'Saving…' : 'Finish & Save Recording'}</button></div>
  </div></div>;
}

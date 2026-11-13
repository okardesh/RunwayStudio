import type { WorkflowNodeData } from '../../types';
import { useWorkflowStore } from '../../store/workflowStore';
import './BreakpointSettings.css';

export function BreakpointSettings({ nodeId, data }: { nodeId: string; data: WorkflowNodeData }) {
  const configure = useWorkflowStore((s) => s.configureBreakpoint);
  const invalidCount = data.breakpointHitCount !== undefined && (!Number.isSafeInteger(data.breakpointHitCount) || data.breakpointHitCount < 1);
  return <section className="pgrid-section breakpoint-settings" aria-label="Breakpoint settings">
    <div className="pgrid-section__hdr"><span className="pgrid-section__icon">●</span> Breakpoint</div>
    <div className="pgrid-section__body">
      <label className="pgrid-row"><span className="pgrid-row__label">Enabled</span><span className="pgrid-row__value"><input className="pgrid-checkbox" type="checkbox" aria-label="Enable breakpoint" checked={!!data.breakpoint} onChange={(e) => configure(nodeId, { breakpoint: e.target.checked })} /></span></label>
      <label className="pgrid-row"><span className="pgrid-row__label">Condition</span><span className="pgrid-row__value"><input className="pgrid-input" aria-label="Breakpoint condition" maxLength={200} placeholder='retryCount > 3' value={data.breakpointCondition ?? ''} onChange={(e) => configure(nodeId, { breakpointCondition: e.target.value })} /></span></label>
      <label className="pgrid-row"><span className="pgrid-row__label">Pause on hit</span><span className="pgrid-row__value"><input className="pgrid-input" aria-label="Breakpoint hit count" type="number" min={1} step={1} max={Number.MAX_SAFE_INTEGER} placeholder="Every visit" value={data.breakpointHitCount ?? ''} onChange={(e) => configure(nodeId, { breakpointHitCount: e.target.value === '' ? undefined : Number(e.target.value) })} /></span></label>
      {invalidCount && <p className="breakpoint-settings__error" role="alert">Use a positive whole number.</p>}
      <p className="breakpoint-settings__hint">Debug only. Use a Boolean variable or one comparison: ==, !=, &gt;, &gt;=, &lt;, &lt;=. Strings need double quotes. An empty condition always matches.</p>
      <p className="breakpoint-settings__hint">Hit count selects the exact enabled visit, counted before the condition. Empty means every visit. Counts reset on each Debug run. Step Into / Over can still pause independently.</p>
    </div>
  </section>;
}

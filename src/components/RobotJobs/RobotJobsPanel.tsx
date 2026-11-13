import { useEffect, useRef, useState } from 'react';
import type { RunwayConnection } from '../../engine/runwayConnection';
import { fetchRobotJobCatalog } from '../../engine/robotJobsClient';
import { argumentValue } from '../../shared/invokedWorkflows';
import { jobIsTerminal, type RobotJobCatalog } from '../../shared/robotJobs';
import { useRobotJobsStore, pollRobotJobs, stopRobotJob, robotJobHistoryId } from '../../store/robotJobsStore';
import { useUiStore } from '../../store/uiStore';
import './RobotJobsPanel.css';

export function RobotJobsMonitor({ connection }: { connection: RunwayConnection | null }) {
  useEffect(() => {
    if (!connection) return;
    void pollRobotJobs(connection);
    const timer = setInterval(() => void pollRobotJobs(connection), 1500);
    return () => clearInterval(timer);
  }, [connection]);
  return null;
}
export function RobotJobsPanel({ connection }: { connection: RunwayConnection | null }) {
  const { jobs, selectedId, launching, pending, pendingMeta, launch } = useRobotJobsStore();
  const [catalog, setCatalog] = useState<RobotJobCatalog>({ robots: [], packages: [] });
  const [robotId, setRobotId] = useState(''), [packageKey, setPackageKey] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [stopping, setStopping] = useState(false);
  const refreshId = useRef(0);
  const keyFor = (p: RobotJobCatalog['packages'][number]) => JSON.stringify([p.workflowId, p.version, p.packageId]);
  const pkg = catalog.packages.find(p => keyFor(p) === packageKey), robot = catalog.robots.find(r => r.id === robotId);
  const matching = jobs.filter(j => j.serverUrl === connection?.serverUrl && j.tenantId === connection?.organizationId);
  const job = matching.find(j => robotJobHistoryId(j) === selectedId) ?? matching[0];
  const refresh = async () => {
    if (!connection) return;
    const generation = ++refreshId.current; setLoading(true); setError('');
    try {
      const next = await fetchRobotJobCatalog(connection);
      if (generation !== refreshId.current) return;
      setCatalog(next);
      setRobotId(id => next.robots.some(r => r.id === id) ? id : next.robots.find(r => r.online)?.id ?? '');
      setPackageKey(key => next.packages.some(p => keyFor(p) === key) ? key : next.packages[0] ? keyFor(next.packages[0]) : '');
    } catch (reason) { if (generation === refreshId.current) { setCatalog({ robots: [], packages: [] }); setError(reason instanceof Error ? reason.message : 'Catalog unavailable.'); } }
    finally { if (generation === refreshId.current) setLoading(false); }
  };
  useEffect(() => { void refresh(); return () => { refreshId.current++; }; }, [connection]);
  useEffect(() => {
    setValues(Object.fromEntries((pkg?.inputArguments ?? []).map(a => [a.name, a.defaultValue === undefined || a.defaultValue === '' ? '' : typeof a.defaultValue === 'string' ? a.defaultValue : JSON.stringify(a.defaultValue)])));
  }, [packageKey]);
  const start = async (retry = false) => {
    if (!connection) return;
    setError('');
    try {
      if (retry && pending && pendingMeta) {
        if (pendingMeta.serverUrl !== connection.serverUrl || pendingMeta.tenant !== connection.organizationId) throw Error('Reconnect to the original server to recover this launch request.');
        await launch(connection, pending, pendingMeta.robot, pendingMeta.pkg);
      } else {
        if (!pkg || !robot?.online || pending) return;
        const inputs: Record<string, unknown> = Object.create(null);
        for (const arg of pkg.inputArguments) {
          const value = values[arg.name] ?? '';
          if (!value && !arg.required) continue;
          if (!value && arg.required && arg.type !== 'String') throw Error(`${arg.name} is required.`);
          try { inputs[arg.name] = argumentValue(value, arg.type, true); } catch { throw Error(`Enter a valid ${arg.type} for ${arg.name}.`); }
        }
        await launch(connection, { requestId: crypto.randomUUID(), robotId: robot.id, workflowId: pkg.workflowId, version: pkg.version, packageId: pkg.packageId, inputs }, robot, pkg);
        // Do not retain authored secrets in the form after dispatch.
        setValues({});
      }
      void pollRobotJobs(connection);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Launch failed.'); }
  };
  return <div className="robot-jobs">
    <header className="rj-toolbar"><div><strong>Robot Jobs</strong><small>Run a published package on a connected Robot</small></div><button disabled={!connection || loading || launching} onClick={() => void refresh()}>{loading ? 'Refreshing…' : 'Refresh catalog'}</button></header>
    {error && <div className="rj-notice rj-error" role="alert">{error}</div>}
    {!connection && <div className="rj-notice">Connect Studio to Runway to load Robots and published packages.</div>}
    <div className="rj-layout">
      <form className="rj-launch" aria-label="Launch Robot job" onSubmit={e => { e.preventDefault(); void start(); }}>
        <label>Robot<select aria-label="Robot" value={robotId} disabled={loading || launching || !!pending} onChange={e => setRobotId(e.target.value)}><option value="">Select a Robot</option>{catalog.robots.map(r => <option key={r.id} value={r.id} disabled={!r.online}>{r.name} · {r.online ? 'Online' : 'Offline'}</option>)}</select></label>
        <label>Package version<select aria-label="Package version" value={packageKey} disabled={loading || launching || !!pending} onChange={e => setPackageKey(e.target.value)}><option value="">Select a published version</option>{catalog.packages.map(p => <option key={keyFor(p)} value={keyFor(p)}>{p.name} · {p.version}</option>)}</select></label>
        {pkg && <small className="rj-package-id" title={pkg.packageId}>{pkg.packageId}</small>}
        {!loading && !catalog.packages.length && connection && !error && <p>No portable package versions are available. Prepare and publish a package first.</p>}
        <strong>In arguments</strong>
        {pkg?.inputArguments.length === 0 && <small>This package has no In arguments.</small>}
        {pkg?.inputArguments.map(a => <label key={a.name}>{a.name} <small>{a.type}{a.required ? ' · required' : ' · optional'}</small><input aria-label={`Input ${a.name}`} type={/password|secret|token|api.?key|credential/i.test(a.name) ? 'password' : 'text'} autoComplete="off" spellCheck={false} placeholder={['String','DateTime'].includes(a.type) ? a.type : 'JSON value'} value={values[a.name] ?? ''} disabled={launching || !!pending} onChange={e => setValues(v => ({ ...v, [a.name]: e.target.value }))} /></label>)}
        <button className="rj-primary" disabled={!connection || !robot?.online || !pkg || launching || loading || !!pending}>{launching ? 'Submitting…' : 'Start job'}</button>
        {pending && <div className="rj-notice">Launch confirmation is pending. Recover this request before starting another job.<button type="button" disabled={launching} onClick={() => void start(true)}>Recover launch</button></div>}
        <small>Uses the published version. Unsaved canvas changes are not included.</small>
      </form>
      <section className="rj-jobs" aria-label="Robot job results">
        <nav aria-label="Robot job list">{matching.map(j => <button key={robotJobHistoryId(j)} className={job === j ? 'rj-selected' : ''} onClick={() => useRobotJobsStore.setState({ selectedId: robotJobHistoryId(j) })}><strong>{j.workflowName} · {j.version}</strong><span>{j.robotName} · {j.status}</span><small>{new Date(j.startedAt).toLocaleString()}</small></button>)}</nav>
        {!job ? <div className="bp-empty">No Robot jobs yet. Choose a Robot and package version to start.</div> : <article className="rj-detail">
          <div className="rj-toolbar"><div><strong>{job.workflowName} · {job.version}</strong><span className={`rj-status rj-status--${job.status}`} role="status">{job.status}</span><small>{job.robotName} · {job.jobId}</small></div><div className="rj-actions"><button type="button" onClick={() => useUiStore.setState({ activeBottomPanelTab: 'history', selectedHistoryRunId: robotJobHistoryId(job) })}>View in Run History</button><button type="button" disabled={stopping || jobIsTerminal(job.status) || job.status === 'stopping'} onClick={async () => {
            if (!connection) return; setStopping(true); setError('');
            try { await stopRobotJob(connection, job); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Stop was not confirmed.'); } finally { setStopping(false); }
          }}>{stopping ? 'Requesting stop…' : 'Stop job'}</button></div></div>
          {job.connectionError && <div className="rj-notice" role="alert">Status unavailable · {job.connectionError} Last confirmed: {job.status}. Monitoring will retry.</div>}
          {job.status === 'stopping' && <div className="rj-notice">Waiting for the current activity to finish. No subsequent activity will start.</div>}
          <RobotJobDetails job={job} />
        </article>}
      </section>
    </div>
  </div>;
}
export function RobotJobDetails({ job }: { job: import('../../store/robotJobsStore').RemoteJob }) {
  return <><small className="rj-package-id">Package {job.version} · {job.packageId}</small>
    {job.error && <div className="rj-notice rj-error">{job.error}</div>}
    <details><summary>In / Out arguments</summary><pre>{JSON.stringify({ In: job.inputPreview, Out: job.outputs ?? {} }, null, 2)}</pre></details>
    {!!job.workflowCalls?.length && <details><summary>Workflow calls</summary>{job.workflowCalls.map((c, i) => <div key={i} style={{ paddingLeft: Math.min(c.depth, 16) * 12 }}>{c.name} · {c.status}</div>)}</details>}
    <div className="rj-log-heading"><strong>Job logs</strong><small>Latest 300 entries · sensitive fields masked</small></div>
    <div className="rj-logs" aria-label="Robot job logs">{!job.logs.length && <span>Waiting for Robot logs…</span>}{job.logs.map(l => <div key={l.sequence} className={l.level === 'error' ? 'rj-error' : ''}><time>{new Date(l.timestamp).toLocaleTimeString()}</time><span>{l.message}</span></div>)}</div>
  </>;
}

import { useRef, useState } from 'react';
import type { WorkflowNodeData } from '../../types';
import { useWorkflowStore } from '../../store/workflowStore';
import { loadInvokedWorkflow } from '../../engine/workflowLoader';
import { parseWorkflowDefinition, validateArguments, type LoadedWorkflow } from '../../shared/invokedWorkflows';
import './InvokeWorkflowSettings.css';

export function InvokeWorkflowSettings({ nodeId, data }: { nodeId: string; data: WorkflowNodeData }) {
  const filePath = useWorkflowStore((s) => s.filePath);
  const variables = useWorkflowStore((s) => s.variables);
  const args = useWorkflowStore((s) => s.arguments);
  const requested = String(data.properties.workflowFile ?? '');
  const key = JSON.stringify([nodeId, filePath, requested]);
  const currentKey = useRef(key); currentKey.current = key;
  const [loaded, setLoaded] = useState<{ key: string; workflow: LoadedWorkflow } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const definition = loaded?.key === key ? loaded.workflow.definition : null;
  const updateMapping = (direction: 'In' | 'Out', name: string, value?: string) => {
    const field = direction === 'In' ? 'inArguments' : 'outArguments';
    const current = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId); if (!current) return;
    const mapping = { ...current.data.properties[field] as Record<string, unknown> };
    if (value === undefined) delete mapping[name]; else mapping[name] = value;
    useWorkflowStore.getState().updateNodeProperties(nodeId, { ...current.data.properties, [field]: mapping });
  };
  const refresh = async () => {
    setLoading(true); setError(''); const forKey = key;
    try { const workflow = await loadInvokedWorkflow(requested, filePath); validateArguments(workflow.definition.arguments, workflow.definition.variables); if (currentKey.current === forKey) setLoaded({ key: forKey, workflow }); }
    catch (reason) { if (currentKey.current === forKey) { setLoaded(null); setError(reason instanceof Error ? reason.message : 'Could not read workflow arguments.'); } }
    finally { setLoading(false); }
  };
  const browse = async () => {
    const choose = (window as any).electronAPI?.chooseInvokedWorkflow;
    if (!choose) { setError('Choose a workflow in the Studio desktop app.'); return; }
    setLoading(true); setError(''); const forKey = key;
    try {
      const result = await choose(); if ('cancelled' in result || currentKey.current !== forKey) return;
      const definition = parseWorkflowDefinition(result.content); validateArguments(definition.arguments, definition.variables);
      const current = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId); if (!current) return;
      useWorkflowStore.getState().updateNodeProperties(nodeId, { ...current.data.properties, workflowFile: result.path });
      setLoaded({ key: JSON.stringify([nodeId, filePath, result.path]), workflow: { path: result.path, definition } });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not choose a workflow.'); } finally { setLoading(false); }
  };
  return <section className="pgrid-section invoke-settings" aria-label="Invoked workflow arguments"><div className="pgrid-section__hdr">{data.activityId === 'transaction-scope' ? 'Recovery Workflow · Arguments' : 'Invoke Workflow · Arguments'}</div><div className="invoke-settings__body">
    {data.activityId === 'transaction-scope' && <p>Optional: runs after an Application failure is committed. Map {`{{transactionError}}`} and your transaction to recovery In arguments. Business errors and Stop skip recovery. Recovery never repeats the processing body.</p>}
    <div className="invoke-settings__actions"><button disabled={loading} onClick={() => void browse()}>Browse workflow…</button><button disabled={loading || !requested.trim()} onClick={() => void refresh()}>{loading ? 'Reading…' : 'Import / refresh arguments'}</button></div>
    {error && <p className="invoke-settings__error" role="alert">{error}</p>}
    {!definition && <p>Choose a .rpa.json file, then import its In/Out arguments. Files are read without replacing or saving the current canvas.</p>}
    {definition && <><strong>{definition.projectName}</strong><p>{loaded!.workflow.path}</p>{!definition.arguments.length && <p>This workflow has no arguments.</p>}
      {definition.arguments.map((arg) => {
        const field = arg.direction === 'In' ? 'inArguments' : 'outArguments';
        const mapping = data.properties[field] as Record<string, unknown> | undefined;
        const raw = mapping?.[arg.name];
        const text = raw === undefined ? '' : typeof raw === 'string' ? raw : JSON.stringify(raw);
        return <label key={arg.name} className="invoke-settings__argument"><span>{arg.name}<small>{arg.direction} · {arg.type}{arg.required && arg.direction === 'In' ? ' · Required' : ''}</small></span><input aria-label={`${arg.direction} argument ${arg.name}`} value={text} list={arg.direction === 'Out' ? `invoke-vars-${nodeId}` : undefined} placeholder={arg.direction === 'In' ? arg.defaultValue || '{{callerVariable}} or literal' : 'Caller variable (optional)'} onChange={(e) => updateMapping(arg.direction, arg.name, e.target.value)} />{raw !== undefined && <button type="button" onClick={() => updateMapping(arg.direction, arg.name)}>{arg.direction === 'In' ? 'Use child default' : 'Ignore output'}</button>}</label>;
      })}<datalist id={`invoke-vars-${nodeId}`}>{[...variables, ...args].map((v) => <option key={v.id} value={v.name} />)}</datalist>
      <p>In: use {`{{variable}}`} to pass its typed value; other text is literal. Numbers, booleans and collections accept JSON. Out: enter a caller variable name. Each call uses isolated argument data.</p>
    </>}
  </div></section>;
}

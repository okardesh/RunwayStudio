import { useEffect, useRef, useState } from 'react';
import type { Edge, Node } from 'reactflow';
import type { WorkflowArgument, WorkflowNodeData, WorkflowVariable } from '../../types';
import { publishRpaWorkflow, type PublishedRpaWorkflow, type RpaWorkflowArgument } from '../../engine/rpaWorkflowClient';
import type { RunwayConnection } from '../../engine/runwayConnection';
import './PublishWorkflowModal.css';
import { useUiTargetStore } from '../../store/uiTargetStore';
import { buildPortablePackage, type PortableDefinition } from '../../shared/portableWorkflowPackage';
import { loadInvokedWorkflow } from '../../engine/workflowLoader';

type PublishState = 'idle' | 'preparing' | 'publishing' | 'published' | 'failed';

interface PublishWorkflowModalProps {
  connection: RunwayConnection;
  projectName: string;
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  variables: WorkflowVariable[];
  workflowArguments: WorkflowArgument[];
  filePath?: string | null;
  onClose: () => void;
}

export function PublishWorkflowModal({ connection, projectName, nodes, edges, variables, workflowArguments, filePath = null, onClose }: PublishWorkflowModalProps) {
  const [name, setName] = useState(projectName === 'New Workflow' ? '' : projectName);
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState('');
  const [state, setState] = useState<PublishState>('idle');
  const [error, setError] = useState('');
  const [published, setPublished] = useState<PublishedRpaWorkflow | null>(null);
  const targets = useUiTargetStore((s) => s.targets);
  const deletedTargetIds = useUiTargetStore((s) => s.deletedIds);
  const [prepared, setPrepared] = useState<{ definition: PortableDefinition; key: string } | null>(null);
  const operation = useRef(false);
  const key = JSON.stringify({ name: name.trim(), version: version.trim() || '1.0.0', projectName, nodes, edges, variables, workflowArguments, targets, deletedTargetIds, filePath });
  const currentKey = useRef(key); currentKey.current = key;
  const busy = state === 'publishing' || state === 'preparing';
  const stale = !!prepared && prepared.key !== key;

  useEffect(() => {
    setName(projectName === 'New Workflow' ? '' : projectName);
  }, [projectName]);

  const handlePrepare = async (publish: boolean) => {
    if (operation.current) return;
    const publishedArguments: RpaWorkflowArgument[] = workflowArguments.map((argument) => ({
      name: argument.name,
      type: argument.type,
      direction: argument.direction,
      ...(argument.direction === 'In' ? { required: argument.required } : {}),
    }));
    const inputArguments = publishedArguments.filter((argument) => argument.direction === 'In');
    const outputArguments = publishedArguments.filter((argument) => argument.direction === 'Out');
    if (!name.trim()) { setState('failed'); setError('Enter a workflow name before publishing.'); return; }

    if (publish && stale) { setState('failed'); setError('The workflow, version or UI targets changed. Prepare the package again before publishing.'); return; }
    operation.current = true;
    if (!publish) setPrepared(null);
    setState('preparing');
    setError('');
    try {
      const definition = publish && prepared ? prepared.definition : await buildPortablePackage({ projectName: name.trim(), nodes, edges, variables, arguments: workflowArguments }, filePath, targets, version.trim() || '1.0.0', loadInvokedWorkflow, deletedTargetIds);
      setPrepared({ definition, key });
      if (currentKey.current !== key) throw Error('The workflow changed while preparing. Prepare the package again.');
      if (!publish) { setState('idle'); return; }
      setState('publishing');
      const workflow = await publishRpaWorkflow(connection, {
        name: name.trim(),
        version: version.trim() || '1.0.0',
        description: description.trim(),
        inputArguments,
        outputArguments,
        definition: { ...definition },
      });
      setPublished(workflow);
      setVersion(workflow.version);
      setState('published');
    } catch (reason) {
      setState('failed');
      setError(reason instanceof Error ? reason.message : 'Could not publish the workflow.');
    } finally { operation.current = false; }
  };

  const download = () => {
    if (!prepared || stale) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(prepared.definition, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${name.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'workflow'}-${prepared.definition.portablePackage.version}.runway.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="publish-modal__backdrop" role="presentation" onMouseDown={busy ? undefined : onClose}>
      <section className="publish-modal" role="dialog" aria-modal="true" aria-labelledby="publish-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="publish-modal__header"><div><p>RUNWAY RPA CATALOG</p><h2 id="publish-title">Publish workflow</h2></div><button type="button" className="publish-modal__close" onClick={onClose} disabled={busy} aria-label="Close">x</button></header>
        <div className="publish-modal__body">
          <label>Workflow name<input value={name} onChange={(event) => setName(event.target.value)} disabled={busy} autoFocus /></label>
          <label>Version<input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.0.0" disabled={busy} /></label>
          <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} disabled={busy} /></label>
          <section className="publish-package" aria-label="Portable package"><strong>Portable workflow package</strong><p>The main workflow, called workflows and referenced UI targets travel together. Robot calls resolve inside the package.</p><div className="publish-package__actions"><button disabled={busy} onClick={() => void handlePrepare(false)}>{state === 'preparing' ? 'Preparing…' : prepared ? 'Refresh package' : 'Prepare package'}</button><button disabled={busy || !prepared || stale} onClick={download}>Download package</button></div>
            {stale && <p role="status">Package is out of date. Refresh it before publishing or downloading.</p>}
            {prepared && <><p>{prepared.definition.portablePackage.workflows.length} workflows · {prepared.definition.portablePackage.uiTargets.length} UI targets · version {prepared.definition.portablePackage.version}</p><code>{prepared.definition.portablePackage.id}</code><ul>{prepared.definition.portablePackage.workflows.map((file) => <li key={file.id}>{file.definition.projectName} · {file.definition.nodes.length} activities</li>)}</ul><small>This is a snapshot. Refresh to include subsequent edits to called files.</small></>}
          </section>
          {state === 'failed' && <p className="publish-modal__message publish-modal__message--error" role="alert">{error}</p>}
          {state === 'published' && published && <p className="publish-modal__message publish-modal__message--success">Published as {published.id}, version {published.version}.</p>}
        </div>
        <footer className="publish-modal__footer"><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="publish-modal__publish" onClick={() => void handlePrepare(true)} disabled={busy || stale}>{state === 'publishing' ? 'Publishing...' : state === 'preparing' ? 'Preparing...' : state === 'published' ? 'Publish again' : 'Publish'}</button></footer>
      </section>
    </div>
  );
}

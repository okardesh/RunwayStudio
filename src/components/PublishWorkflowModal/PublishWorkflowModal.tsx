import { useEffect, useState } from 'react';
import type { Edge, Node } from 'reactflow';
import type { WorkflowArgument, WorkflowNodeData, WorkflowVariable } from '../../types';
import { publishRpaWorkflow, type PublishedRpaWorkflow, type RpaWorkflowArgument } from '../../engine/rpaWorkflowClient';
import type { RunwayConnection } from '../../engine/runwayConnection';
import './PublishWorkflowModal.css';

type PublishState = 'idle' | 'publishing' | 'published' | 'failed';

interface PublishWorkflowModalProps {
  connection: RunwayConnection;
  projectName: string;
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  variables: WorkflowVariable[];
  workflowArguments: WorkflowArgument[];
  onClose: () => void;
}

export function PublishWorkflowModal({ connection, projectName, nodes, edges, variables, workflowArguments, onClose }: PublishWorkflowModalProps) {
  const [name, setName] = useState(projectName === 'New Workflow' ? '' : projectName);
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState('');
  const [state, setState] = useState<PublishState>('idle');
  const [error, setError] = useState('');
  const [published, setPublished] = useState<PublishedRpaWorkflow | null>(null);

  useEffect(() => {
    setName(projectName === 'New Workflow' ? '' : projectName);
  }, [projectName]);

  const handlePublish = async () => {
    if (state === 'publishing') return;
    const publishedArguments: RpaWorkflowArgument[] = workflowArguments.map((argument) => ({
      name: argument.name,
      type: argument.type,
      direction: argument.direction,
      ...(argument.direction === 'In' ? { required: argument.required } : {}),
    }));
    const inputArguments = publishedArguments.filter((argument) => argument.direction === 'In');
    const outputArguments = publishedArguments.filter((argument) => argument.direction === 'Out');
    if (!name.trim()) { setState('failed'); setError('Enter a workflow name before publishing.'); return; }

    setState('publishing');
    setError('');
    try {
      const workflow = await publishRpaWorkflow(connection, {
        name: name.trim(),
        version: version.trim() || '1.0.0',
        description: description.trim(),
        inputArguments,
        outputArguments,
        definition: { nodes, edges, variables, arguments: workflowArguments },
      });
      setPublished(workflow);
      setVersion(workflow.version);
      setState('published');
    } catch (reason) {
      setState('failed');
      setError(reason instanceof Error ? reason.message : 'Could not publish the workflow.');
    }
  };

  return (
    <div className="publish-modal__backdrop" role="presentation" onMouseDown={state === 'publishing' ? undefined : onClose}>
      <section className="publish-modal" role="dialog" aria-modal="true" aria-labelledby="publish-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="publish-modal__header"><div><p>RUNWAY RPA CATALOG</p><h2 id="publish-title">Publish workflow</h2></div><button type="button" className="publish-modal__close" onClick={onClose} disabled={state === 'publishing'} aria-label="Close">x</button></header>
        <div className="publish-modal__body">
          <label>Workflow name<input value={name} onChange={(event) => setName(event.target.value)} disabled={state === 'publishing'} autoFocus /></label>
          <label>Version<input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.0.0" disabled={state === 'publishing'} /></label>
          <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} disabled={state === 'publishing'} /></label>
          {state === 'failed' && <p className="publish-modal__message publish-modal__message--error" role="alert">{error}</p>}
          {state === 'published' && published && <p className="publish-modal__message publish-modal__message--success">Published as {published.id}, version {published.version}.</p>}
        </div>
        <footer className="publish-modal__footer"><button type="button" onClick={onClose} disabled={state === 'publishing'}>Cancel</button><button type="button" className="publish-modal__publish" onClick={() => void handlePublish()} disabled={state === 'publishing'}>{state === 'publishing' ? 'Publishing...' : state === 'published' ? 'Publish again' : 'Publish'}</button></footer>
      </section>
    </div>
  );
}
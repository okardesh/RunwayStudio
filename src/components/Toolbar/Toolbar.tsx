import { useCallback, useRef, useState } from 'react';
import { useWorkflowStore } from '../../store/workflowStore';
import { useUiStore } from '../../store/uiStore';
import { executeWorkflow, requestStop } from '../../engine/executor';
import './Toolbar.css';

export function Toolbar() {
  const { projectName, status, setProjectName, clearWorkflow } = useWorkflowStore();
  const { toggleOutputPanel, showOutputPanel, toggleRecorder } = useUiStore();
  const [editingName, setEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [debugMode, setDebugMode] = useState(false);

  const handleNameBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setProjectName(e.target.value.trim() || 'New Workflow');
    setEditingName(false);
  };

  const handleRun = useCallback(async () => {
    const store = useWorkflowStore.getState();
    if (!useUiStore.getState().showOutputPanel) useUiStore.getState().toggleOutputPanel();
    store.setStatus('running');
    const result = await executeWorkflow(
      store.nodes,
      store.edges,
      (id) => useWorkflowStore.getState().setExecutingNodeId(id),
      (_id) => {},
      (text, level) => useUiStore.getState().addOutputMessage({ text, level })
    );
    useWorkflowStore.getState().setExecutingNodeId(null);
    useWorkflowStore.getState().setStatus(
      result === 'completed' ? 'completed' : result === 'stopped' ? 'idle' : 'error'
    );
  }, []);

  const handleStop = useCallback(() => requestStop(), []);

  const handleSave = useCallback(() => {
    const { nodes, edges, variables, projectName: name } = useWorkflowStore.getState();
    const blob = new Blob(
      [JSON.stringify({ nodes, edges, variables, projectName: name }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/\s+/g, '_')}.rpa.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleLoad = useCallback(() => fileInputRef.current?.click(), []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      useWorkflowStore.getState().loadWorkflow(JSON.parse(await file.text()));
    } catch {
      alert('Invalid workflow file.');
    }
    e.target.value = '';
  }, []);

  const isRunning = status === 'running';

  return (
    <div className="ribbon">
      <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />

      <div className="ribbon__group">
        <div className="ribbon__btns">
          <button className="rbn-btn" onClick={clearWorkflow} title="New Workflow">
            <span className="rbn-btn__icon">📄</span>
            <span className="rbn-btn__label">New</span>
          </button>
          <button className="rbn-btn" onClick={handleSave} title="Save Workflow">
            <span className="rbn-btn__icon">💾</span>
            <span className="rbn-btn__label">Save</span>
          </button>
          <button className="rbn-btn" onClick={handleLoad} title="Open Workflow">
            <span className="rbn-btn__icon">📂</span>
            <span className="rbn-btn__label">Open</span>
          </button>
        </div>
        <span className="ribbon__group-label">File</span>
      </div>

      <div className="ribbon__sep" />

      <div className="ribbon__group">
        <div className="ribbon__btns">
          <button
            className={`rbn-btn rbn-btn--run${isRunning ? ' active' : ''}`}
            onClick={handleRun}
            disabled={isRunning}
            title="Run (F5)"
          >
            <span className="rbn-btn__icon rbn-btn__icon--lg">▶</span>
            <span className="rbn-btn__label">Run</span>
          </button>
          <button
            className="rbn-btn rbn-btn--stop"
            onClick={handleStop}
            disabled={!isRunning}
            title="Stop (Shift+F5)"
          >
            <span className="rbn-btn__icon rbn-btn__icon--lg">⏹</span>
            <span className="rbn-btn__label">Stop</span>
          </button>
          <button
            className={`rbn-btn rbn-btn--debug${debugMode ? ' active' : ''}`}
            onClick={() => setDebugMode(!debugMode)}
            disabled={isRunning}
            title="Debug"
          >
            <span className="rbn-btn__icon rbn-btn__icon--lg">🐞</span>
            <span className="rbn-btn__label">Debug</span>
          </button>
        </div>
        <span className="ribbon__group-label">Execute</span>
      </div>

      <div className="ribbon__sep" />

      <div className="ribbon__group">
        <div className="ribbon__btns">
          <button className="rbn-btn rbn-btn--accent" onClick={toggleRecorder} title="Record UI element">
            <span className="rbn-btn__icon rbn-btn__icon--lg">⏺</span>
            <span className="rbn-btn__label">Recording</span>
          </button>
          <button className="rbn-btn" disabled title="Screen Scraping">
            <span className="rbn-btn__icon">🖼️</span>
            <span className="rbn-btn__label">Screen<br/>Scraping</span>
          </button>
          <button className="rbn-btn" disabled title="Data Scraping">
            <span className="rbn-btn__icon">📊</span>
            <span className="rbn-btn__label">Data<br/>Scraping</span>
          </button>
        </div>
        <span className="ribbon__group-label">Wizards</span>
      </div>

      <div className="ribbon__sep" />

      <div className="ribbon__group">
        <div className="ribbon__btns">
          <button className="rbn-btn" disabled title="UI Explorer">
            <span className="rbn-btn__icon rbn-btn__icon--lg">🔍</span>
            <span className="rbn-btn__label">UI<br/>Explorer</span>
          </button>
          <button className="rbn-btn" disabled title="Remove Unused Variables">
            <span className="rbn-btn__icon">🧹</span>
            <span className="rbn-btn__label">Remove<br/>Unused</span>
          </button>
        </div>
        <span className="ribbon__group-label">Selectors</span>
      </div>

      <div className="ribbon__sep" />

      <div className="ribbon__group">
        <div className="ribbon__btns">
          <button className="rbn-btn" disabled title="Manage Variables">
            <span className="rbn-btn__icon rbn-btn__icon--lg">🔤</span>
            <span className="rbn-btn__label">Variables</span>
          </button>
          <button className="rbn-btn" disabled title="Manage Packages">
            <span className="rbn-btn__icon rbn-btn__icon--lg">📦</span>
            <span className="rbn-btn__label">Packages</span>
          </button>
        </div>
        <span className="ribbon__group-label">Dependencies</span>
      </div>

      <div className="ribbon__sep" />

      <div className="ribbon__group">
        <div className="ribbon__btns">
          <button
            className={`rbn-btn${showOutputPanel ? ' active' : ''}`}
            onClick={toggleOutputPanel}
            title="Toggle Output Panel"
          >
            <span className="rbn-btn__icon rbn-btn__icon--lg">📋</span>
            <span className="rbn-btn__label">Output</span>
          </button>
        </div>
        <span className="ribbon__group-label">View</span>
      </div>

      <div className="ribbon__spacer" />
      <div className="ribbon__project">
        {editingName ? (
          <input
            ref={nameInputRef}
            className="ribbon__project-input"
            defaultValue={projectName}
            onBlur={handleNameBlur}
            onKeyDown={(e) => e.key === 'Enter' && nameInputRef.current?.blur()}
            autoFocus
          />
        ) : (
          <button
            className="ribbon__project-name"
            onClick={() => { setEditingName(true); setTimeout(() => nameInputRef.current?.select(), 50); }}
            title="Click to rename"
          >
            {projectName}
          </button>
        )}
      </div>
    </div>
  );
}

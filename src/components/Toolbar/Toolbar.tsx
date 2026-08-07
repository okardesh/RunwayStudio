import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkflowStore } from '../../store/workflowStore';
import { useUiStore } from '../../store/uiStore';
import { executeWorkflow, requestStop, resumeDebug } from '../../engine/executor';
import { saveWorkflow, openWorkflow } from '../../engine/fileOps';
import './Toolbar.css';

interface ToolbarProps {
  activeTab: 'design' | 'debug';
}

export function Toolbar({ activeTab }: ToolbarProps) {
  const { projectName, status, setProjectName, clearWorkflow, nodes } = useWorkflowStore();
  const { toggleOutputPanel, showOutputPanel, toggleRecorder } = useUiStore();
  const [editingName, setEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const breakpointCount = nodes.filter((n) => n.data.breakpoint).length;

  const startRun = useCallback(async (debug: boolean) => {
    const store = useWorkflowStore.getState();
    if (!useUiStore.getState().showOutputPanel) useUiStore.getState().toggleOutputPanel();
    store.setStatus('running');
    const result = await executeWorkflow(
      store.nodes,
      store.edges,
      (id) => useWorkflowStore.getState().setExecutingNodeId(id),
      (_id) => {},
      (text, level) => useUiStore.getState().addOutputMessage({ text, level }),
      debug ? {
        debug: true,
        hasBreakpoint: (id) => !!useWorkflowStore.getState().nodes.find((n) => n.id === id)?.data.breakpoint,
        onPause: (id) => {
          useWorkflowStore.getState().setStatus('paused');
          const label = useWorkflowStore.getState().nodes.find((n) => n.id === id)?.data.label ?? id;
          useUiStore.getState().addOutputMessage({ text: `⏸  Paused at "${label}"`, level: 'Debug' });
        },
        onResume: () => useWorkflowStore.getState().setStatus('running'),
      } : undefined
    );
    useWorkflowStore.getState().setExecutingNodeId(null);
    useWorkflowStore.getState().setStatus(
      result === 'completed' ? 'completed' : result === 'stopped' ? 'idle' : 'error'
    );
  }, []);

  // Entering the Debug tab starts a debug run (pauses only at breakpoints);
  // leaving it stops whatever's in flight.
  const prevTab = useRef(activeTab);
  useEffect(() => {
    if (prevTab.current !== activeTab) {
      if (activeTab === 'debug') startRun(true);
      else requestStop();
    }
    prevTab.current = activeTab;
  }, [activeTab, startRun]);

  const handleNameBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setProjectName(e.target.value.trim() || 'New Workflow');
    setEditingName(false);
  };

  const handleRun = useCallback(() => startRun(false), [startRun]);
  const handleStop = useCallback(() => requestStop(), []);
  const handleContinue = useCallback(() => resumeDebug('continue'), []);
  const handleStepInto = useCallback(() => resumeDebug('step-into'), []);
  const handleStepOver = useCallback(() => resumeDebug('step-over'), []);
  const handleRestart = useCallback(() => { requestStop(); setTimeout(() => startRun(true), 60); }, [startRun]);

  const handleSave = useCallback(() => { saveWorkflow(); }, []);

  const handleLoad = useCallback(async () => {
    const handledNatively = await openWorkflow();
    if (!handledNatively) fileInputRef.current?.click();
  }, []);

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

      {activeTab === 'design' ? (
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
          </div>
          <span className="ribbon__group-label">Execute</span>
        </div>
      ) : (
        <>
          <div className="ribbon__group">
            <div className="ribbon__btns">
              <button
                className={`rbn-btn rbn-btn--run${isRunning ? ' active' : ''}`}
                onClick={handleContinue}
                disabled={!isPaused}
                title="Continue (F5)"
              >
                <span className="rbn-btn__icon rbn-btn__icon--lg">▶</span>
                <span className="rbn-btn__label">Continue</span>
              </button>
              <button
                className="rbn-btn rbn-btn--stop"
                onClick={handleStop}
                disabled={!isRunning && !isPaused}
                title="Stop (Shift+F5)"
              >
                <span className="rbn-btn__icon rbn-btn__icon--lg">⏹</span>
                <span className="rbn-btn__label">Stop</span>
              </button>
              <button className="rbn-btn" onClick={handleRestart} title="Restart debug run">
                <span className="rbn-btn__icon rbn-btn__icon--lg">↻</span>
                <span className="rbn-btn__label">Restart</span>
              </button>
            </div>
            <span className="ribbon__group-label">Execute</span>
          </div>

          <div className="ribbon__sep" />

          <div className="ribbon__group">
            <div className="ribbon__btns">
              <button
                className="rbn-btn rbn-btn--debug"
                onClick={handleStepInto}
                disabled={!isPaused}
                title="Step Into (F11) — descend into the next container's first activity"
              >
                <span className="rbn-btn__icon rbn-btn__icon--lg">⬇</span>
                <span className="rbn-btn__label">Step Into</span>
              </button>
              <button
                className="rbn-btn rbn-btn--debug"
                onClick={handleStepOver}
                disabled={!isPaused}
                title="Step Over (F10) — run the next activity (or whole container) as one step"
              >
                <span className="rbn-btn__icon rbn-btn__icon--lg">➡</span>
                <span className="rbn-btn__label">Step Over</span>
              </button>
            </div>
            <span className="ribbon__group-label">Step</span>
          </div>

          <div className="ribbon__sep" />

          <div className="ribbon__group">
            <div className="ribbon__btns">
              <div className="rbn-badge" title={`${breakpointCount} breakpoint${breakpointCount === 1 ? '' : 's'} set — click an activity's left edge to toggle one`}>
                <span className="rbn-badge__icon">⬤</span>
                <span className="rbn-badge__count">{breakpointCount}</span>
              </div>
            </div>
            <span className="ribbon__group-label">Breakpoints</span>
          </div>
        </>
      )}

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

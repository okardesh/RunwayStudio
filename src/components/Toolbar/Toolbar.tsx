import { useCallback, useRef, useState } from 'react';
import { useWorkflowStore } from '../../store/workflowStore';
import { useUiStore } from '../../store/uiStore';
import { executeWorkflow, isWorkflowExecuting, requestStop, resumeDebug } from '../../engine/executor';
import { useTestExplorerStore } from '../../store/testExplorerStore';
import { saveWorkflow, openWorkflow } from '../../engine/fileOps';
import './Toolbar.css';
import { Icon } from '../Icon';
import { createPortal } from 'react-dom';
import { WorkflowRecorderModal } from '../Recorder/WorkflowRecorderModal';
import { buildRecordedWorkflow } from '../Recorder/workflowRecording';
import { analyzeCurrentWorkflow } from '../../engine/analyzeCurrentWorkflow';

interface ToolbarProps {
  activeTab: 'design' | 'debug';
  onPublish: () => void;
}

export function Toolbar({ activeTab, onPublish }: ToolbarProps) {
  const { projectName, status, isDirty, setProjectName, clearWorkflow, nodes } = useWorkflowStore();
  const { activeBottomPanelTab, setActiveBottomPanelTab, setStatusMessage } = useUiStore();
  const [showRecorder, setShowRecorder] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const startingRef = useRef(false);
  const executionRef = useRef<Promise<'completed' | 'stopped' | 'error'> | null>(null);

  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const breakpointCount = nodes.filter((n) => n.data.breakpoint).length;

  const startRun = useCallback(async (debug: boolean) => {
    if (startingRef.current || executionRef.current) return;
    if (isWorkflowExecuting() || useTestExplorerStore.getState().active) {
      useUiStore.getState().setStatusMessage('Stop the current run before starting another workflow.');
      return;
    }
    startingRef.current = true;
    try {
      const store = useWorkflowStore.getState();
      const uiStore = useUiStore.getState();
      if (!await saveWorkflow()) {
        uiStore.setStatusMessage('Workflow was not run because it was not saved.');
        return;
      }
      uiStore.clearOutput();
      useUiStore.setState({ selectedHistoryRunId: null });
      uiStore.setActiveBottomPanelTab(debug ? 'debug' : 'output');
      store.setStatus('running');
      const execution = executeWorkflow(
        store.nodes,
        store.edges,
        store.variables,
        (id) => useWorkflowStore.getState().setExecutingNodeId(id),
        (_id) => {},
        (text, level) => useUiStore.getState().addOutputMessage({ text, level }),
        {
          projectName: store.projectName,
          arguments: store.arguments,
          filePath: useWorkflowStore.getState().filePath,
          debug,
          hasBreakpoint: (id) => !!useWorkflowStore.getState().nodes.find((n) => n.id === id)?.data.breakpoint,
          getBreakpoint: (id) => { const data = useWorkflowStore.getState().nodes.find((n) => n.id === id)?.data; return data ? { enabled: !!data.breakpoint, condition: data.breakpointCondition, hitCount: data.breakpointHitCount } : undefined; },
          onPause: (id, location) => {
            useUiStore.getState().setActiveBottomPanelTab('debug');
            useWorkflowStore.getState().setStatus('paused');
            const label = location?.activityName ?? useWorkflowStore.getState().nodes.find((n) => n.id === id)?.data.label ?? id;
            useUiStore.getState().addOutputMessage({ text: `⏸  Paused at "${label}"`, level: 'Debug' });
          },
          onResume: () => useWorkflowStore.getState().setStatus('running'),
        }
      );
      executionRef.current = execution;
      const result = await execution;
      useWorkflowStore.getState().setExecutingNodeId(null);
      useWorkflowStore.getState().setStatus(
        result === 'completed' ? 'completed' : result === 'stopped' ? 'idle' : 'error'
      );
      if (result === 'error' && !debug) uiStore.setActiveBottomPanelTab('history');
    } catch (error) {
      useUiStore.getState().setStatusMessage(error instanceof Error ? error.message : 'Workflow could not be started.');
    } finally {
      startingRef.current = false;
      executionRef.current = null;
    }
  }, []);

  const handleNameBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setProjectName(e.target.value.trim() || 'New Workflow');
    setEditingName(false);
  };

  const handleRun = useCallback(() => startRun(false), [startRun]);
  const handleDebug = useCallback(() => startRun(true), [startRun]);
  const handleStop = useCallback(() => requestStop(), []);
  const handleContinue = useCallback(() => resumeDebug('continue'), []);
  const handleStepInto = useCallback(() => resumeDebug('step-into'), []);
  const handleStepOver = useCallback(() => resumeDebug('step-over'), []);
  const handleRestart = useCallback(async () => { requestStop(); await executionRef.current; await startRun(true); }, [startRun]);

  const handleSave = useCallback(async () => {
    if (await saveWorkflow()) setStatusMessage('Workflow saved.');
  }, [setStatusMessage]);

  const handleNew = useCallback(() => {
    if (!window.confirm('Create a new workflow? Any unsaved changes will be discarded.')) return;
    clearWorkflow();
    setStatusMessage('New workflow created.');
  }, [clearWorkflow, setStatusMessage]);

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
      {showRecorder && createPortal(<WorkflowRecorderModal onClose={() => setShowRecorder(false)} onSave={async (steps, logOutputs) => {
        const before = useWorkflowStore.getState();
        const recorded = buildRecordedWorkflow(steps, before.variables, logOutputs);
        useWorkflowStore.setState({ nodes: [...before.nodes, ...recorded.nodes], variables: [...before.variables, ...recorded.variables], isDirty: true, selectedNodeId: recorded.nodes[0].id });
        try {
          if (!await saveWorkflow()) throw new Error("Recording was not saved. Choose a file to finish.");
          setShowRecorder(false);
          setStatusMessage("Recording saved. Run the workflow to see extracted variables in Output.");
        } catch (error) {
          useWorkflowStore.setState({ nodes: before.nodes, variables: before.variables, isDirty: before.isDirty, selectedNodeId: before.selectedNodeId });
          throw error;
        }
      }} />, document.body)}
      <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />

      <div className="ribbon__group">
        <div className="ribbon__btns">
          <button className="rbn-btn" onClick={handleNew} title="New Workflow (Ctrl+N)">
            <span className="rbn-btn__icon"><Icon name="file" /></span>
            <span className="rbn-btn__label">New</span>
          </button>
          <button className="rbn-btn" onClick={handleSave} disabled={!isDirty} title="Save Workflow (Ctrl+S)">
            <span className="rbn-btn__icon"><Icon name="save" /></span>
            <span className="rbn-btn__label">Save</span>
          </button>
          <button className="rbn-btn" onClick={handleLoad} title="Open Workflow">
            <span className="rbn-btn__icon"><Icon name="folder" /></span>
            <span className="rbn-btn__label">Open</span>
          </button>
        </div>
        <span className="ribbon__group-label">File</span>
      </div>

      <div className="ribbon__sep" />

      {activeTab === 'design' ? (
        <>
          <div className="ribbon__group">
            <div className="ribbon__btns">
              <button
                className={`rbn-btn rbn-btn--run${isRunning ? ' active' : ''}`}
                onClick={handleRun}
                disabled={isRunning}
                title="Run (F5)"
              >
                <span className="rbn-btn__icon rbn-btn__icon--lg"><Icon name="play" /></span>
                <span className="rbn-btn__label">Run</span>
              </button>
              <button className="rbn-btn" disabled={isRunning} onClick={() => setShowRecorder(true)} title="Record browser actions"><span className="rbn-btn__icon"><Icon name="record" /></span><span className="rbn-btn__label">Record</span></button>
              <button
                className="rbn-btn rbn-btn--stop"
                onClick={handleStop}
                disabled={!isRunning}
                title="Stop (Shift+F5)"
              >
                <span className="rbn-btn__icon rbn-btn__icon--lg"><Icon name="stop" /></span>
                <span className="rbn-btn__label">Stop</span>
              </button>
            </div>
            <span className="ribbon__group-label">Execute</span>
          </div>

          <div className="ribbon__sep" />

          <div className="ribbon__group">
            <div className="ribbon__btns">
              <button className="rbn-btn rbn-btn--publish" onClick={onPublish} disabled={isRunning} title="Publish to Runway RPA Catalog">
                <span className="rbn-btn__icon rbn-btn__icon--lg"><Icon name="upload" /></span>
                <span className="rbn-btn__label">Publish</span>
              </button>
            </div>
            <span className="ribbon__group-label">Runway</span>
          </div>
        </>
      ) : (
        <>
          <div className="ribbon__group">
            <div className="ribbon__btns">
              <button
                className={`rbn-btn rbn-btn--run${isRunning ? ' active' : ''}`}
                onClick={isPaused ? handleContinue : handleDebug}
                disabled={isRunning && !isPaused}
                title={isPaused ? 'Continue (F5)' : 'Debug workflow'}
              >
                <span className="rbn-btn__icon rbn-btn__icon--lg"><Icon name="play" /></span>
                <span className="rbn-btn__label">{isPaused ? 'Continue' : 'Debug'}</span>
              </button>
              <button
                className="rbn-btn rbn-btn--stop"
                onClick={handleStop}
                disabled={!isRunning && !isPaused}
                title="Stop (Shift+F5)"
              >
                <span className="rbn-btn__icon rbn-btn__icon--lg"><Icon name="stop" /></span>
                <span className="rbn-btn__label">Stop</span>
              </button>
              <button className="rbn-btn" onClick={handleRestart} title="Restart debug run">
                <span className="rbn-btn__icon rbn-btn__icon--lg"><Icon name="repeat" /></span>
                <span className="rbn-btn__label">Restart</span>
              </button>
            </div>
            <span className="ribbon__group-label">Execute</span>
          </div>

          <div className="ribbon__group">
            <div className="ribbon__btns">
              <button
                className="rbn-btn rbn-btn--debug"
                onClick={handleStepInto}
                disabled={!isPaused}
                title="Step Into (F11) — descend into the next container's first activity"
              >
                <span className="rbn-btn__icon rbn-btn__icon--lg"><Icon name="arrowDown" /></span>
                <span className="rbn-btn__label">Step Into</span>
              </button>
              <button
                className="rbn-btn rbn-btn--debug"
                onClick={handleStepOver}
                disabled={!isPaused}
                title="Step Over (F10) — run the next activity (or whole container) as one step"
              >
                <span className="rbn-btn__icon rbn-btn__icon--lg"><Icon name="arrowRight" /></span>
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
          <button
            className={`rbn-btn${activeBottomPanelTab === 'output' ? ' active' : ''}`}
            onClick={() => setActiveBottomPanelTab('output')}
            title="Show Output"
          >
            <span className="rbn-btn__icon rbn-btn__icon--lg"><Icon name="terminal" /></span>
            <span className="rbn-btn__label">Output</span>
          </button>
          <button className={`rbn-btn${activeBottomPanelTab === 'jobs' ? ' active' : ''}`} onClick={() => setActiveBottomPanelTab('jobs')} title="Show Robot Jobs"><Icon name="play" /><span className="rbn-btn__label">Jobs</span></button>
          <button className={`rbn-btn${activeBottomPanelTab === 'history' ? ' active' : ''}`} onClick={() => setActiveBottomPanelTab('history')} title="Show Run History"><Icon name="history" /><span className="rbn-btn__label">History</span></button>
          <button className={`rbn-btn${activeBottomPanelTab === 'explorer' ? ' active' : ''}`} onClick={() => { useUiStore.setState({ explorerTargetProperty: null }); setActiveBottomPanelTab('explorer'); }} title="Inspect application UI hierarchy"><Icon name="search" /><span className="rbn-btn__label">UI Explorer</span></button>
          <button className={`rbn-btn${activeBottomPanelTab === 'targets' ? ' active' : ''}`} onClick={() => setActiveBottomPanelTab('targets')} title="Show UI Targets"><Icon name="cursor" /><span className="rbn-btn__label">Targets</span></button>
          <button className={`rbn-btn${activeBottomPanelTab === 'errors' ? ' active' : ''}`} onClick={analyzeCurrentWorkflow} title="Analyze workflow (F8)"><Icon name="shield" /><span className="rbn-btn__label">Analyze</span></button>
          {activeTab === 'debug' && <button className={`rbn-btn${activeBottomPanelTab === 'debug' ? ' active' : ''}`} onClick={() => setActiveBottomPanelTab('debug')} title="Show Locals and Watch"><Icon name="code" /><span className="rbn-btn__label">Locals</span></button>}
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

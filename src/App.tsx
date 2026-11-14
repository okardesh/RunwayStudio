import { useEffect, useState } from 'react';
import { Toolbar } from './components/Toolbar/Toolbar';
import { ActivityPanel } from './components/ActivityPanel/ActivityPanel';
import { SequenceCanvas } from './components/SequenceCanvas/SequenceCanvas';
import { PropertiesPanel } from './components/PropertiesPanel/PropertiesPanel';
import { StatusBar } from './components/StatusBar/StatusBar';
import { AssetsMonitor, EnvironmentIndicator } from './components/Assets/AssetsPanel';
import { RobotJobsMonitor } from './components/RobotJobs/RobotJobsPanel';
import { BottomPanel } from './components/BottomPanel/BottomPanel';
import { useWorkflowStore } from './store/workflowStore';
import { useUiStore } from './store/uiStore';
import { saveWorkflow, openWorkflow } from './engine/fileOps';
import { ConnectionAssistant } from './components/ConnectionAssistant/ConnectionAssistant';
import { heartbeatRunwayLicense, releaseRunwayLicense, type RunwayConnection } from './engine/runwayConnection';
import { PublishWorkflowModal } from './components/PublishWorkflowModal/PublishWorkflowModal';
import './App.css';
import { Icon, RunwayMark } from './components/Icon';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { applyStudioTheme, useThemeStore } from './store/themeStore';
import { useUiTargetStore } from './store/uiTargetStore';
import { resolveTargetBindings } from './shared/uiTargets';
import { analyzeCurrentWorkflow } from './engine/analyzeCurrentWorkflow';

type Tab = 'design' | 'debug';

const isEditableTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

function App() {
  const theme = useThemeStore((s) => s.theme);
  useEffect(() => { applyStudioTheme(theme); }, [theme]);
  const [activeTab, setActiveTab] = useState<Tab>('design');
  const [runwayConnection, setRunwayConnection] = useState<RunwayConnection | null>(null);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const projectName = useWorkflowStore((s) => s.projectName);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const variables = useWorkflowStore((s) => s.variables);
  const workflowArguments = useWorkflowStore((s) => s.arguments);
  const filePath = useWorkflowStore((s) => s.filePath);
  const sharedTargets = useUiTargetStore((s) => s.targets);
  useEffect(() => {
    const current = useWorkflowStore.getState();
    const resolved = resolveTargetBindings(current.nodes, sharedTargets, false);
    if (resolved.some((node, index) => JSON.stringify(node.data.properties) !== JSON.stringify(current.nodes[index].data.properties))) {
      useWorkflowStore.setState({ nodes: resolved, isDirty: true });
    }
  }, [sharedTargets, nodes]);
  useEffect(() => {
    try { useUiTargetStore.getState().indexWorkflow(nodes, projectName, filePath); }
    catch (error) { useUiStore.getState().setStatusMessage(error instanceof Error ? error.message : 'Could not index UI targets.'); }
  }, [nodes, projectName, filePath]);
  const activitySearch = useUiStore((s) => s.activitySearchQuery);
  const setActivitySearch = useUiStore((s) => s.setActivitySearchQuery);

  // Toolbar reacts to activeTab itself (starts/stops the debug run) — this just switches views.
  const handleTabChange = (tab: Tab) => { setActiveTab(tab); if (tab === 'debug') useUiStore.getState().setActiveBottomPanelTab('debug'); };

  useEffect(() => {
    if (!runwayConnection) return;
    let active = true;
    const heartbeat = () => {
      void heartbeatRunwayLicense(runwayConnection).catch(() => {
        if (active) setRunwayConnection(null);
      });
    };
    const heartbeatTimer = window.setInterval(heartbeat, 120_000);
    const release = () => { void releaseRunwayLicense(runwayConnection); };
    window.addEventListener('beforeunload', release, { once: true });
    return () => {
      active = false;
      window.clearInterval(heartbeatTimer);
      window.removeEventListener('beforeunload', release);
    };
  }, [runwayConnection]);

  // File commands work from any part of the app; activity clipboard commands leave text fields alone.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F8' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) { e.preventDefault(); analyzeCurrentWorkflow(); return; }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const workflow = useWorkflowStore.getState();
      const ui = useUiStore.getState();

      if (key === 's') {
        e.preventDefault();
        if (workflow.isDirty) void saveWorkflow().then((saved) => { if (saved) ui.setStatusMessage('Workflow saved.'); });
        return;
      }
      if (key === 'o') { e.preventDefault(); openWorkflow(); return; }
      if (key === 'n') {
        e.preventDefault();
        if (window.confirm('Create a new workflow? Any unsaved changes will be discarded.')) {
          workflow.clearWorkflow();
          ui.setStatusMessage('New workflow created.');
        }
        return;
      }

      if (isEditableTarget(e.target)) return;
      if (key === 'c') { e.preventDefault(); workflow.copySelectedNode(); return; }
      if (key === 'x') { e.preventDefault(); workflow.cutSelectedNode(); return; }
      if (key === 'v') { e.preventDefault(); workflow.pasteNode(); return; }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!runwayConnection) {
    return <ConnectionAssistant onConnected={setRunwayConnection} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__brand">
          <RunwayMark /><span className="app-header__wordmark">Runway<span>Studio</span></span>
        </div>
        <button
          className={`app-header__tab${activeTab === 'design' ? ' app-header__tab--active' : ''}`}
          onClick={() => handleTabChange('design')}
        >
          Design
        </button>
        <button
          className={`app-header__tab${activeTab === 'debug' ? ' app-header__tab--active' : ''}`}
          onClick={() => handleTabChange('debug')}
        >
          Debug
        </button>
        <div className="app-header__search-wrap">
          <Icon name="search" size={16} /><input className="app-header__search" placeholder="Find an activity..." aria-label="Find an activity" type="search" value={activitySearch} onChange={(event) => setActivitySearch(event.target.value)} />
        </div>
        <div className="app-header__right">
          <ThemeSwitcher />
          <span className="app-header__connection"><span />Runway connected</span>
          <EnvironmentIndicator />
          <span className="app-header__project" title={projectName}><Icon name="folder" size={15} />{projectName}</span>
        </div>
      </header>

      <AssetsMonitor connection={runwayConnection} />
      <RobotJobsMonitor connection={runwayConnection} />
      <Toolbar activeTab={activeTab} onPublish={() => setShowPublishModal(true)} />

      <div className="app__body">
        <div className="app__workspace">
          <ActivityPanel />
          <SequenceCanvas />
          <PropertiesPanel />
        </div>
        <BottomPanel connection={runwayConnection} />
      </div>

      <StatusBar />

      {showPublishModal && <PublishWorkflowModal
        connection={runwayConnection}
        projectName={projectName}
        nodes={nodes}
        edges={edges}
        variables={variables}
        workflowArguments={workflowArguments}
        filePath={filePath}
        onClose={() => setShowPublishModal(false)}
      />}
    </div>
  );
}

export default App;


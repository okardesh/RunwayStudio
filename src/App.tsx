import { useEffect, useState } from 'react';
import { Toolbar } from './components/Toolbar/Toolbar';
import { ActivityPanel } from './components/ActivityPanel/ActivityPanel';
import { SequenceCanvas } from './components/SequenceCanvas/SequenceCanvas';
import { PropertiesPanel } from './components/PropertiesPanel/PropertiesPanel';
import { StatusBar } from './components/StatusBar/StatusBar';
import { BottomPanel } from './components/BottomPanel/BottomPanel';
import { useWorkflowStore } from './store/workflowStore';
import { useUiStore } from './store/uiStore';
import { saveWorkflow, openWorkflow } from './engine/fileOps';
import { ConnectionAssistant } from './components/ConnectionAssistant/ConnectionAssistant';
import { heartbeatRunwayLicense, releaseRunwayLicense, type RunwayConnection } from './engine/runwayConnection';
import { PublishWorkflowModal } from './components/PublishWorkflowModal/PublishWorkflowModal';
import './App.css';

type Tab = 'design' | 'debug';

const isEditableTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('design');
  const [runwayConnection, setRunwayConnection] = useState<RunwayConnection | null>(null);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const projectName = useWorkflowStore((s) => s.projectName);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const variables = useWorkflowStore((s) => s.variables);
  const workflowArguments = useWorkflowStore((s) => s.arguments);

  // Toolbar reacts to activeTab itself (starts/stops the debug run) — this just switches views.
  const handleTabChange = (tab: Tab) => setActiveTab(tab);

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
          <img className="app-header__logo" src="/logo.png" alt="Runway Studio" />
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
          <input className="app-header__search" placeholder="Search" type="text" />
        </div>
        <div className="app-header__right">
          <span className="app-header__project">{projectName}</span>
        </div>
      </header>

      <Toolbar activeTab={activeTab} onPublish={() => setShowPublishModal(true)} />

      <div className="app__body">
        <div className="app__workspace">
          <ActivityPanel />
          <SequenceCanvas />
          <PropertiesPanel />
        </div>
        <BottomPanel />
      </div>

      <StatusBar />

      {showPublishModal && <PublishWorkflowModal
        connection={runwayConnection}
        projectName={projectName}
        nodes={nodes}
        edges={edges}
        variables={variables}
        workflowArguments={workflowArguments}
        onClose={() => setShowPublishModal(false)}
      />}
    </div>
  );
}

export default App;


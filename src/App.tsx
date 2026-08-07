import { useEffect, useState } from 'react';
import { Toolbar } from './components/Toolbar/Toolbar';
import { ActivityPanel } from './components/ActivityPanel/ActivityPanel';
import { SequenceCanvas } from './components/SequenceCanvas/SequenceCanvas';
import { PropertiesPanel } from './components/PropertiesPanel/PropertiesPanel';
import { StatusBar } from './components/StatusBar/StatusBar';
import { BottomPanel } from './components/BottomPanel/BottomPanel';
import { useWorkflowStore } from './store/workflowStore';
import { saveWorkflow, openWorkflow } from './engine/fileOps';
import './App.css';

type Tab = 'design' | 'debug';

const isEditableTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('design');
  const projectName = useWorkflowStore((s) => s.projectName);

  // Toolbar reacts to activeTab itself (starts/stops the debug run) — this just switches views.
  const handleTabChange = (tab: Tab) => setActiveTab(tab);

  // Ctrl+S/O/N always act on the workflow (matches every desktop app's convention);
  // Ctrl+C/P only do so outside text fields, so normal text copy/paste still works.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();

      if (key === 's') { e.preventDefault(); saveWorkflow(); return; }
      if (key === 'o') { e.preventDefault(); openWorkflow(); return; }
      if (key === 'n') { e.preventDefault(); useWorkflowStore.getState().clearWorkflow(); return; }

      if (isEditableTarget(e.target)) return;
      if (key === 'c') { e.preventDefault(); useWorkflowStore.getState().copySelectedNode(); return; }
      if (key === 'p') { e.preventDefault(); useWorkflowStore.getState().pasteNode(); return; }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__icon">⚡</span>
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

      <Toolbar activeTab={activeTab} />

      <div className="app__body">
        <div className="app__workspace">
          <ActivityPanel />
          <SequenceCanvas />
          <PropertiesPanel />
        </div>
        <BottomPanel />
      </div>

      <StatusBar />
    </div>
  );
}

export default App;


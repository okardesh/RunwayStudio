import { useState } from 'react';
import { Toolbar } from './components/Toolbar/Toolbar';
import { ActivityPanel } from './components/ActivityPanel/ActivityPanel';
import { SequenceCanvas } from './components/SequenceCanvas/SequenceCanvas';
import { PropertiesPanel } from './components/PropertiesPanel/PropertiesPanel';
import { StatusBar } from './components/StatusBar/StatusBar';
import { BottomPanel } from './components/BottomPanel/BottomPanel';
import { useWorkflowStore } from './store/workflowStore';
import './App.css';

type Tab = 'design' | 'debug';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('design');
  const projectName = useWorkflowStore((s) => s.projectName);

  // Toolbar reacts to activeTab itself (starts/stops the debug run) — this just switches views.
  const handleTabChange = (tab: Tab) => setActiveTab(tab);

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


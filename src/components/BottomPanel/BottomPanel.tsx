import { useLayoutEffect, useRef, useState } from 'react';
import { useWorkflowStore } from '../../store/workflowStore';
import { useUiStore, type BottomPanelTab } from '../../store/uiStore';
import type { WorkflowVariable } from '../../types';
import './BottomPanel.css';

type SubTab = 'variables' | 'arguments' | 'namespaces' | 'connections';

const VAR_TYPES = [
  'String', 'Boolean', 'Char', 'Byte', 'SByte', 'Int16', 'Int32', 'Int64',
  'UInt16', 'UInt32', 'UInt64', 'Single', 'Double', 'Decimal', 'DateTime',
  'TimeSpan', 'Guid', 'Object', 'Array', 'List', 'Dictionary', 'DataTable',
  'List<String>', 'List<Int32>', 'List<Boolean>', 'List<Object>', 'String[]', 'Int32[]', 'Object[]',
];

const LEVEL_COLORS: Record<string, string> = {
  Info: '#0078D4', Warning: '#CA5010', Error: '#C50F1F', Debug: '#7A7A7A',
};

export function BottomPanel() {
  const [subTab, setSubTab] = useState<SubTab>('variables');
  const { variables, addVariable, removeVariable, updateVariable } = useWorkflowStore();
  const { outputMessages, clearOutput, activeBottomPanelTab: mainTab, setActiveBottomPanelTab } = useUiStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const outputEndRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (mainTab === 'output') outputEndRef.current?.scrollIntoView({ block: 'end' });
  }, [mainTab, outputMessages.length]);

  const handleCreateVar = () => {
    const name = `variable${variables.length + 1}`;
    addVariable({ name, type: 'String', defaultValue: '', scope: 'Main' });
  };

  const startEdit = (v: WorkflowVariable) => {
    setEditingId(v.id);
    setEditName(v.name);
  };

  const commitEdit = (v: WorkflowVariable) => {
    if (editName.trim()) updateVariable(v.id, { name: editName.trim() });
    setEditingId(null);
  };

  const mainTabs = [
    { id: 'dataManager' as BottomPanelTab, label: 'Data Manager' },
    { id: 'output' as BottomPanelTab, label: 'Output' },
    { id: 'markers' as BottomPanelTab, label: 'Markers' },
    { id: 'errors' as BottomPanelTab, label: 'Errors' },
  ];

  const subTabs = [
    { id: 'variables' as SubTab, label: '[x] Variables' },
    { id: 'arguments' as SubTab, label: '[+] Arguments' },
    { id: 'namespaces' as SubTab, label: '≡ Namespaces' },
    { id: 'connections' as SubTab, label: '⚙ Connections' },
  ];

  return (
    <div className="bottom-panel">
      <div className="bp__tab-row">
        <div className="bp__main-tabs">
          {mainTabs.map(({ id, label }) => (
            <button
              key={id}
              className={`bp__main-tab${mainTab === id ? ' bp__main-tab--active' : ''}`}
              onClick={() => setActiveBottomPanelTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {mainTab === 'dataManager' && (
          <div className="bp__sub-tabs">
            {subTabs.map(({ id, label }) => (
              <button
                key={id}
                className={`bp__sub-tab${subTab === id ? ' bp__sub-tab--active' : ''}`}
                onClick={() => setSubTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="bp__content">
        {mainTab === 'dataManager' && subTab === 'variables' && (
          <div className="bp-vars">
            <div className="bp-vars__table">
              <div className="bp-vars__head">
                <div className="bp-cell bp-cell--name">Name</div>
                <div className="bp-cell bp-cell--type">
                  <span style={{ opacity: 0.5, marginRight: 4, fontSize: 10 }}>🔍</span>Data Type
                </div>
                <div className="bp-cell bp-cell--scope">Scope</div>
                <div className="bp-cell bp-cell--ctrl" />
                <div className="bp-cell bp-cell--default">Default Value</div>
              </div>

              <div className="bp-vars__body">
                {variables.map((v: WorkflowVariable) => (
                  <div key={v.id} className="bp-vars__row">
                    <div className="bp-cell bp-cell--name">
                      {editingId === v.id ? (
                        <input
                          className="bp-cell__input"
                          value={editName}
                          autoFocus
                          onChange={(e) => setEditName(e.target.value)}
                          onBlur={() => commitEdit(v)}
                          onKeyDown={(e) => e.key === 'Enter' && commitEdit(v)}
                        />
                      ) : (
                        <span className="bp-cell__name" onDoubleClick={() => startEdit(v)}>{v.name}</span>
                      )}
                    </div>
                    <div className="bp-cell bp-cell--type">
                      <select
                        className="bp-cell__select"
                        value={v.type}
                        onChange={(e) => updateVariable(v.id, { type: e.target.value })}
                      >
                        {VAR_TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="bp-cell bp-cell--scope">{v.scope || 'Main'}</div>
                    <div className="bp-cell bp-cell--ctrl">
                      <button className="bp-del-btn" onClick={() => removeVariable(v.id)} title="Delete">✕</button>
                    </div>
                    <div className="bp-cell bp-cell--default">
                      <input
                        className="bp-cell__input"
                        value={v.defaultValue || ''}
                        placeholder="Enter a default value"
                        onChange={(e) => updateVariable(v.id, { defaultValue: e.target.value })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bp-vars__footer">
              <button className="bp-create-link" onClick={handleCreateVar}>
                Create variable
              </button>
            </div>
          </div>
        )}

        {mainTab === 'dataManager' && subTab !== 'variables' && (
          <div className="bp-empty">No {subTab} defined.</div>
        )}

        {mainTab === 'output' && (
          <div className="bp-output">
            <div className="bp-output__toolbar">
              <button className="bp-output__btn" onClick={clearOutput}>Clear</button>
            </div>
            <div className="bp-output__body">
              {outputMessages.length === 0 ? (
                <div className="bp-empty">No output yet. Run the workflow to see results.</div>
              ) : (
                outputMessages.map((msg) => (
                  <div key={msg.id} className="bp-output__msg">
                    <span className="bp-output__time">{msg.timestamp}</span>
                    <span className="bp-output__level" style={{ color: LEVEL_COLORS[msg.level] }}>[{msg.level}]</span>
                    <span className="bp-output__text">{msg.text}</span>
                  </div>
                ))
              )}
              <div ref={outputEndRef} />
            </div>
          </div>
        )}

        {(mainTab === 'markers' || mainTab === 'errors') && (
          <div className="bp-empty">
            {mainTab === 'errors' ? 'No errors found.' : 'No markers.'}
          </div>
        )}
      </div>
    </div>
  );
}

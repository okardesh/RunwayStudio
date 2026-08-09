import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWorkflowStore } from '../../store/workflowStore';
import { useUiStore, type BottomPanelTab } from '../../store/uiStore';
import type { WorkflowVariable } from '../../types';
import './BottomPanel.css';

type SubTab = 'variables' | 'arguments' | 'namespaces' | 'connections';

const PRIMARY_TYPES = ['String', 'Boolean', 'Int32', 'Double', 'DateTime', 'Object', 'List'];

const DOTNET_TYPES = [
  'String', 'Boolean', 'Char', 'Byte', 'SByte', 'Int16', 'Int32', 'Int64', 'UInt16', 'UInt32', 'UInt64',
  'Single', 'Double', 'Decimal', 'DateTime', 'DateOnly', 'TimeOnly', 'TimeSpan', 'Guid', 'Object', 'Enum',
  'Array', 'List', 'Dictionary', 'HashSet', 'Queue', 'Stack', 'IEnumerable', 'ICollection', 'IList',
  'DataTable', 'DataRow', 'DataSet', 'Uri', 'Version', 'Exception', 'System.IO.FileInfo', 'System.IO.DirectoryInfo',
  'System.IO.Stream', 'System.IO.MemoryStream', 'System.IO.StreamReader', 'System.IO.StreamWriter',
  'System.Net.Http.HttpClient', 'System.Net.Http.HttpRequestMessage', 'System.Net.Http.HttpResponseMessage',
  'System.Xml.XmlDocument', 'System.Xml.Linq.XDocument', 'System.Text.StringBuilder', 'System.Text.RegularExpressions.Regex',
  'System.Threading.CancellationToken', 'System.Threading.Tasks.Task', 'System.Threading.Tasks.Task<T>',
  'System.Collections.Generic.KeyValuePair<TKey,TValue>', 'System.Collections.Generic.SortedDictionary<TKey,TValue>',
  'System.Collections.Generic.ObservableCollection<T>', 'System.Linq.IQueryable<T>',
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
  const [typePickerFor, setTypePickerFor] = useState<WorkflowVariable | 'draft' | null>(null);
  const [listPickerFor, setListPickerFor] = useState<WorkflowVariable | 'draft' | null>(null);
  const [typeQuery, setTypeQuery] = useState('');
  const [customType, setCustomType] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftType, setDraftType] = useState('String');
  const [draftDefaultValue, setDraftDefaultValue] = useState('');
  const [availableDotNetTypes, setAvailableDotNetTypes] = useState(DOTNET_TYPES);
  const outputEndRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (mainTab === 'output') outputEndRef.current?.scrollIntoView({ block: 'end' });
  }, [mainTab, outputMessages.length]);

  useEffect(() => {
    const getDotNetTypes = (window as any).electronAPI?.getDotNetTypes as undefined | (() => Promise<string[]>);
    if (!getDotNetTypes) return;
    void getDotNetTypes().then((types) => {
      if (types.length > 0) setAvailableDotNetTypes([...new Set([...DOTNET_TYPES, ...types])].sort());
    });
  }, []);

  const commitDraft = () => {
    const name = draftName.trim();
    if (!name || variables.some((variable) => variable.name === name)) return;
    addVariable({ name, type: draftType, defaultValue: draftDefaultValue, scope: 'Main' });
    setDraftName('');
    setDraftType('String');
    setDraftDefaultValue('');
  };

  const startEdit = (v: WorkflowVariable) => {
    setEditingId(v.id);
    setEditName(v.name);
  };

  const commitEdit = (v: WorkflowVariable) => {
    if (editName.trim()) updateVariable(v.id, { name: editName.trim() });
    setEditingId(null);
  };

  const assignType = (target: WorkflowVariable | 'draft', type: string) => {
    if (target === 'draft') setDraftType(type);
    else updateVariable(target.id, { type });
  };

  const selectType = (target: WorkflowVariable | 'draft', type: string) => {
    if (type === 'List') {
      setListPickerFor(target);
      setTypePickerFor(null);
      setTypeQuery('');
      setCustomType('');
      return;
    }
    assignType(target, type);
    setTypePickerFor(null);
    setTypeQuery('');
  };

  const selectPrimaryType = (target: WorkflowVariable | 'draft', type: string) => {
    if (type === '__more__') {
      setCustomType('');
      setTypePickerFor(target);
      setTypeQuery('');
      return;
    }
    selectType(target, type);
  };

  const selectListElementType = (elementType: string) => {
    if (!listPickerFor) return;
    assignType(listPickerFor, `List<${elementType}>`);
    setListPickerFor(null);
    setTypeQuery('');
  };

  const filteredDotNetTypes = availableDotNetTypes.filter((type) => type.toLowerCase().includes(typeQuery.toLowerCase()));

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
                <div className="bp-vars__row bp-vars__row--draft">
                  <div className="bp-cell bp-cell--name">
                    <input
                      className="bp-cell__input bp-cell__input--draft"
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      onBlur={commitDraft}
                      onKeyDown={(event) => event.key === 'Enter' && commitDraft()}
                      placeholder="Create variable"
                    />
                  </div>
                  <div className="bp-cell bp-cell--type">
                    <select className="bp-cell__select" value={draftType} onChange={(event) => selectPrimaryType('draft', event.target.value)}>
                      {!PRIMARY_TYPES.includes(draftType) && <option value={draftType}>{draftType}</option>}
                      {PRIMARY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                      <option value="__more__">More...</option>
                    </select>
                  </div>
                  <div className="bp-cell bp-cell--scope">Main</div>
                  <div className="bp-cell bp-cell--ctrl" />
                  <div className="bp-cell bp-cell--default">
                    <input className="bp-cell__input bp-cell__input--draft" value={draftDefaultValue} onChange={(event) => setDraftDefaultValue(event.target.value)} onBlur={commitDraft} placeholder="Default value" />
                  </div>
                </div>
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
                      <select className="bp-cell__select" value={v.type} onChange={(event) => selectPrimaryType(v, event.target.value)}>
                        {!PRIMARY_TYPES.includes(v.type) && <option value={v.type}>{v.type}</option>}
                        {PRIMARY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                        <option value="__more__">More...</option>
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

      {typePickerFor && (
        <div className="bp-type-modal__backdrop" onMouseDown={() => setTypePickerFor(null)}>
          <div className="bp-type-modal" role="dialog" aria-modal="true" aria-label="Choose .NET type" onMouseDown={(event) => event.stopPropagation()}>
            <div className="bp-type-modal__header"><strong>Browse and select a .NET type</strong><button onClick={() => setTypePickerFor(null)} title="Close">×</button></div>
            <input className="bp-type-modal__search" value={typeQuery} onChange={(event) => setTypeQuery(event.target.value)} placeholder="Search framework types or enter a full type name below" autoFocus />
            <div className="bp-type-modal__types">
              {filteredDotNetTypes.map((type) => <button key={type} onClick={() => selectType(typePickerFor, type)}>{type}</button>)}
            </div>
            <div className="bp-type-modal__custom">
              <input value={customType} onChange={(event) => setCustomType(event.target.value)} placeholder="Any fully qualified .NET type" />
              <button disabled={!customType.trim()} onClick={() => selectType(typePickerFor, customType.trim())}>Use type</button>
            </div>
          </div>
        </div>
      )}

      {listPickerFor && (
        <div className="bp-type-modal__backdrop" onMouseDown={() => setListPickerFor(null)}>
          <div className="bp-type-modal bp-type-modal--small" role="dialog" aria-modal="true" aria-label="Choose List element type" onMouseDown={(event) => event.stopPropagation()}>
            <div className="bp-type-modal__header"><strong>List element type</strong><button onClick={() => setListPickerFor(null)} title="Close">×</button></div>
            <input className="bp-type-modal__search" value={typeQuery} onChange={(event) => setTypeQuery(event.target.value)} placeholder="Search element types" autoFocus />
            <div className="bp-type-modal__types">
              {filteredDotNetTypes.filter((type) => !['List', 'Array', 'Dictionary', 'HashSet', 'Queue', 'Stack'].includes(type)).map((type) => <button key={type} onClick={() => selectListElementType(type)}>{type}</button>)}
            </div>
            <div className="bp-type-modal__custom">
              <input value={customType} onChange={(event) => setCustomType(event.target.value)} placeholder="Fully qualified element type" />
              <button disabled={!customType.trim()} onClick={() => selectListElementType(customType.trim())}>Use type</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

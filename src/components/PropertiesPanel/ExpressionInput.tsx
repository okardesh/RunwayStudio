import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkflowVariable } from '../../types';
import { useWorkflowStore } from '../../store/workflowStore';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  variables: WorkflowVariable[];
  multiline?: boolean;
  onClick?: (event: React.MouseEvent) => void;
}

const MEMBERS: Record<string, string[]> = {
  String: ['Length', 'ToLower()', 'ToUpper()', 'Trim()', 'Contains()', 'Replace()', 'Substring()'],
  Int16: ['CompareTo()', 'ToString()'], Int32: ['CompareTo()', 'ToString()'], Int64: ['CompareTo()', 'ToString()'],
  Single: ['CompareTo()', 'ToString()'], Double: ['CompareTo()', 'ToString()', 'ToString("F2")'],
  Decimal: ['CompareTo()', 'ToString()', 'ToString("F2")'], Boolean: ['ToString()'],
  DateTime: ['Date', 'Day', 'Month', 'Year', 'AddDays()', 'ToString()'],
  List: ['Count', 'Add()', 'Clear()', 'Contains()'],
  Dictionary: ['Count', 'ContainsKey()', 'Keys', 'Values'],
  Array: ['Length', 'GetLength()', 'Contains()'],
};

type CompletionMode = 'template' | 'templateMember' | 'closedTemplateMember' | null;

function getSuggestions(value: string, variables: WorkflowVariable[]) {
  const closedMemberMatch = value.match(/\{\{\s*([A-Za-z_]\w*)\s*\}\}\.([A-Za-z_]*)$/);
  if (closedMemberMatch) {
    const variable = variables.find((item) => item.name === closedMemberMatch[1]);
    const memberQuery = closedMemberMatch[2].toLowerCase();
    return {
      mode: 'closedTemplateMember' as CompletionMode,
      match: closedMemberMatch,
      suggestions: (MEMBERS[variable?.type ?? ''] ?? []).filter((member) => member.toLowerCase().startsWith(memberQuery)),
    };
  }
  const match = value.match(/\{\{([^{}]*)$/);
  if (!match) return { mode: null as CompletionMode, match: null, suggestions: [] as string[] };
  const query = match[1];
  const dot = query.indexOf('.');
  if (dot >= 0) {
    const variable = variables.find((item) => item.name === query.slice(0, dot));
    const memberQuery = query.slice(dot + 1).toLowerCase();
    return { mode: 'templateMember' as CompletionMode, match, suggestions: (MEMBERS[variable?.type ?? ''] ?? []).filter((member) => member.toLowerCase().startsWith(memberQuery)) };
  }
  const lowerQuery = query.toLowerCase();
  return { mode: 'template' as CompletionMode, match, suggestions: variables.filter((variable) => variable.name.toLowerCase().startsWith(lowerQuery)).map((variable) => variable.name) };
}

function applySuggestion(value: string, suggestion: string) {
  const closedMemberMatch = value.match(/\{\{\s*[A-Za-z_]\w*\s*\}\}\.([A-Za-z_]*)$/);
  if (closedMemberMatch) return `${value.slice(0, value.length - closedMemberMatch[1].length)}${suggestion}`;
  const match = value.match(/\{\{([^{}]*)$/);
  if (!match) return value;
  const query = match[1];
  const dot = query.indexOf('.');
  const replacement = dot >= 0 ? `${query.slice(0, dot + 1)}${suggestion}` : suggestion;
  return `${value.slice(0, value.length - query.length)}${replacement}}}`;
}

function AdvancedExpressionEditor({ initialValue, onSave, onClose, variables }: {
  initialValue: string; onSave: (value: string) => void; onClose: () => void; variables: WorkflowVariable[];
}) {
  const [value, setValue] = useState(initialValue);
  const { suggestions } = useMemo(() => getSuggestions(value, variables), [value, variables]);
  const insertVariable = (variable: WorkflowVariable) => setValue((current) => `${current}{{${variable.name}}}`);

  return createPortal(
    <div className="expression-editor__overlay" onMouseDown={onClose}>
      <div className="expression-editor" role="dialog" aria-modal="true" aria-label="Advanced expression editor" onMouseDown={(event) => event.stopPropagation()}>
        <header className="expression-editor__header">
          <div><strong>Advanced Editor</strong><span>.NET expression</span></div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="expression-editor__body">
          <aside className="expression-editor__variables">
            <div className="expression-editor__label">Workflow Variables</div>
            {variables.length === 0 ? <p>Create a variable in Data Manager to use it here.</p> : variables.map((variable) => (
              <button type="button" key={variable.id} onClick={() => insertVariable(variable)} title={`Insert {{${variable.name}}}`}>
                <strong>{variable.name}</strong><span>{variable.type}</span>
              </button>
            ))}
          </aside>
          <section className="expression-editor__workspace">
            <div className="expression-editor__hint">Type <code>{'{{'}</code> for variables or <code>{'{{variable.'}</code> for members.</div>
            <div className="expression-editor__code-wrap">
              <textarea value={value} onChange={(event) => setValue(event.target.value)} autoFocus spellCheck={false} />
              {suggestions.length > 0 && <div className="expression-editor__completions">
                {suggestions.map((suggestion) => <button type="button" key={suggestion} onMouseDown={(event) => { event.preventDefault(); setValue((current) => applySuggestion(current, suggestion)); }}>{suggestion}</button>)}
              </div>}
            </div>
          </section>
        </div>
        <footer className="expression-editor__footer">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="expression-editor__save" onClick={() => { onSave(value); onClose(); }}>Save</button>
        </footer>
      </div>
    </div>, document.body
  );
}

function CreateVariableDialog({ variables, onCreate, onClose }: {
  variables: WorkflowVariable[];
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const { addVariable } = useWorkflowStore();
  const [name, setName] = useState('');
  const [type, setType] = useState('String');
  const [error, setError] = useState('');

  const createVariable = () => {
    const normalized = name.trim();
    if (!/^[A-Za-z_]\w*$/.test(normalized)) {
      setError('Use letters, numbers, and underscores; start with a letter or underscore.');
      return;
    }
    if (variables.some((variable) => variable.name === normalized)) {
      setError('A variable with this name already exists.');
      return;
    }
    addVariable({ name: normalized, type, defaultValue: '', scope: 'Main' });
    onCreate(normalized);
  };

  return createPortal(
    <div className="expression-create__overlay" onMouseDown={onClose}>
      <div className="expression-create" role="dialog" aria-modal="true" aria-label="Create workflow variable" onMouseDown={(event) => event.stopPropagation()}>
        <header><strong>Create variable</strong><button type="button" onClick={onClose} aria-label="Close">×</button></header>
        <label>Name<input value={name} onChange={(event) => { setName(event.target.value); setError(''); }} onKeyDown={(event) => event.key === 'Enter' && createVariable()} autoFocus placeholder="variableName" /></label>
        <label>Type<select value={type} onChange={(event) => setType(event.target.value)}>
          {['String', 'Boolean', 'Int32', 'Double', 'Decimal', 'DateTime', 'Object', 'List<String>'].map((item) => <option key={item} value={item}>{item}</option>)}
        </select></label>
        {error && <p className="expression-create__error">{error}</p>}
        <footer><button type="button" onClick={onClose}>Cancel</button><button type="button" className="expression-create__confirm" onClick={createVariable}>Create</button></footer>
      </div>
    </div>,
    document.body
  );
}

export function ExpressionInput({ value, onChange, placeholder, variables, multiline = false, onClick }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isEditorOpen, setEditorOpen] = useState(false);
  const [isCreateVariableOpen, setCreateVariableOpen] = useState(false);
  const { match, suggestions } = useMemo(() => getSuggestions(value, variables), [value, variables]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      event.stopPropagation();
      setCreateVariableOpen(true);
      return;
    }
    if (!suggestions.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
    if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); onChange(applySuggestion(value, suggestions[activeIndex])); }
    if (event.key === 'Escape') setActiveIndex(-1);
  };

  const inputProps = {
    className: `pgrid-input${multiline ? ' pgrid-code-input' : ''}`,
    value,
    placeholder,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { onChange(event.target.value); setActiveIndex(0); },
    onKeyDown: handleKeyDown,
  };

  return (
    <div className="expression-input" onClick={onClick}>
      <div className="expression-input__field">
        {multiline ? <textarea {...inputProps} rows={10} spellCheck={false} /> : <input type="text" {...inputProps} />}
        {!multiline && <button type="button" className="expression-input__advanced" onClick={() => setEditorOpen(true)} title="Open advanced editor">...</button>}
      </div>
      {match && suggestions.length > 0 && activeIndex >= 0 && <div className="expression-input__suggestions" role="listbox">
        {suggestions.map((suggestion, index) => <button key={suggestion} type="button" className={`expression-input__suggestion${index === activeIndex ? ' expression-input__suggestion--active' : ''}`} onMouseDown={(event) => { event.preventDefault(); onChange(applySuggestion(value, suggestion)); }}>{suggestion}</button>)}
      </div>}
      {isEditorOpen && <AdvancedExpressionEditor initialValue={value} onSave={onChange} onClose={() => setEditorOpen(false)} variables={variables} />}
      {isCreateVariableOpen && <CreateVariableDialog
        variables={variables}
        onClose={() => setCreateVariableOpen(false)}
        onCreate={(name) => { onChange(`${value}{{${name}}}`); setCreateVariableOpen(false); }}
      />}
    </div>
  );
}

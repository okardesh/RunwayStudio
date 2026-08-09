import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useWorkflowStore } from '../../store/workflowStore';
import { getActivity } from '../../activities/registry';
import type { PropertyDefinition } from '../../types';
import { RecorderModal } from '../Recorder/RecorderModal';
import { DesktopPickerModal } from '../Recorder/DesktopPickerModal';
import { ExpressionInput } from './ExpressionInput';
import './PropertiesPanel.css';

// ── Properties Content (UiPath property grid style) ──────────────────────────

function PropertiesContent() {
  const { selectedNodeId, nodes, updateNodeProperties, configureForEach, renameForEachVariable, variables } = useWorkflowStore();
  const [recorderFor, setRecorderFor] = useState<string | null>(null);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNode) {
    return (
      <div className="prop-grid__empty">
        <div className="prop-grid__empty-icon">🔧</div>
        <p>Select an activity to edit its properties</p>
      </div>
    );
  }

  // Walk up to the nearest ancestor "Use Application/Browser" container to learn
  // whether this activity's selector should target the browser or the desktop,
  // and (for desktop) which window the picker should scope itself to.
  const findAncestorTarget = (nodeId: string): { targetType: 'browser' | 'desktop'; windowTitle: string } => {
    let current = nodes.find((n) => n.id === nodeId);
    while (current) {
      const t = current.data.properties?.targetType;
      if (t === 'browser' || t === 'desktop') {
        return { targetType: t, windowTitle: String(current.data.properties?.windowTitle ?? '') };
      }
      const parentId: string | undefined = current.data.parentId;
      current = parentId ? nodes.find((n) => n.id === parentId) : undefined;
    }
    return { targetType: 'browser', windowTitle: '' };
  };
  const { targetType: ancestorTargetType, windowTitle: ancestorWindowTitle } = findAncestorTarget(selectedNode.id);

  const scopedVariables = (() => {
    let current: typeof selectedNode | undefined = selectedNode;
    while (current) {
      if (current.data.activityId === 'for-each' && current.data.loopVariable) {
        return [...variables, {
          id: `loop-${current.id}`,
          name: current.data.loopVariable.name,
          type: current.data.loopVariable.type,
          defaultValue: '',
          scope: current.data.label,
        }];
      }
      current = current.data.parentId ? nodes.find((node) => node.id === current?.data.parentId) : undefined;
    }
    return variables;
  })();

  const activity = getActivity(selectedNode.data.activityId);
  const typeName = activity
    ? `UiPath.UIAutomationNext.Activities.N${selectedNode.data.activityId.replace(/-/g, '_').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/_/g, '')}`
    : 'System.Activities.Statements.Sequence';

  const props = selectedNode.data.properties;

  const handleChange = (propName: string, value: unknown) => {
    updateNodeProperties(selectedNode.id, { ...props, [propName]: value });
  };

  // Group properties by section for container activities
  const isContainer = selectedNode.data.isContainer;
  const isForEach = selectedNode.data.activityId === 'for-each';
  const isTargetContainer = selectedNode.data.activityId === 'use-app-browser';
  const targetType = (selectedNode.data.properties?.targetType as string) || 'browser';
  const isBrowserTarget = targetType === 'browser';
  
  const sectionMap: Record<string, string[]> = isForEach ? {
    'Common': ['displayName'],
    'For Each': ['collection', 'loopVariable'],
    'Misc': ['private'],
  } : isContainer && isTargetContainer ? {
    'Common': ['displayName'],
    ...(isBrowserTarget ? {
      'Input': ['url'],
      'Options - Browser': ['browser', 'incognito', 'inputMode', 'open', 'close']
    } : {
      'Input': ['windowTitle'],
      'Options': ['inputMode', 'open', 'close']
    }),
    'Misc': ['private'],
  } : {
    'Common': ['displayName'],
    'Properties': (activity?.properties ?? []).filter((p) => p.name !== 'displayName').map((p) => p.name),
    'Misc': ['private'],
  };

  const renderField = (prop: PropertyDefinition) => {
    if (!prop) return null;
    if (prop.type === 'variable') {
      return (
        <div className="pgrid-input-row">
          <input
            type="text"
            className="pgrid-input pgrid-input--variable"
            value={String(props[prop.name] ?? prop.defaultValue ?? '')}
            onChange={(e) => handleChange(prop.name, e.target.value)}
            placeholder={prop.description ?? 'Variable name'}
            list={`var-list-${prop.name}`}
          />
          <datalist id={`var-list-${prop.name}`}>
            {scopedVariables.map((v) => <option key={v.id} value={v.name} />)}
          </datalist>
        </div>
      );
    }
    if (prop.type === 'boolean') {
      return (
        <input
          type="checkbox"
          checked={Boolean(props[prop.name] ?? prop.defaultValue ?? false)}
          onChange={(e) => handleChange(prop.name, e.target.checked)}
          className="pgrid-checkbox"
        />
      );
    }
    if (prop.type === 'select') {
      return (
        <select
          className="pgrid-input"
          value={String(props[prop.name] ?? prop.defaultValue ?? '')}
          onChange={(e) => handleChange(prop.name, e.target.value)}
        >
          {prop.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      );
    }
    if (prop.type === 'code') {
      return (
        <ExpressionInput
          value={String(props[prop.name] ?? prop.defaultValue ?? '')}
          onChange={(value) => handleChange(prop.name, value)}
          placeholder={prop.description}
          variables={scopedVariables}
          multiline
        />
      );
    }
    const isSelectorField = ['selector', 'source', 'target'].includes(prop.name) ||
      prop.label.toLowerCase().includes('selector');
    if (isSelectorField) {
      return (
        <div className="pgrid-input-row">
          <ExpressionInput
            value={String(props[prop.name] ?? prop.defaultValue ?? '')}
            onChange={(value) => handleChange(prop.name, value)}
            placeholder={prop.description ?? ''}
            variables={scopedVariables}
          />
          <button className="pgrid-pick-btn" onClick={() => setRecorderFor(prop.name)} title="Pick element">🎯</button>
        </div>
      );
    }
    if (prop.type === 'expression' || prop.type === 'string') {
      return (
        <ExpressionInput
          value={String(props[prop.name] ?? prop.defaultValue ?? '')}
          onChange={(value) => handleChange(prop.name, value)}
          placeholder={prop.description ?? ''}
          variables={scopedVariables}
        />
      );
    }
    return (
      <ExpressionInput
        value={String(props[prop.name] ?? prop.defaultValue ?? '')}
        onChange={(value) => handleChange(prop.name, value)}
        placeholder={prop.description ?? ''}
        variables={scopedVariables}
      />
    );
  };

  return (
    <div className="prop-grid">
      <div className="prop-grid__type">{typeName}</div>

      {Object.entries(sectionMap).map(([sectionName, propNames]) => {
        if (propNames.length === 0) return null;
        return (
          <div key={sectionName} className="pgrid-section">
            <div className="pgrid-section__hdr">
              <span className="pgrid-section__icon">□</span> {sectionName}
            </div>
            <div className="pgrid-section__body">
              {propNames.map((propName) => {
                const propDef = activity?.properties.find((p) => p.name === propName);
                if (propName === 'displayName') {
                  return (
                    <div key="displayName" className="pgrid-row">
                      <div className="pgrid-row__label">Display name</div>
                      <div className="pgrid-row__value">
                        <ExpressionInput
                          value={String(props['displayName'] ?? selectedNode.data.label ?? '')}
                          onChange={(value) => handleChange('displayName', value)}
                          variables={scopedVariables}
                        />
                      </div>
                    </div>
                  );
                }
                if (propName === 'private') {
                  return (
                    <div key="private" className="pgrid-row">
                      <div className="pgrid-row__label">Private</div>
                      <div className="pgrid-row__value">
                        <input
                          type="checkbox"
                          className="pgrid-checkbox"
                          checked={Boolean(props['private'] ?? false)}
                          onChange={(e) => handleChange('private', e.target.checked)}
                        />
                      </div>
                    </div>
                  );
                }
                if (propName === 'loopVariable') {
                  const loopVariable = selectedNode.data.loopVariable;
                  return (
                    <div key="loopVariable" className="pgrid-row">
                      <div className="pgrid-row__label">Loop variable</div>
                      <div className="pgrid-row__value pgrid-input-row">
                        <input
                          className="pgrid-input"
                          value={loopVariable?.name ?? ''}
                          disabled={!loopVariable}
                          placeholder="Select a collection first"
                          onChange={(event) => renameForEachVariable(selectedNode.id, event.target.value)}
                        />
                        {loopVariable && <span className="pgrid-type-hint">{loopVariable.type}</span>}
                      </div>
                    </div>
                  );
                }
                if (!propDef) return null;
                if (isForEach && propName === 'collection') {
                  const collectionVariables = variables.filter((variable) =>
                    /^(?:List|IEnumerable|ICollection|IList|Array)<.+>$/.test(variable.type) || /\[\]$/.test(variable.type) || variable.type === 'Array'
                  );
                  return (
                    <div key="collection" className="pgrid-row">
                      <div className="pgrid-row__label">Collection<span className="pgrid-required"> *</span></div>
                      <div className="pgrid-row__value">
                        <select
                          className="pgrid-input"
                          value={String(props.collection ?? '')}
                          onChange={(event) => configureForEach(selectedNode.id, event.target.value)}
                        >
                          <option value="">Select a collection</option>
                          {collectionVariables.map((variable) => <option key={variable.id} value={`{{${variable.name}}}`}>{variable.name} ({variable.type})</option>)}
                        </select>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={propName} className="pgrid-row">
                    <div className="pgrid-row__label">
                      {propDef.label}
                      {propDef.required && <span className="pgrid-required"> *</span>}
                    </div>
                    <div className="pgrid-row__value">{renderField(propDef)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {recorderFor !== null && createPortal(
        ancestorTargetType === 'desktop' ? (
          <DesktopPickerModal
            windowTitle={ancestorWindowTitle}
            onSelect={(selector) => { handleChange(recorderFor, selector); setRecorderFor(null); }}
            onClose={() => setRecorderFor(null)}
          />
        ) : (
          <RecorderModal
            onSelect={(selector) => { handleChange(recorderFor, selector); setRecorderFor(null); }}
            onClose={() => setRecorderFor(null)}
          />
        ),
        document.body
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function PropertiesPanel() {
  return (
    <div className="properties-panel">
      <div className="properties-panel__header">
        <span className="properties-panel__title">Properties</span>
        <button className="properties-panel__filter">🔍</button>
      </div>
      <div className="properties-panel__content">
        <PropertiesContent />
      </div>
    </div>
  );
}


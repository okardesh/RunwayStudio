import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useWorkflowStore } from '../../store/workflowStore';
import { getActivity } from '../../activities/registry';
import { RecorderModal } from '../Recorder/RecorderModal';
import { DesktopPickerModal } from '../Recorder/DesktopPickerModal';
import './PropertiesPanel.css';

// ── Properties Content (UiPath property grid style) ──────────────────────────

function PropertiesContent() {
  const { selectedNodeId, nodes, updateNodeProperties } = useWorkflowStore();
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
  const targetType = (selectedNode.data.properties?.targetType as string) || 'browser';
  const isBrowserTarget = targetType === 'browser';
  
  const sectionMap: Record<string, string[]> = isContainer ? {
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

  const renderField = (prop: ReturnType<typeof getActivity>['properties'][0]) => {
    if (!prop) return null;
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
    const isSelectorField = ['selector', 'source', 'target'].includes(prop.name) ||
      prop.label.toLowerCase().includes('selector');
    if (isSelectorField) {
      return (
        <div className="pgrid-input-row">
          <input
            type="text"
            className="pgrid-input"
            value={String(props[prop.name] ?? prop.defaultValue ?? '')}
            onChange={(e) => handleChange(prop.name, e.target.value)}
            placeholder={prop.description ?? ''}
          />
          <button className="pgrid-pick-btn" onClick={() => setRecorderFor(prop.name)} title="Pick element">🎯</button>
        </div>
      );
    }
    return (
      <input
        type={prop.type === 'number' ? 'number' : 'text'}
        className="pgrid-input"
        value={prop.type === 'number'
          ? Number(props[prop.name] ?? prop.defaultValue ?? 0)
          : String(props[prop.name] ?? prop.defaultValue ?? '')}
        onChange={(e) => handleChange(prop.name, prop.type === 'number' ? Number(e.target.value) : e.target.value)}
        placeholder={prop.description ?? ''}
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
                        <input
                          type="text"
                          className="pgrid-input"
                          value={String(props['displayName'] ?? selectedNode.data.label ?? '')}
                          onChange={(e) => handleChange('displayName', e.target.value)}
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
                if (!propDef) return null;
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


import type { Node } from 'reactflow';
import type { WorkflowNodeData, WorkflowVariable } from '../../types';

export type RecordedStep = {
  activityId: 'navigate-to' | 'click' | 'type-into' | 'send-hotkey' | 'get-text';
  properties: Record<string, unknown>;
  preview?: string;
};

export function buildRecordedWorkflow(steps: RecordedStep[], existingVariables: WorkflowVariable[], logOutputs: boolean) {
  if (!steps.length || steps[0].activityId !== 'navigate-to') throw new Error('Record an HTTP or HTTPS navigation first.');
  const names = new Set(existingVariables.map(variable => variable.name));
  const variables: WorkflowVariable[] = [];
  for (const step of steps.filter(step => step.activityId === 'get-text')) {
    const name = String(step.properties.output ?? '');
    if (!/^[A-Za-z_]\w*$/.test(name)) throw new Error('Use a variable name containing letters, numbers and underscores, starting with a letter or underscore.');
    if (existingVariables.some(variable => variable.name === name && variable.type !== 'String')) throw new Error(`Variable ${name} must have type String.`);
    if (!names.has(name)) {
      variables.push({ id: crypto.randomUUID(), name, type: 'String', defaultValue: '', scope: 'Main' });
      names.add(name);
    }
  }
  const node = (activityId: string, label: string, properties: Record<string, unknown>, parentId?: string): Node<WorkflowNodeData> => ({
    id: crypto.randomUUID(), type: 'activityNode', position: { x: 0, y: 0 },
    data: { activityId, label, icon: activityId === 'get-text' ? '📖' : '●', color: '#0078D4', properties, ...(parentId ? { parentId } : {}) },
  });
  const container = node('use-app-browser', 'Recorded browser', { url: steps[0].properties.url, targetType: 'browser', browser: 'Chrome', open: 'Always', close: 'Never' });
  container.data.isContainer = true;
  const children = steps.slice(1).map(step => node(step.activityId, ({ 'navigate-to': 'Navigate To', click: 'Click', 'type-into': 'Type Into', 'send-hotkey': 'Send Hotkey', 'get-text': 'Get Text' })[step.activityId], step.properties, container.id));
  container.data.childIds = children.map(child => child.id);
  const outputs = [...new Set(steps.filter(step => step.activityId === 'get-text').map(step => String(step.properties.output)))];
  const logs = logOutputs ? outputs.map(name => node('log-message', `Log ${name}`, { message: `${name} = {{${name}}}`, level: 'Info' })) : [];
  return { nodes: [container, ...children, ...logs], variables };
}

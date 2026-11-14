import type { ActivityDefinition } from '../../types';
export const humanTaskActivities: ActivityDefinition[] = [
  { id: 'create-human-task', name: 'Create Human Task', category: 'human', icon: '👤', color: '#8B5CF6', nodeType: 'activity', description: 'Creates a durable approval task in Maestro. Main workflow root only. Debug uses a local mock.', properties: [
    { name: 'title', label: 'Task title', type: 'expression', required: true, defaultValue: 'Review request' },
    { name: 'assignee', label: 'Assigned user / role', type: 'string', required: true, defaultValue: 'role:reviewers' },
    { name: 'context', label: 'Review context (JSON / object)', type: 'expression', defaultValue: '{}' },
    { name: 'formSchema', label: 'Form schema (JSON)', type: 'string', defaultValue: '[]' },
    { name: 'timeoutMinutes', label: 'Timeout (minutes)', type: 'number', defaultValue: 1440 },
    { name: 'output', label: 'Task output', type: 'variable', required: true, defaultValue: 'approvalTask' },
  ] },
  { id: 'wait-for-human-task', name: 'Wait for Human Task', category: 'human', icon: '⏸', color: '#8B5CF6', nodeType: 'activity', description: 'Durably waits at a main workflow boundary and releases the Robot. Credentials and open transactions cannot cross a wait. Local Debug simulates a response.', properties: [
    { name: 'task', label: 'Human task', type: 'expression', required: true, defaultValue: '{{approvalTask}}' },
    { name: 'output', label: 'Decision output', type: 'variable', required: true, defaultValue: 'approval' },
    { name: 'debugDecision', label: 'Debug mock decision', type: 'select', defaultValue: 'Approved', options: ['Approved','Rejected','TimedOut'].map(value => ({ label: value, value })) },
    { name: 'debugFields', label: 'Debug mock fields (JSON)', type: 'string', defaultValue: '{}' },
  ] },
];

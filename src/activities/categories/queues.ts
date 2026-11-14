import type { ActivityDefinition } from '../../types';
export const queueActivityDefinitions: ActivityDefinition[] = [
  { id: 'add-queue-item', name: 'Add Queue Item', category: 'queues', icon: '📥', color: '#14B8A6', nodeType: 'activity', description: 'Adds JSON work to a central environment queue. References prevent duplicate insertion.', properties: [
    { name: 'queueName', label: 'Queue name', type: 'string', required: true, defaultValue: '' },
    { name: 'reference', label: 'Unique reference', type: 'expression', required: true, defaultValue: '', description: 'A stable business ID such as an invoice number.' },
    { name: 'content', label: 'Content (JSON / variable)', type: 'expression', required: true, defaultValue: '{}' },
    { name: 'output', label: 'Added item output', type: 'variable', defaultValue: 'addedItem' },
  ] },
  { id: 'get-transaction-item', name: 'Get Transaction Item', category: 'queues', icon: '📤', color: '#14B8A6', nodeType: 'activity', description: 'Claims one available item for this run. Returns null when no work is ready.', properties: [
    { name: 'queueName', label: 'Queue name', type: 'string', required: true, defaultValue: '' },
    { name: 'output', label: 'Transaction output', type: 'variable', required: true, defaultValue: 'transaction' },
    { name: 'hasItemOutput', label: 'Has transaction output', type: 'variable', defaultValue: 'hasTransaction' },
  ] },
  { id: 'set-transaction-status', name: 'Set Transaction Status', category: 'queues', icon: '✅', color: '#14B8A6', nodeType: 'activity', description: 'Commits the result of a transaction claimed by this run. Application failures can retry; Business failures are final.', properties: [
    { name: 'transaction', label: 'Transaction', type: 'expression', required: true, defaultValue: '{{transaction}}' },
    { name: 'status', label: 'Status', type: 'select', defaultValue: 'Successful', options: ['Successful', 'Failed'].map(v => ({ label: v, value: v })) },
    { name: 'errorType', label: 'Error type', type: 'select', defaultValue: 'Application', options: ['Application', 'Business'].map(v => ({ label: v, value: v })) },
    { name: 'reason', label: 'Error reason', type: 'expression', defaultValue: '' },
    { name: 'output', label: 'Result output', type: 'variable', defaultValue: 'transactionResult' },
  ] },
];

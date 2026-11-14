import type { WorkflowDefinition } from './invokedWorkflows';
export function queueTemplate(queueName: string, kind: 'dispatcher' | 'performer'): WorkflowDefinition {
  const node = (id: string, activityId: string, properties: Record<string, unknown>, extra = {}) => ({ id, position: { x: 0, y: 0 }, data: { label: id, activityId, icon: 'ListOrdered', color: '#3b82f6', properties, ...extra } });
  if (kind === 'dispatcher') return { projectName: 'Queue Dispatcher', edges: [], variables: [], arguments: [
    { id: 'reference', name: 'reference', type: 'String', direction: 'In', required: true, defaultValue: '' },
    { id: 'payload', name: 'payload', type: 'Object', direction: 'In', required: true, defaultValue: '' },
  ], nodes: [node('Add work item', 'add-queue-item', { queueName, reference: '{{reference}}', content: '{{payload}}', output: 'addedItem' })] };
  return { projectName: 'Queue Performer sample', edges: [], variables: [], arguments: [], nodes: [
    node('Get next transaction', 'get-transaction-item', { queueName, output: 'transaction', hasItemOutput: 'hasTransaction' }),
    node('If work is available', 'if', {}, { isContainer: true, branches: [{ id: 'yes', kind: 'if', condition: '{{hasTransaction}} == true', childIds: ['Process work here', 'Commit result'] }, { id: 'no', kind: 'else', condition: '', childIds: [] }] }),
    node('Process work here', 'log-message', { message: 'Sample only: replace this log with your business processing activities.' }, { parentId: 'If work is available', branchId: 'yes' }),
    node('Commit result', 'set-transaction-status', { transaction: '{{transaction}}', status: 'Successful', errorType: 'Application', reason: '', output: 'transactionResult' }, { parentId: 'If work is available', branchId: 'yes' }),
  ] };
}

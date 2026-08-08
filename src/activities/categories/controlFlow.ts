import type { ActivityDefinition } from '../../types';

export const controlFlowActivities: ActivityDefinition[] = [
  {
    id: 'sequence',
    name: 'Sequence',
    category: 'controlFlow',
    icon: '▶',
    description: 'Executes activities in sequential order',
    color: '#2E7D32',
    nodeType: 'sequence',
    properties: [
      {
        name: 'displayName',
        label: 'Display Name',
        type: 'string',
        defaultValue: 'Sequence',
      },
    ],
  },
  {
    id: 'if',
    name: 'If',
    category: 'controlFlow',
    icon: '◇',
    description: 'Conditional branching based on a condition',
    color: '#E65100',
    nodeType: 'decision',
    isContainer: true,
    properties: [
      {
        name: 'displayName',
        label: 'Display Name',
        type: 'string',
        defaultValue: 'If',
      },
    ],
  },
  {
    id: 'while',
    name: 'While',
    category: 'controlFlow',
    icon: '🔄',
    description: 'Repeats while condition is true',
    color: '#6A1B9A',
    nodeType: 'loop',
    properties: [
      {
        name: 'condition',
        label: 'Condition',
        type: 'expression',
        defaultValue: '',
        required: true,
      },
    ],
  },
  {
    id: 'for-each',
    name: 'For Each',
    category: 'controlFlow',
    icon: '🔁',
    description: 'Iterates over each item in a collection',
    color: '#6A1B9A',
    nodeType: 'loop',
    properties: [
      {
        name: 'item',
        label: 'Item Variable',
        type: 'variable',
        defaultValue: 'item',
        required: true,
      },
      {
        name: 'collection',
        label: 'Collection',
        type: 'expression',
        defaultValue: '',
        required: true,
      },
    ],
  },
  {
    id: 'try-catch',
    name: 'Try Catch',
    category: 'controlFlow',
    icon: '🛡',
    description: 'Catches and handles runtime exceptions',
    color: '#B71C1C',
    nodeType: 'sequence',
    properties: [
      {
        name: 'exception',
        label: 'Exception Variable',
        type: 'variable',
        defaultValue: 'exception',
      },
    ],
  },
  {
    id: 'break',
    name: 'Break',
    category: 'controlFlow',
    icon: '⏹',
    description: 'Breaks out of the current loop',
    color: '#6A1B9A',
    nodeType: 'activity',
    properties: [],
  },
];

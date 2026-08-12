import type { ActivityDefinition } from '../../types';

const outlookWindows = {
  category: 'mail',
  group: 'Outlook Windows',
  icon: 'O',
  color: '#0078D4',
  nodeType: 'activity' as const,
};

export const outlookWindowsActivities: ActivityDefinition[] = [
  {
    ...outlookWindows,
    id: 'outlook-desktop-delete-message',
    name: 'Delete Outlook Desktop Mail Message',
    description: 'Deletes a selected message using the installed Outlook desktop client',
    properties: [
      { name: 'messageId', label: 'Message ID', type: 'expression', defaultValue: '', required: true },
      { name: 'folder', label: 'Mail Folder', type: 'expression', defaultValue: 'Inbox', required: true },
    ],
  },
  {
    ...outlookWindows,
    id: 'outlook-desktop-get-messages',
    name: 'Get Outlook Desktop Mail Messages',
    description: 'Gets messages from a folder in the installed Outlook desktop client',
    properties: [
      { name: 'folder', label: 'Mail Folder', type: 'expression', defaultValue: 'Inbox', required: true },
      { name: 'limit', label: 'Maximum Messages', type: 'number', defaultValue: 25, required: true },
      { name: 'output', label: 'Output Variable', type: 'variable', defaultValue: 'outlookMessages', required: true },
    ],
  },
  {
    ...outlookWindows,
    id: 'outlook-desktop-mark-read',
    name: 'Mark Outlook Desktop Mail As Read/Unread',
    description: 'Marks a desktop Outlook mail message as read or unread',
    properties: [
      { name: 'messageId', label: 'Message ID', type: 'expression', defaultValue: '', required: true },
      { name: 'isRead', label: 'Mark As Read', type: 'boolean', defaultValue: true },
    ],
  },
  {
    ...outlookWindows,
    id: 'outlook-desktop-move-message',
    name: 'Move Outlook Desktop Mail Message',
    description: 'Moves a desktop Outlook mail message to another folder',
    properties: [
      { name: 'messageId', label: 'Message ID', type: 'expression', defaultValue: '', required: true },
      { name: 'destinationFolder', label: 'Destination Folder', type: 'expression', defaultValue: '', required: true },
    ],
  },
  {
    ...outlookWindows,
    id: 'outlook-desktop-messages-trigger',
    name: 'Outlook Desktop Mail Messages Trigger',
    description: 'Starts a workflow when a desktop Outlook message matches configured criteria',
    properties: [
      { name: 'folder', label: 'Mail Folder', type: 'expression', defaultValue: 'Inbox', required: true },
      { name: 'subjectContains', label: 'Subject Contains', type: 'expression', defaultValue: '' },
    ],
  },
  {
    ...outlookWindows,
    id: 'outlook-desktop-reply-message',
    name: 'Reply To Outlook Desktop Mail Message',
    description: 'Replies to a message through the installed Outlook desktop client',
    properties: [
      { name: 'messageId', label: 'Message ID', type: 'expression', defaultValue: '', required: true },
      { name: 'body', label: 'Reply Body', type: 'expression', defaultValue: '', required: true },
    ],
  },
  {
    ...outlookWindows,
    id: 'outlook-desktop-save-message',
    name: 'Save Outlook Desktop Mail Message',
    description: 'Saves a desktop Outlook mail message to a local file',
    properties: [
      { name: 'messageId', label: 'Message ID', type: 'expression', defaultValue: '', required: true },
      { name: 'path', label: 'Save Path', type: 'expression', defaultValue: '', required: true },
    ],
  },
  {
    ...outlookWindows,
    id: 'outlook-desktop-send-message',
    name: 'Send Outlook Desktop Mail Message',
    description: 'Creates and sends a message through the installed Outlook desktop client',
    properties: [
      { name: 'to', label: 'To', type: 'expression', defaultValue: '', required: true },
      { name: 'subject', label: 'Subject', type: 'expression', defaultValue: '', required: true },
      { name: 'body', label: 'Body', type: 'expression', defaultValue: '', required: true },
    ],
  },
  {
    ...outlookWindows,
    id: 'outlook-desktop-set-categories',
    name: 'Set Outlook Desktop Mail Categories',
    description: 'Sets the categories on a desktop Outlook mail message',
    properties: [
      { name: 'messageId', label: 'Message ID', type: 'expression', defaultValue: '', required: true },
      { name: 'categories', label: 'Categories', type: 'expression', defaultValue: '', required: true, description: 'Comma-separated category names' },
    ],
  },
];
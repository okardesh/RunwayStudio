import type { ActivityDefinition } from '../../types';

const token = { name: 'accessToken', label: 'Access Token', type: 'expression' as const, defaultValue: '{{m365Token}}', required: true, description: 'Short-lived token from Connect Microsoft 365' };

export const office365Activities: ActivityDefinition[] = [
  {
    id: 'connect-m365', name: 'Connect Microsoft 365', category: 'office365',
    description: 'Signs in through Microsoft Device Code Flow and returns a short-lived Graph token', color: '#0078D4', nodeType: 'activity',
    properties: [
      { name: 'tenantId', label: 'Tenant ID', type: 'string', defaultValue: 'organizations', required: true, description: 'Tenant GUID, domain, organizations, or consumers' },
      { name: 'clientId', label: 'Application (Client) ID', type: 'string', defaultValue: '', required: true, description: 'Public client application ID from Entra app registration' },
      { name: 'scopes', label: 'Delegated Scopes', type: 'string', defaultValue: 'User.Read Mail.Read Mail.Send Files.ReadWrite offline_access', required: true },
      { name: 'output', label: 'Output Variable', type: 'variable', defaultValue: 'm365Token', required: true },
    ],
  },
  {
    id: 'outlook-send-email', name: 'Outlook Send Email', category: 'office365',
    description: 'Sends an email from the signed-in Microsoft 365 mailbox', color: '#0078D4', nodeType: 'activity',
    properties: [token, { name: 'to', label: 'To', type: 'expression', defaultValue: '', required: true }, { name: 'subject', label: 'Subject', type: 'expression', defaultValue: '', required: true }, { name: 'body', label: 'Body', type: 'expression', defaultValue: '', required: true }, { name: 'bodyType', label: 'Body Format', type: 'select', defaultValue: 'HTML', options: [{ label: 'HTML', value: 'HTML' }, { label: 'Text', value: 'Text' }] }],
  },
  {
    id: 'outlook-get-emails', name: 'Outlook Get Emails', category: 'office365',
    description: 'Reads messages from an Outlook mail folder', color: '#0078D4', nodeType: 'activity',
    properties: [token, { name: 'folder', label: 'Mail Folder', type: 'expression', defaultValue: 'Inbox', required: true }, { name: 'limit', label: 'Maximum Messages', type: 'number', defaultValue: 25, required: true }, { name: 'output', label: 'Output Variable', type: 'variable', defaultValue: 'emails', required: true }],
  },
  {
    id: 'onedrive-upload-file', name: 'OneDrive Upload File', category: 'office365',
    description: 'Uploads a local file to the signed-in user OneDrive', color: '#0078D4', nodeType: 'activity',
    properties: [token, { name: 'localPath', label: 'Local File Path', type: 'expression', defaultValue: '', required: true }, { name: 'remotePath', label: 'OneDrive Path', type: 'expression', defaultValue: '', required: true }],
  },
  {
    id: 'onedrive-download-file', name: 'OneDrive Download File', category: 'office365',
    description: 'Downloads a OneDrive file to a local path', color: '#0078D4', nodeType: 'activity',
    properties: [token, { name: 'remotePath', label: 'OneDrive Path', type: 'expression', defaultValue: '', required: true }, { name: 'localPath', label: 'Local File Path', type: 'expression', defaultValue: '', required: true }],
  },
  {
    id: 'm365-graph-request', name: 'Microsoft Graph Request', category: 'office365',
    description: 'Calls a Microsoft Graph endpoint for Excel, SharePoint, Teams, and other services', color: '#0078D4', nodeType: 'activity',
    properties: [token, { name: 'method', label: 'Method', type: 'select', defaultValue: 'GET', options: [{ label: 'GET', value: 'GET' }, { label: 'POST', value: 'POST' }, { label: 'PATCH', value: 'PATCH' }, { label: 'DELETE', value: 'DELETE' }] }, { name: 'path', label: 'Graph Path', type: 'expression', defaultValue: '/me', required: true }, { name: 'body', label: 'JSON Body', type: 'expression', defaultValue: '' }, { name: 'output', label: 'Output Variable', type: 'variable', defaultValue: 'graphResult', required: true }],
  },
];
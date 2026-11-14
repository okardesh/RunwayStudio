import type { ActivityDefinition } from '../../types';
import { assetTypes } from '../../shared/assets';
export const assetActivities: ActivityDefinition[] = [
  { id: 'get-asset', name: 'Get Asset', category: 'assets', icon: '🔐', color: '#14B8A6', nodeType: 'activity', description: 'Reads a typed Maestro asset from the selected environment.', properties: [
    { name: 'assetName', label: 'Asset name', type: 'string', required: true, defaultValue: '', description: 'Static central asset name, for example ERP_URL. Values stay outside the workflow package.' },
    { name: 'assetType', label: 'Asset type', type: 'select', defaultValue: 'String', options: assetTypes.filter(t => t !== 'Credential').map(t => ({ label: t, value: t })) },
    { name: 'output', label: 'Output variable', type: 'variable', required: true, defaultValue: 'assetValue' },
  ] },
  { id: 'get-credential', name: 'Get Credential', category: 'assets', icon: '🔑', color: '#14B8A6', nodeType: 'activity', description: 'Reads a Maestro credential. Username and password stay masked in Debug, logs and history.', properties: [
    { name: 'assetName', label: 'Credential name', type: 'string', required: true, defaultValue: '' },
    { name: 'usernameOutput', label: 'Username output', type: 'variable', required: true, defaultValue: 'loginUser' },
    { name: 'passwordOutput', label: 'Password output', type: 'variable', required: true, defaultValue: 'loginPassword' },
  ] },
];

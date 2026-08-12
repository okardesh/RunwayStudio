import type { ActivityCategory, ActivityDefinition } from '../types';
import { browserActivities } from './categories/browser';
import { uiAutomationActivities } from './categories/uiAutomation';
import { dataExtractionActivities } from './categories/dataExtraction';
import { waitVerifyActivities } from './categories/waitVerify';
import { systemActivities } from './categories/system';
import { controlFlowActivities } from './categories/controlFlow';
import { dataActivities } from './categories/data';
import { documentActivities } from './categories/documents';
import { office365Activities } from './categories/office365';
import { outlookWindowsActivities } from './categories/outlookWindows';

export const activityCategories: ActivityCategory[] = [
  {
    id: 'browser',
    name: 'Browser',
    icon: '🌐',
    activities: browserActivities,
  },
  {
    id: 'uiAutomation',
    name: 'UI Automation',
    icon: '🖱',
    activities: uiAutomationActivities,
  },
  {
    id: 'dataExtraction',
    name: 'Data Extraction',
    icon: '📊',
    activities: dataExtractionActivities,
  },
  {
    id: 'waitVerify',
    name: 'Wait & Verify',
    icon: '✅',
    activities: waitVerifyActivities,
  },
  {
    id: 'controlFlow',
    name: 'Workflow',
    icon: '◈',
    activities: controlFlowActivities,
  },
  {
    id: 'system',
    name: 'System',
    icon: '⚙',
    activities: systemActivities,
  },
  {
    id: 'data',
    name: 'Data & Files',
    icon: '🗄',
    activities: dataActivities,
  },
  {
    id: 'documents',
    name: 'Documents',
    icon: 'PDF',
    activities: documentActivities,
  },
  {
    id: 'office365',
    name: 'Microsoft 365',
    icon: 'M365',
    activities: office365Activities,
  },
  {
    id: 'mail',
    name: 'Mail',
    icon: 'MAIL',
    activities: outlookWindowsActivities,
  },
];

const activityRegistry = new Map<string, ActivityDefinition>(
  activityCategories.flatMap((c) => c.activities).map((a) => [a.id, a])
);

export function getActivity(id: string): ActivityDefinition | undefined {
  return activityRegistry.get(id);
}

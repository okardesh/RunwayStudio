import type { ActivityCategory, ActivityDefinition } from '../types';
import { browserActivities } from './categories/browser';
import { uiAutomationActivities } from './categories/uiAutomation';
import { dataExtractionActivities } from './categories/dataExtraction';
import { waitVerifyActivities } from './categories/waitVerify';
import { systemActivities } from './categories/system';
import { controlFlowActivities } from './categories/controlFlow';
import { dataActivities } from './categories/data';

export const activityCategories: ActivityCategory[] = [
  {
    id: 'browser',
    name: 'Browser',
    icon: '🌐',
    activities: browserActivities,
  },
  {
    id: 'uiAutomation',
    name: 'UI Interaction',
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
    name: 'Control Flow',
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
];

const activityRegistry = new Map<string, ActivityDefinition>(
  activityCategories.flatMap((c) => c.activities).map((a) => [a.id, a])
);

export function getActivity(id: string): ActivityDefinition | undefined {
  return activityRegistry.get(id);
}

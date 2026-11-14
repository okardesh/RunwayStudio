import type { ComponentType } from 'react';
declare const Manager: ComponentType<{ apiBase?: string; request?: (route: string, body?: unknown, session?: string) => Promise<any>; profiles?: Array<{ id: string; name: string; enabled: boolean }>; profileId?: string; onSelect?: (id: string) => void }>;
export default Manager;

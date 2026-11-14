import type { ComponentType } from 'react';
declare const component: ComponentType<{apiBase?: string; request?: (route: string, body?: unknown, personalToken?: string) => Promise<any>}>;
export default component;

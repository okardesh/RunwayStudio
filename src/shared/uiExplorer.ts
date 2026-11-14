export type AccessibleNameMatch = 'Exact' | 'IgnoreUnreadCount';
export interface ExplorerNode { id: string; parentId: string | null; name: string; controlType: string; automationId: string; className: string; protected: boolean; selector: string; }
export interface ExplorerSnapshot { nodes: ExplorerNode[]; truncated: boolean; provider: 'msaa' | 'uia'; }
export function stableAccessibleName(name: string) { return name.replace(/\s+\d+\s+unread\s+messages?\s*$/i, '').trimEnd(); }
export function accessibleSelector(windowTitle: string, name: string, controlType: string, nameMatch: AccessibleNameMatch = 'IgnoreUnreadCount') {
  // Encode UTF-8 without depending on Node Buffer in the renderer.
  const json = JSON.stringify({ name: nameMatch === 'IgnoreUnreadCount' ? stableAccessibleName(name) : name, controlType, nameMatch });
  return `window:${windowTitle} > msaa:${btoa(Array.from(new TextEncoder().encode(json), byte => String.fromCharCode(byte)).join(''))}`;
}

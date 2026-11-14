// Session memory only. Never persist personal tokens in settings or browser storage.
const tokens = new Map();
export const auditToken = scope => tokens.get(scope) || '';
export const setAuditToken = (scope, token) => { if (token) tokens.set(scope, token); else tokens.delete(scope); };

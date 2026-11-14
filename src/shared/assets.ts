import { argumentValue, cloneArgument, validArgumentName } from './invokedWorkflows';

export const assetTypes = ['String', 'Boolean', 'Int32', 'Double', 'Object', 'Secret', 'Credential'] as const;
export type AssetType = typeof assetTypes[number];
export interface EnvironmentProfile { id: string; name: string; enabled: boolean }
export interface AssetMetadata { name: string; type: AssetType; profileId: string; revision: number; updatedAt: number; value?: unknown }
export interface AssetCatalog { profiles: EnvironmentProfile[]; assets: AssetMetadata[] }
export interface ResolvedAsset { type: AssetType; value: unknown; revision: number }
export interface AssetRequirement { name: string; type: AssetType }
export type AssetResolver = (name: string, type: AssetType) => Promise<ResolvedAsset>;
export const validAssetName = (name: unknown): name is string => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(name);
export function containsProtectedValue(value: unknown, secrets: string[], depth = 0): boolean {
  if (typeof value === 'string') return secrets.some(s => !!s && value.includes(s));
  if (!value || typeof value !== 'object' || depth > 5) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).slice(0, 100).some(d => 'value' in d && containsProtectedValue(d.value, secrets, depth + 1));
}
export function protectDerivedValues(authored: Record<string, unknown>, resolved: Record<string, unknown>, values: Record<string, unknown>, secrets: string[], protect: (value: string) => void) {
  for (const [field, expression] of Object.entries(authored)) {
    if (typeof expression !== 'string' || ['output', 'to', 'usernameOutput', 'passwordOutput', 'assetName'].includes(field)) continue;
    const roots = [...expression.matchAll(/\{\{\s*([A-Za-z_]\w*)/g)].map(m => m[1]);
    const bare = expression.trim().match(/^([A-Za-z_]\w*)(?:\.|\[|$)/)?.[1]; if (bare) roots.push(bare);
    if (roots.some(root => containsProtectedValue(values[root], secrets)) && typeof resolved[field] === 'string' && resolved[field]) protect(resolved[field] as string);
  }
}
export function assetRequirement(id: string, props: Record<string, unknown>): AssetRequirement {
  if (!validAssetName(props.assetName)) throw Error('Asset name must be a static name containing letters, digits, dots, underscores or hyphens.');
  const type = id === 'get-credential' ? 'Credential' : props.assetType ?? 'String';
  if (!assetTypes.includes(type as AssetType) || id === 'get-asset' && type === 'Credential') throw Error('Choose a valid asset type.');
  return { name: props.assetName, type: type as AssetType };
}
export async function executeAssetActivity(id: string, props: Record<string, unknown>, resolve: AssetResolver | undefined, protect: (value: string) => void) {
  const requirement = assetRequirement(id, props);
  const fields = id === 'get-credential' ? ['usernameOutput', 'passwordOutput'] : ['output'];
  const names = fields.map(f => String(props[f] ?? ''));
  if (names.some(n => !validArgumentName(n)) || new Set(names).size !== names.length) throw Error('Asset outputs need distinct valid variable names.');
  if (!resolve) throw Error('Connect to Maestro and select an environment before reading assets.');
  const result = await resolve(requirement.name, requirement.type);
  if (result.type !== requirement.type) throw Error('Asset type does not match the activity.');
  const outputs: Record<string, unknown> = Object.create(null);
  if (id === 'get-credential') {
    const value = result.value as { username?: unknown; password?: unknown };
    if (!value || typeof value.username !== 'string' || typeof value.password !== 'string') throw Error('Maestro returned an invalid credential.');
    for (const v of [value.username, value.password]) if (v) protect(v);
    outputs[names[0]] = value.username; outputs[names[1]] = value.password;
  } else {
    const value = argumentValue(result.value, requirement.type === 'Secret' ? 'String' : requirement.type);
    if (requirement.type === 'Secret' && typeof value === 'string' && value) protect(value);
    outputs[names[0]] = cloneArgument(value);
  }
  return outputs;
}

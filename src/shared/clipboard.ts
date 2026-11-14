export async function copyText(text: string): Promise<boolean> {
  try {
    const bridge = (window as any).electronAPI?.copyText;
    if (bridge) return await bridge(text) === true;
    await navigator.clipboard.writeText(text);
    return true;
  } catch { return false; }
}

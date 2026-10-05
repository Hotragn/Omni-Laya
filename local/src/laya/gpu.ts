/** Kept apart from the runtime so the page can check the GPU without loading Transformers.js. */
type GpuNavigator = Navigator & { gpu?: { requestAdapter(): Promise<{ features: { has(n: string): boolean } } | null> } };

export async function hasFp16WebGpu(): Promise<boolean> {
  const gpu = (globalThis.navigator as GpuNavigator | undefined)?.gpu;
  if (!gpu) return false;
  try {
    const adapter = await gpu.requestAdapter();
    return adapter?.features.has('shader-f16') ?? false;
  } catch {
    return false;
  }
}

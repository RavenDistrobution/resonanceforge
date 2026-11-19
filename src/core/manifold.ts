// Manifold (WASM) bootstrap. One shared instance for the whole app.
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

let top: ManifoldToplevel | null = null;

export async function initManifold(): Promise<ManifoldToplevel> {
  if (top) return top;
  top = await Module({ locateFile: () => wasmUrl });
  top.setup();
  return top;
}

export function M(): ManifoldToplevel {
  if (!top) throw new Error('Manifold not initialised');
  return top;
}

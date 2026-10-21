// Only the development command supplies a default; production reads the flag directly.
process.env.DEV_TOOLS ??= 'true';
// The Movement Lab exists only in development builds; production bundles index.ts alone.
if (process.env.DEV_TOOLS === 'true') {
  const { registerMovementLab } = await import('../../shared/src/movement-lab');
  registerMovementLab();
}
await import('./index');
export {};

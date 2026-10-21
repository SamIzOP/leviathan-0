// Only the development command supplies a default; production reads the flag directly.
process.env.DEV_TOOLS ??= 'true';
await import('./index');
export {};

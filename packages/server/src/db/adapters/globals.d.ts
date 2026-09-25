// Ambient declaration so `import('bun:sqlite')` type-checks under Node16.
// Bun's own types are unavailable under plain Node; this adapter is only
// ever executed when running under the bun runtime.
declare module 'bun:sqlite';

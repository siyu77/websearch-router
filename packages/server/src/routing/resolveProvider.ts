// Shared resolution of the external `provider` param into a normalized combo.
// Both the internal full-param route (/search) and the external MCP tool route
// funnel through here — no duplicated dispatch logic.
//
// Resolution priority (user decision): a value matching a SAVED combo
// (by id or name) wins over an engine id. A non-JSON string that is neither a
// saved combo nor valid JSON is treated as an engine id and desugared to a
// single-source inline combo; an unknown engine id is left to the execution
// layer (runSource -> kind:'unknown'), not rejected here.
import type { Combo, ComboMode } from './combo.js';
import type { NormalizedCombo } from './normalizeCombo.js';
import { normalizeCombo, ComboValidationError, findStoredCombo, isJsonComboInput } from './normalizeCombo.js';

export interface ResolveProviderOptions {
  // Internal interface only — threaded into the single source for the engine
  // desugar branch. Ignored when the value resolves to a saved/inline combo
  // (a stray accountId never reaches those sources), mirroring the prior
  // top-level provider+accountId shorthand contract.
  accountId?: string;
  // Request-level mode override — applied via normalizeCombo opts, never persisted.
  mode?: ComboMode;
  // meta.combo value for engine/inline resolution (defaults to 'inline').
  fallbackId?: string;
}

export function resolveProvider(
  provider: unknown,
  combos: Combo[],
  opts: ResolveProviderOptions = {},
): NormalizedCombo {
  const fallbackId = opts.fallbackId ?? 'inline';
  const mode = opts.mode;

  if (provider === undefined || provider === null || provider === '') {
    throw new ComboValidationError('provider is required');
  }

  // Inline JSON combo passed as a string (e.g. /search/stream?provider=<json>).
  if (typeof provider === 'string' && isJsonComboInput(provider)) {
    return normalizeCombo(provider, { fallbackId, mode });
  }

  // Saved combo by id/name (wins over an engine id on name clash), else engine id.
  if (typeof provider === 'string') {
    const found = findStoredCombo(combos, provider);
    if (found) return normalizeCombo(found, { mode });
    // engine id desugar -> single-source inline combo (accountId threaded in).
    const source: Record<string, unknown> = { provider };
    if (typeof opts.accountId === 'string' && opts.accountId) source.accountId = opts.accountId;
    return normalizeCombo({ sources: [source] }, { fallbackId, mode });
  }

  // Inline combo passed as an object (internal full-param path).
  if (typeof provider === 'object') {
    return normalizeCombo(provider, { fallbackId, mode });
  }

  throw new ComboValidationError('provider must be a string or an object');
}

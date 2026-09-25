import type { ErrorKind } from '../shared/errorKind.js';
import { errorKindToHttpStatus } from '../shared/errorKind.js';

export function sendError(res: any, kind: ErrorKind, opts: { provider?: string; resetAt?: number; sourceTimings?: Record<string, number> } = {}) {
  const status = errorKindToHttpStatus(kind);
  const error: Record<string, any> = { kind };
  if (opts.provider) error.provider = opts.provider;
  if (opts.resetAt) error.resetAt = opts.resetAt;
  const body: Record<string, any> = { error };
  if (opts.sourceTimings) body.meta = { sourceTimings: opts.sourceTimings };
  res.status(status).json(body);
}

export function sendBadRequest(res: any, message: string) {
  res.status(400).json({ error: { kind: 'bad_request', message } });
}

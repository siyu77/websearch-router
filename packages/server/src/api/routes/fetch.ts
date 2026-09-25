import type { Application } from 'express';
import { fetchContent } from '../../engines/web/fetchContent.js';
import { BodyTooLargeError } from '../../engines/http.js';
import { sendBadRequest } from '../errors.js';

let _fetchContent: ((url: string) => Promise<{ title: string; text: string; mode: string }>) | undefined;
export function __setFetchContentForTests(fn: typeof _fetchContent) { _fetchContent = fn; }

export function mountFetch(app: Application) {
  app.post('/fetch', async (req, res) => {
    const { url } = req.body ?? {};
    if (!url || typeof url !== 'string') return sendBadRequest(res, 'url is required');
    try {
      const result = _fetchContent ? await _fetchContent(url) : await fetchContent(url);
      res.json(result);
    } catch (e) {
      // Oversized pages are a bad-request, not a server error (#13).
      if (e instanceof BodyTooLargeError) return sendBadRequest(res, e.message);
      return sendBadRequest(res, (e as Error).message);
    }
  });
}
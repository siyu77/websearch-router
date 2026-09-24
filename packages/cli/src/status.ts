export async function status(port: number): Promise<{ ok: boolean; body?: any; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, error: `non-2xx health: ${res.status}`, body: await res.json().catch(() => undefined) };
    }
    const body = await res.json();
    if (typeof body.port === 'number') console.log(`Port: ${body.port}`);
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
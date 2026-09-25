export async function search(port: number, query: string, provider?: string) {
  let json: any;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/search`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, provider }),
    });
    json = await res.json();
  } catch (e) {
    console.error(`Search request failed: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }
  if (json.error) { console.error(JSON.stringify(json.error, null, 2)); process.exitCode = 1; return; }
  console.log(`# ${json.results?.length ?? 0} results (degraded: ${json.meta?.degraded})`);
  for (const r of json.results ?? []) console.log(`- [${r.rank_in_source}] ${r.title}\n  ${r.url}`);
  for (const f of json.partialFailures ?? []) console.error(`  ⚠ ${f.source}: ${f.error.kind}`);
}
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function generateRSS(runs: any[]): string {
  const items = runs.map((run) => {
    const date = run.completed_at || run.created_at || '';
    const pubDate = date ? new Date(date + 'Z').toUTCString() : new Date().toUTCString();
    const title = `Pipeline Run — ${date.slice(0, 10)} — ${run.lead_count || 0} leads`;
    const link = `https://signalstack.app/runs/${run.id}`;
    const description = `Completed pipeline run with ${run.lead_count || 0} leads on ${date.slice(0, 10)}.`;

    return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(link)}</link>
      <description>${escapeXml(description)}</description>
      <pubDate>${pubDate}</pubDate>
      <guid isPermaLink="false">${escapeXml(run.id)}</guid>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>SignalStack — Prospect Intelligence</title>
    <description>AI-powered prospect intelligence briefs from 14+ data sources</description>
    <language>en-us</language>
${items}
  </channel>
</rss>
`;
}

import { marked } from 'marked';

const BRAND = '#db2777';
const BRAND_LIGHT = '#fdf2f8';
const BRAND_BORDER = '#fbcfe8';

function scoreColor(score: number): { text: string; bg: string; border: string } {
  if (score >= 70) return { text: '#059669', bg: '#ecfdf5', border: '#a7f3d0' };
  if (score >= 55) return { text: '#d97706', bg: '#fffbeb', border: '#fde68a' };
  if (score >= 35) return { text: '#ea580c', bg: '#fff7ed', border: '#fed7aa' };
  return { text: '#dc2626', bg: '#fef2f2', border: '#fecaca' };
}

function segmentColor(seg: string): { text: string; bg: string } {
  if (seg === 'ENT') return { text: '#7c3aed', bg: '#f5f3ff' };
  if (seg === 'MM') return { text: '#2563eb', bg: '#eff6ff' };
  if (seg === 'SMB') return { text: '#0d9488', bg: '#f0fdfa' };
  return { text: '#6b7280', bg: '#f9fafb' };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildPrintHtml(briefs: { markdown: string; company_name: string; fit_score?: number; segment?: string }[]): string {
  const pages = briefs.map((brief, i) => {
    const html = marked.parse(brief.markdown, { async: false }) as string;
    const sc = scoreColor(brief.fit_score ?? 0);
    const sg = segmentColor(brief.segment ?? '');
    const pageBreak = i > 0 ? 'page-break-before: always;' : '';

    return `
      <div class="brief" style="${pageBreak}">
        <div class="brief-header">
          <h1 class="company-title">${escapeHtml(brief.company_name)}</h1>
          <div class="badges">
            ${brief.fit_score != null ? `<span class="badge" style="color:${sc.text};background:${sc.bg};border-color:${sc.border}">${brief.fit_score}/100</span>` : ''}
            ${brief.segment ? `<span class="badge" style="color:${sg.text};background:${sg.bg}">${brief.segment}</span>` : ''}
          </div>
        </div>
        <div class="brief-content">${html}</div>
      </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${briefs.length === 1 ? escapeHtml(briefs[0].company_name) + ' — Brief' : 'SignalStack Briefs'}</title>
<style>
  @page {
    size: A4;
    margin: 18mm 16mm 20mm 16mm;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.6;
    color: #111827;
    background: #fff;
  }

  .print-bar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    background: #fff; border-bottom: 1px solid #e5e7eb;
    padding: 12px 24px; display: flex; align-items: center; gap: 12px;
  }
  .print-bar button {
    padding: 8px 20px; border-radius: 8px; font-size: 14px; font-weight: 600;
    cursor: pointer; border: none;
  }
  .print-bar .print-btn { background: ${BRAND}; color: #fff; }
  .print-bar .print-btn:hover { background: #be185d; }
  .print-bar .close-btn { background: #f3f4f6; color: #374151; }
  .print-bar .close-btn:hover { background: #e5e7eb; }
  .print-bar span { color: #6b7280; font-size: 13px; }
  .print-spacer { height: 60px; }

  /* Brief layout */
  .brief-header {
    margin-bottom: 16px;
    padding-bottom: 14px;
    border-bottom: 2px solid ${BRAND};
  }
  .company-title {
    font-size: 22pt;
    font-weight: 800;
    color: #111827;
    letter-spacing: -0.5px;
    margin: 0 0 8px;
  }
  .badges { display: flex; gap: 8px; align-items: center; }
  .badge {
    display: inline-block;
    padding: 3px 12px;
    border-radius: 9999px;
    font-size: 9pt;
    font-weight: 700;
    border: 1px solid transparent;
  }

  /* First h1 inside brief content is redundant with our header */
  .brief-content > h1:first-child { display: none; }

  /* Typography */
  h1 {
    font-size: 16pt; font-weight: 700; color: #111827;
    margin: 20pt 0 8pt;
  }
  h2 {
    font-size: 10.5pt; font-weight: 700; color: ${BRAND};
    text-transform: uppercase; letter-spacing: 0.8px;
    margin: 24pt 0 8pt;
    padding-bottom: 4pt;
    border-bottom: 1px solid ${BRAND_BORDER};
  }
  h3 {
    font-size: 11pt; font-weight: 700; color: #111827;
    margin: 14pt 0 4pt;
  }
  h4 {
    font-size: 10pt; font-weight: 600; color: #374151;
    margin: 10pt 0 3pt;
  }

  p { margin: 0 0 8pt; color: #374151; }
  strong { color: #111827; font-weight: 700; }
  em { color: #6b7280; }

  ul, ol { margin: 0 0 8pt; padding-left: 20pt; }
  li { margin: 0 0 3pt; color: #374151; }
  li::marker { color: ${BRAND}; }

  hr {
    border: none;
    border-top: 1px solid #e5e7eb;
    margin: 14pt 0;
  }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 6pt 0 14pt;
    font-size: 9.5pt;
  }
  thead th {
    background: ${BRAND_LIGHT};
    color: ${BRAND};
    font-weight: 700;
    font-size: 8.5pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 6pt 10pt;
    text-align: left;
    border-bottom: 2px solid ${BRAND_BORDER};
  }
  tbody td {
    padding: 5pt 10pt;
    border-bottom: 1px solid #e5e7eb;
    vertical-align: top;
    line-height: 1.5;
  }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:nth-child(even) { background: #f9fafb; }

  /* Blockquotes */
  blockquote {
    border-left: 3px solid ${BRAND};
    background: ${BRAND_LIGHT};
    padding: 8pt 12pt;
    margin: 6pt 0 10pt;
    border-radius: 0 4pt 4pt 0;
    font-style: italic;
    color: #4b5563;
  }
  blockquote p { margin: 0; }

  /* Code */
  code {
    background: #f3f4f6;
    padding: 1pt 4pt;
    border-radius: 3pt;
    font-size: 9pt;
    color: ${BRAND};
    font-family: 'SF Mono', Monaco, Consolas, monospace;
  }
  pre {
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    border-radius: 4pt;
    padding: 8pt 12pt;
    margin: 6pt 0 10pt;
    font-size: 9pt;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }
  pre code { background: none; padding: 0; }

  a { color: ${BRAND}; text-decoration: none; }

  /* Avoid breaking inside these elements */
  h2, h3, h4 { page-break-after: avoid; }
  table, blockquote, pre { page-break-inside: avoid; }
  li { page-break-inside: avoid; }
</style>
</head>
<body>
  <div class="print-bar no-print">
    <button class="print-btn" onclick="window.print()">Save as PDF</button>
    <button class="close-btn" onclick="window.close()">Close</button>
    <span>${briefs.length} brief${briefs.length === 1 ? '' : 's'} — use "Save as PDF" in the print dialog</span>
  </div>
  <div class="print-spacer no-print"></div>
  ${pages}
</body>
</html>`;
}

export function openBriefPrintWindow(
  briefs: { markdown: string; company_name: string; fit_score?: number; segment?: string }[]
): void {
  const html = buildPrintHtml(briefs);
  const win = window.open('', '_blank');
  if (!win) {
    alert('Please allow popups for this site to download briefs as PDF.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

export function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - forge</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    header {
      border-bottom: 2px solid #e0e0e0;
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    h1 { font-size: 2em; margin-bottom: 10px; }
    h2 { font-size: 1.5em; margin: 20px 0 10px; }
    h3 { font-size: 1.2em; margin: 15px 0 10px; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .nav { margin-bottom: 20px; }
    .nav a { margin-right: 15px; }
    .repo-list, .mr-list { list-style: none; }
    .repo-list li, .mr-list li {
      padding: 15px;
      margin-bottom: 10px;
      border: 1px solid #e0e0e0;
      border-radius: 5px;
      background: #f9f9f9;
    }
    .mr-item { display: flex; justify-content: space-between; align-items: center; }
    .mr-info { flex: 1; }
    .mr-status { margin-left: 20px; text-align: right; }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 3px;
      font-size: 0.85em;
      font-weight: bold;
      margin-left: 5px;
    }
    .badge.not-configured { background: #f0f0f0; color: #666; }
    .badge.running { background: #fff3cd; color: #856404; }
    .badge.passed { background: #d4edda; color: #155724; }
    .badge.failed { background: #f8d7da; color: #721c24; }
    .badge.clean { background: #d4edda; color: #155724; }
    .badge.conflicts { background: #f8d7da; color: #721c24; }
    .diff-container {
      background: #f5f5f5;
      border: 1px solid #ddd;
      border-radius: 5px;
      padding: 15px;
      margin: 20px 0;
      overflow-x: auto;
    }
    .diff-container pre {
      font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
      font-size: 0.9em;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .button {
      display: inline-block;
      padding: 10px 20px;
      background: #0066cc;
      color: white;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 1em;
      text-decoration: none;
    }
    .button:hover { background: #0052a3; }
    .button:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
    .alert {
      padding: 15px;
      margin: 20px 0;
      border-radius: 5px;
      border: 1px solid;
    }
    .alert.warning {
      background: #fff3cd;
      border-color: #ffc107;
      color: #856404;
    }
    .alert.info {
      background: #d1ecf1;
      border-color: #0dcaf0;
      color: #055160;
    }
    .stats { margin: 10px 0; color: #666; font-size: 0.9em; }
    .log-container {
      background: #1e1e1e;
      color: #d4d4d4;
      border: 1px solid #333;
      border-radius: 5px;
      padding: 15px;
      margin: 20px 0;
      overflow-x: auto;
      max-height: 800px;
      overflow-y: auto;
    }
    .log-container pre {
      font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
      font-size: 0.85em;
      white-space: pre-wrap;
      word-wrap: break-word;
      margin: 0;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <header>
    <h1><a href="/">forge</a></h1>
    <nav class="nav">
      <a href="/">Repositories</a>
      <a href="/jobs">CI Jobs</a>
    </nav>
  </header>
  <main>
    ${body}
  </main>
</body>
</html>`;
}

export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

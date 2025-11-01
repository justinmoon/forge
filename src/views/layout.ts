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
    
    /* Diff Viewer Styles */
    .diff-viewer { margin: 20px 0; }
    .diff-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 15px;
      background: #f6f8fa;
      border: 1px solid #d1d9e0;
      border-radius: 5px 5px 0 0;
    }
    .diff-summary { font-size: 0.9em; color: #586069; }
    .diff-view-toggle {
      display: flex;
      gap: 5px;
    }
    .diff-toggle-btn {
      padding: 5px 12px;
      border: 1px solid #d1d9e0;
      background: white;
      cursor: pointer;
      font-size: 0.85em;
      border-radius: 3px;
    }
    .diff-toggle-btn:hover { background: #f3f4f6; }
    .diff-toggle-btn.active {
      background: #0366d6;
      color: white;
      border-color: #0366d6;
    }
    .diff-stat-add { color: #22863a; font-weight: 500; }
    .diff-stat-del { color: #cb2431; font-weight: 500; }
    .diff-file-list {
      border: 1px solid #d1d9e0;
      border-top: none;
      background: white;
      max-height: 200px;
      overflow-y: auto;
    }
    .diff-file-list-item {
      display: flex;
      align-items: center;
      padding: 8px 15px;
      border-bottom: 1px solid #e1e4e8;
      font-size: 0.9em;
    }
    .diff-file-list-item:hover { background: #f6f8fa; }
    .diff-file-icon {
      margin-right: 8px;
      font-size: 0.9em;
    }
    .diff-file-name {
      flex: 1;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.9em;
    }
    .diff-file-stats {
      margin-left: 10px;
      font-size: 0.85em;
    }
    .diff-files { margin-top: 20px; }
    .diff-file {
      margin-bottom: 20px;
      border: 1px solid #d1d9e0;
      border-radius: 5px;
      background: white;
    }
    .diff-file-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 15px;
      background: #f6f8fa;
      border-bottom: 1px solid #d1d9e0;
    }
    .diff-file-header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
    }
    .diff-file-header-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .diff-collapse-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 1.2em;
      padding: 0;
      width: 20px;
      color: #586069;
    }
    .diff-collapse-btn:hover { color: #0366d6; }
    .diff-file-path {
      font-family: 'Monaco', 'Menlo', monospace;
      font-weight: 600;
      font-size: 0.95em;
    }
    .diff-file-badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 0.75em;
      font-weight: 600;
      text-transform: uppercase;
    }
    .diff-file-added { background: #d4edda; color: #155724; }
    .diff-file-deleted { background: #f8d7da; color: #721c24; }
    .diff-file-renamed { background: #fff3cd; color: #856404; }
    .diff-file-binary { background: #e7e7e7; color: #586069; }
    .diff-file-stats-text { font-size: 0.85em; }
    .diff-stats-bar {
      font-family: monospace;
      font-size: 0.85em;
      white-space: nowrap;
    }
    .diff-stats-bar-add { color: #22863a; }
    .diff-stats-bar-del { color: #cb2431; }
    .diff-binary-notice, .diff-empty-notice {
      padding: 20px;
      text-align: center;
      color: #586069;
      font-style: italic;
    }
    .diff-content { }
    .diff-hunk { border-bottom: 1px solid #e1e4e8; }
    .diff-hunk:last-child { border-bottom: none; }
    .diff-hunk-header {
      padding: 5px 10px;
      background: #f1f8ff;
      color: #586069;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.85em;
      border-bottom: 1px solid #c8e1ff;
    }
    .diff-table {
      width: 100%;
      border-collapse: collapse;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.85em;
    }
    .diff-table tbody tr:hover { background: #f6f8fa; }
    .diff-line-num {
      width: 1%;
      min-width: 40px;
      padding: 0 10px;
      text-align: right;
      color: #586069;
      user-select: none;
      vertical-align: top;
      border-right: 1px solid #e1e4e8;
    }
    .diff-line-num-old { background: #fafbfc; }
    .diff-line-num-new { background: #fafbfc; }
    .diff-line-content {
      padding: 0 10px;
      white-space: pre-wrap;
      word-wrap: break-word;
      vertical-align: top;
    }
    .diff-line-prefix {
      user-select: none;
      margin-right: 5px;
    }
    .diff-line-add {
      background: #e6ffed;
    }
    .diff-line-add .diff-line-num { background: #cdffd8; }
    .diff-line-add .diff-line-content { background: #e6ffed; }
    .diff-line-delete {
      background: #ffeef0;
    }
    .diff-line-delete .diff-line-num { background: #ffdce0; }
    .diff-line-delete .diff-line-content { background: #ffeef0; }
    .diff-line-context { background: white; }
    
    /* Split view styles */
    .diff-table-split {
      width: 100%;
      border-collapse: collapse;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.85em;
      table-layout: fixed;
    }
    .diff-table-split tbody tr:hover { background: #f6f8fa; }
    .diff-table-split .diff-line-num {
      width: 40px;
      padding: 0 10px;
      text-align: right;
      color: #586069;
      user-select: none;
      vertical-align: top;
      background: #fafbfc;
      border-right: 1px solid #e1e4e8;
    }
    .diff-table-split .diff-line-content-split {
      width: 50%;
      padding: 0 10px;
      white-space: pre-wrap;
      word-wrap: break-word;
      vertical-align: top;
    }
    .diff-table-split .diff-line-delete {
      background: #ffeef0;
    }
    .diff-table-split .diff-line-add {
      background: #e6ffed;
    }
    .diff-table-split .diff-line-empty {
      background: #f6f8fa;
    }
    
    .diff-file.collapsed .diff-content {
      display: none;
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

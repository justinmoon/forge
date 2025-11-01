import { escapeHtml } from './layout';
import type { ParsedDiff, DiffFile, DiffHunk } from '../git/diff-parser';

export function renderDiff(parsedDiff: ParsedDiff): string {
  if (parsedDiff.files.length === 0) {
    return '<p>No changes to display.</p>';
  }

  const totalAdditions = parsedDiff.files.reduce((sum, f) => sum + f.stats.additions, 0);
  const totalDeletions = parsedDiff.files.reduce((sum, f) => sum + f.stats.deletions, 0);

  const fileListHtml = parsedDiff.files.map((file, idx) => {
    const icon = getFileIcon(file.type);
    const statusBadge = getStatusBadge(file.type);
    return `
      <div class="diff-file-list-item">
        <span class="diff-file-icon">${icon}</span>
        <a href="#diff-file-${idx}" class="diff-file-name">${escapeHtml(file.newPath)}</a>
        ${statusBadge}
        <span class="diff-file-stats">
          <span class="diff-stat-add">+${file.stats.additions}</span>
          <span class="diff-stat-del">-${file.stats.deletions}</span>
        </span>
      </div>
    `;
  }).join('');

  const filesHtml = parsedDiff.files.map((file, idx) => renderFile(file, idx)).join('');

  return `
    <div class="diff-viewer">
      <div class="diff-toolbar">
        <div class="diff-summary">
          <strong>${parsedDiff.files.length}</strong> file${parsedDiff.files.length === 1 ? '' : 's'} changed,
          <span class="diff-stat-add">+${totalAdditions}</span>,
          <span class="diff-stat-del">-${totalDeletions}</span>
        </div>
        <div class="diff-view-toggle">
          <button class="diff-toggle-btn active" data-view="unified">Unified</button>
          <button class="diff-toggle-btn" data-view="split">Split</button>
        </div>
      </div>
      <div class="diff-file-list">
        ${fileListHtml}
      </div>
      <div class="diff-files">
        ${filesHtml}
      </div>
    </div>
  `;
}

function renderFile(file: DiffFile, index: number): string {
  const fileHeader = renderFileHeader(file, index);
  
  if (file.isBinary) {
    return `
      <div class="diff-file" id="diff-file-${index}">
        ${fileHeader}
        <div class="diff-binary-notice">Binary file</div>
      </div>
    `;
  }

  if (file.hunks.length === 0) {
    return `
      <div class="diff-file" id="diff-file-${index}">
        ${fileHeader}
        <div class="diff-empty-notice">No content changes</div>
      </div>
    `;
  }

  const hunksHtml = file.hunks.map(hunk => renderHunk(hunk)).join('');

  return `
    <div class="diff-file" id="diff-file-${index}">
      ${fileHeader}
      <div class="diff-content">
        <div class="diff-unified-view">
          ${hunksHtml}
        </div>
        <div class="diff-split-view" style="display: none;">
          ${file.hunks.map(hunk => renderHunkSplit(hunk)).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderFileHeader(file: DiffFile, index: number): string {
  const icon = getFileIcon(file.type);
  const statusBadge = getStatusBadge(file.type);
  const statsBar = renderStatsBar(file.stats.additions, file.stats.deletions);

  return `
    <div class="diff-file-header">
      <div class="diff-file-header-left">
        <button class="diff-collapse-btn" data-file="${index}" title="Collapse/Expand">
          <span class="collapse-icon">−</span>
        </button>
        <span class="diff-file-icon">${icon}</span>
        <span class="diff-file-path">${escapeHtml(file.newPath)}</span>
        ${statusBadge}
      </div>
      <div class="diff-file-header-right">
        <span class="diff-file-stats-text">
          <span class="diff-stat-add">+${file.stats.additions}</span>
          <span class="diff-stat-del">-${file.stats.deletions}</span>
        </span>
        ${statsBar}
      </div>
    </div>
  `;
}

function renderHunk(hunk: DiffHunk): string {
  const linesHtml = hunk.lines.map(line => {
    const lineTypeClass = `diff-line-${line.type}`;
    const oldNum = line.oldLineNumber !== null ? line.oldLineNumber.toString() : '';
    const newNum = line.newLineNumber !== null ? line.newLineNumber.toString() : '';
    const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';

    return `
      <tr class="${lineTypeClass}">
        <td class="diff-line-num diff-line-num-old">${oldNum}</td>
        <td class="diff-line-num diff-line-num-new">${newNum}</td>
        <td class="diff-line-content"><span class="diff-line-prefix">${prefix}</span>${escapeHtml(line.content)}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="diff-hunk">
      <div class="diff-hunk-header">${escapeHtml(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.header}`)}</div>
      <table class="diff-table">
        <tbody>
          ${linesHtml}
        </tbody>
      </table>
    </div>
  `;
}

function renderHunkSplit(hunk: DiffHunk): string {
  const rows: string[] = [];
  let i = 0;
  
  while (i < hunk.lines.length) {
    const line = hunk.lines[i];
    
    if (line.type === 'context') {
      rows.push(`
        <tr class="diff-line-context">
          <td class="diff-line-num">${line.oldLineNumber}</td>
          <td class="diff-line-content-split"><span class="diff-line-prefix"> </span>${escapeHtml(line.content)}</td>
          <td class="diff-line-num">${line.newLineNumber}</td>
          <td class="diff-line-content-split"><span class="diff-line-prefix"> </span>${escapeHtml(line.content)}</td>
        </tr>
      `);
      i++;
    } else if (line.type === 'delete') {
      const deleteLine = line;
      let addLine = null;
      
      if (i + 1 < hunk.lines.length && hunk.lines[i + 1].type === 'add') {
        addLine = hunk.lines[i + 1];
        i += 2;
      } else {
        i++;
      }
      
      if (addLine) {
        rows.push(`
          <tr class="diff-line-split-change">
            <td class="diff-line-num">${deleteLine.oldLineNumber}</td>
            <td class="diff-line-content-split diff-line-delete"><span class="diff-line-prefix">-</span>${escapeHtml(deleteLine.content)}</td>
            <td class="diff-line-num">${addLine.newLineNumber}</td>
            <td class="diff-line-content-split diff-line-add"><span class="diff-line-prefix">+</span>${escapeHtml(addLine.content)}</td>
          </tr>
        `);
      } else {
        rows.push(`
          <tr class="diff-line-split-change">
            <td class="diff-line-num">${deleteLine.oldLineNumber}</td>
            <td class="diff-line-content-split diff-line-delete"><span class="diff-line-prefix">-</span>${escapeHtml(deleteLine.content)}</td>
            <td class="diff-line-num"></td>
            <td class="diff-line-content-split diff-line-empty"></td>
          </tr>
        `);
      }
    } else if (line.type === 'add') {
      rows.push(`
        <tr class="diff-line-split-change">
          <td class="diff-line-num"></td>
          <td class="diff-line-content-split diff-line-empty"></td>
          <td class="diff-line-num">${line.newLineNumber}</td>
          <td class="diff-line-content-split diff-line-add"><span class="diff-line-prefix">+</span>${escapeHtml(line.content)}</td>
        </tr>
      `);
      i++;
    }
  }

  return `
    <div class="diff-hunk">
      <div class="diff-hunk-header">${escapeHtml(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.header}`)}</div>
      <table class="diff-table-split">
        <tbody>
          ${rows.join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderStatsBar(additions: number, deletions: number): string {
  const total = additions + deletions;
  if (total === 0) return '<div class="diff-stats-bar"></div>';
  
  const maxBlocks = 5;
  const addBlocks = Math.round((additions / total) * maxBlocks);
  const delBlocks = maxBlocks - addBlocks;
  
  const addSquares = '█'.repeat(Math.max(1, addBlocks));
  const delSquares = '█'.repeat(Math.max(0, delBlocks));
  
  return `
    <div class="diff-stats-bar">
      <span class="diff-stats-bar-add">${addSquares}</span><span class="diff-stats-bar-del">${delSquares}</span>
    </div>
  `;
}

function getFileIcon(type: DiffFile['type']): string {
  switch (type) {
    case 'added': return '✚';
    case 'deleted': return '✖';
    case 'modified': return '●';
    case 'renamed': return '⤷';
    case 'binary': return '◆';
    default: return '●';
  }
}

function getStatusBadge(type: DiffFile['type']): string {
  switch (type) {
    case 'added': return '<span class="diff-file-badge diff-file-added">added</span>';
    case 'deleted': return '<span class="diff-file-badge diff-file-deleted">deleted</span>';
    case 'renamed': return '<span class="diff-file-badge diff-file-renamed">renamed</span>';
    case 'binary': return '<span class="diff-file-badge diff-file-binary">binary</span>';
    default: return '';
  }
}

export interface ParsedDiff {
  files: DiffFile[];
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  type: 'added' | 'deleted' | 'modified' | 'renamed' | 'binary';
  hunks: DiffHunk[];
  stats: {
    additions: number;
    deletions: number;
  };
  isBinary: boolean;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'delete' | 'context';
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export function parseDiff(diffOutput: string): ParsedDiff {
  const files: DiffFile[] = [];
  const lines = diffOutput.split('\n');
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    
    if (line.startsWith('diff --git')) {
      const file = parseFile(lines, i);
      if (file) {
        files.push(file.file);
        i = file.nextIndex;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  
  return { files };
}

function parseFile(lines: string[], startIndex: number): { file: DiffFile; nextIndex: number } | null {
  let i = startIndex;
  const diffGitLine = lines[i];
  
  const match = diffGitLine.match(/^diff --git a\/(.+) b\/(.+)$/);
  if (!match) return null;
  
  let oldPath = match[1];
  let newPath = match[2];
  let type: DiffFile['type'] = 'modified';
  let isBinary = false;
  const hunks: DiffHunk[] = [];
  let additions = 0;
  let deletions = 0;
  
  i++;
  
  while (i < lines.length && !lines[i].startsWith('diff --git')) {
    const line = lines[i];
    
    if (line.startsWith('new file mode')) {
      type = 'added';
      i++;
    } else if (line.startsWith('deleted file mode')) {
      type = 'deleted';
      i++;
    } else if (line.startsWith('rename from')) {
      type = 'renamed';
      oldPath = line.substring('rename from '.length);
      i++;
    } else if (line.startsWith('rename to')) {
      newPath = line.substring('rename to '.length);
      i++;
    } else if (line.startsWith('Binary files')) {
      isBinary = true;
      type = 'binary';
      i++;
      break;
    } else if (line.startsWith('@@')) {
      const hunkResult = parseHunk(lines, i);
      if (hunkResult) {
        hunks.push(hunkResult.hunk);
        additions += hunkResult.additions;
        deletions += hunkResult.deletions;
        i = hunkResult.nextIndex;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  
  return {
    file: {
      oldPath,
      newPath,
      type,
      hunks,
      stats: { additions, deletions },
      isBinary,
    },
    nextIndex: i,
  };
}

function parseHunk(lines: string[], startIndex: number): { hunk: DiffHunk; additions: number; deletions: number; nextIndex: number } | null {
  const hunkHeaderLine = lines[startIndex];
  const hunkMatch = hunkHeaderLine.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
  
  if (!hunkMatch) return null;
  
  const oldStart = parseInt(hunkMatch[1], 10);
  const oldLines = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;
  const newStart = parseInt(hunkMatch[3], 10);
  const newLines = hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1;
  const header = hunkMatch[5].trim();
  
  const hunkLines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;
  let oldLineNum = oldStart;
  let newLineNum = newStart;
  
  let i = startIndex + 1;
  
  while (i < lines.length) {
    const line = lines[i];
    
    if (line.startsWith('diff --git') || line.startsWith('@@')) {
      break;
    }
    
    if (line.startsWith('+')) {
      hunkLines.push({
        type: 'add',
        content: line.substring(1),
        oldLineNumber: null,
        newLineNumber: newLineNum++,
      });
      additions++;
      i++;
    } else if (line.startsWith('-')) {
      hunkLines.push({
        type: 'delete',
        content: line.substring(1),
        oldLineNumber: oldLineNum++,
        newLineNumber: null,
      });
      deletions++;
      i++;
    } else if (line.startsWith(' ')) {
      hunkLines.push({
        type: 'context',
        content: line.substring(1),
        oldLineNumber: oldLineNum++,
        newLineNumber: newLineNum++,
      });
      i++;
    } else if (line.startsWith('\\')) {
      i++;
    } else {
      break;
    }
  }
  
  return {
    hunk: {
      oldStart,
      oldLines,
      newStart,
      newLines,
      header,
      lines: hunkLines,
    },
    additions,
    deletions,
    nextIndex: i,
  };
}

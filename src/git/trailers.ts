import { execGit } from './exec';

export function getCommitTrailers(
  repoPath: string,
  commit: string
): Record<string, string> {
  const result = execGit(
    ['show', '--format=%B', '--no-patch', commit],
    { cwd: repoPath }
  );

  if (!result.success) {
    return {};
  }

  const message = result.stdout;
  const trailers: Record<string, string> = {};

  const lines = message.split('\n');
  let inTrailers = false;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    
    if (line === '') {
      if (inTrailers) {
        break;
      }
      continue;
    }

    const match = line.match(/^([A-Za-z][A-Za-z0-9-]*?):\s*(.+)$/);
    if (match) {
      inTrailers = true;
      trailers[match[1]] = match[2];
    } else if (inTrailers) {
      break;
    }
  }

  return trailers;
}

export function hasAutoMergeTrailer(repoPath: string, commit: string): boolean {
  const trailers = getCommitTrailers(repoPath, commit);
  // Check both variants for compatibility
  return trailers['Auto-Merge'] === 'yes' || trailers['Forge-Auto-Merge'] === 'true';
}

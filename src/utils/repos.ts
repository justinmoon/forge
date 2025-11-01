import { readdirSync, statSync } from 'fs';
import { join } from 'path';

export function listRepos(reposPath: string): string[] {
  try {
    const entries = readdirSync(reposPath);
    const repos: string[] = [];

    for (const entry of entries) {
      const fullPath = join(reposPath, entry);
      if (statSync(fullPath).isDirectory() && entry.endsWith('.git')) {
        repos.push(entry.replace(/\.git$/, ''));
      }
    }

    return repos.sort();
  } catch (err) {
    return [];
  }
}

export function getRepoPath(reposPath: string, repoName: string): string {
  return join(reposPath, `${repoName}.git`);
}

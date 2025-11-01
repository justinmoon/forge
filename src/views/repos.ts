import { layout, escapeHtml } from './layout';

export function renderRepoList(repos: string[]): string {
  if (repos.length === 0) {
    return layout('Repositories', `
      <h2>Repositories</h2>
      <p>No repositories found. Add bare repositories to the repos directory.</p>
    `);
  }

  const repoItems = repos
    .map(
      (repo) => `
      <li>
        <div class="repo-item">
          <h3><a href="/r/${escapeHtml(repo)}">${escapeHtml(repo)}</a></h3>
        </div>
      </li>
    `
    )
    .join('');

  return layout('Repositories', `
    <h2>Repositories</h2>
    <ul class="repo-list">
      ${repoItems}
    </ul>
  `);
}

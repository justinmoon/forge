import { layout, escapeHtml } from './layout';

export function renderRepoList(repos: string[]): string {
  const createButton = `<a href="/create" style="float: right; padding: 8px 16px; background: #4CAF50; color: white; text-decoration: none; border-radius: 4px;">+ Create Repository</a>`;
  
  if (repos.length === 0) {
    return layout('Repositories', `
      <h2>Repositories ${createButton}</h2>
      <div style="clear: both;"></div>
      <p>No repositories found. Create your first repository!</p>
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
    <h2>Repositories ${createButton}</h2>
    <div style="clear: both;"></div>
    <ul class="repo-list">
      ${repoItems}
    </ul>
  `);
}

export function renderCreateRepoForm(error?: string): string {
  const errorHtml = error ? `<div style="padding: 12px; margin-bottom: 16px; background: #ffebee; color: #c62828; border-radius: 4px;">${escapeHtml(error)}</div>` : '';
  
  return layout('Create Repository', `
    <h2>Create Repository</h2>
    <div><a href="/">&larr; Back to repositories</a></div>
    <br/>
    ${errorHtml}
    <form method="POST" action="/create" style="max-width: 500px;">
      <div style="margin-bottom: 16px;">
        <label for="name" style="display: block; margin-bottom: 4px; font-weight: bold;">Repository Name</label>
        <input 
          type="text" 
          id="name" 
          name="name" 
          required 
          pattern="[a-zA-Z0-9_-]+"
          placeholder="my-project"
          style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px;"
        />
        <small style="color: #666;">Letters, numbers, hyphens, and underscores only</small>
      </div>
      
      <div>
        <button 
          type="submit" 
          style="padding: 10px 24px; background: #4CAF50; color: white; border: none; border-radius: 4px; font-size: 14px; cursor: pointer;"
        >
          Create Repository
        </button>
        <a href="/" style="margin-left: 12px; color: #666;">Cancel</a>
      </div>
    </form>
  `);
}

export function renderRepoCreated(repoName: string, cloneUrl: string, webUrl: string): string {
  return layout('Repository Created', `
    <h2>✓ Repository Created</h2>
    <p>Repository <strong>${escapeHtml(repoName)}</strong> has been created with CI hooks installed.</p>
    
    <h3>Clone your repository:</h3>
    <pre style="background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto;">git clone ${escapeHtml(cloneUrl)}</pre>
    
    <h3>Next steps:</h3>
    <ol>
      <li>Clone the repository locally</li>
      <li>Add a <code>justfile</code> recipe named <code>pre-merge</code> or expose <code>.#pre-merge</code> in <code>flake.nix</code> for CI</li>
      <li>Push a feature branch to create a merge request</li>
    </ol>
    
    <div style="margin-top: 24px;">
      <a href="${escapeHtml(webUrl)}" style="padding: 8px 16px; background: #2196F3; color: white; text-decoration: none; border-radius: 4px;">View Repository</a>
      <a href="/" style="margin-left: 12px; color: #666;">Back to repositories</a>
    </div>
  `);
}

export function renderDeleteConfirmation(repoName: string): string {
  return layout('Delete Repository', `
    <h2>Delete Repository</h2>
    <div><a href="/r/${escapeHtml(repoName)}">&larr; Back to repository</a></div>
    <br/>
    
    <div style="padding: 16px; background: #ffebee; border-left: 4px solid #c62828; margin-bottom: 16px;">
      <strong>⚠️ Warning: This action cannot be undone!</strong>
      <p>This will permanently delete:</p>
      <ul>
        <li>Repository: <strong>${escapeHtml(repoName)}</strong></li>
        <li>All commits, branches, and tags</li>
        <li>All CI logs and history</li>
      </ul>
    </div>
    
    <form method="POST" action="/r/${escapeHtml(repoName)}/delete" style="max-width: 500px;">
      <div style="margin-bottom: 16px;">
        <label for="confirm" style="display: block; margin-bottom: 4px; font-weight: bold;">Type repository name to confirm</label>
        <input 
          type="text" 
          id="confirm" 
          name="confirm" 
          required 
          placeholder="${escapeHtml(repoName)}"
          style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px;"
        />
      </div>
      
      <div>
        <button 
          type="submit" 
          style="padding: 10px 24px; background: #c62828; color: white; border: none; border-radius: 4px; font-size: 14px; cursor: pointer;"
        >
          Delete Repository
        </button>
        <a href="/r/${escapeHtml(repoName)}" style="margin-left: 12px; color: #666;">Cancel</a>
      </div>
    </form>
  `);
}

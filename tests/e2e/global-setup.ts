import { mkdirSync, rmSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

export default function globalSetup() {
  const dataDir = '.forge-e2e';
  const testRepoPath = join(dataDir, 'repos', 'ui-test-repo.git');

  // Clean up any existing test data
  if (existsSync(dataDir)) {
    rmSync(dataDir, { recursive: true, force: true });
  }

  // Create test repo with feature branch
  mkdirSync(testRepoPath, { recursive: true });
  execSync('git init --bare', { cwd: testRepoPath });

  const workDir = join(dataDir, 'work');
  mkdirSync(workDir, { recursive: true });

  execSync(`git clone ${join(process.cwd(), testRepoPath)} ui-test-repo`, { cwd: workDir });
  const workRepoPath = join(workDir, 'ui-test-repo');

  execSync('git config user.name "Test"', { cwd: workRepoPath });
  execSync('git config user.email "test@example.com"', { cwd: workRepoPath });
  execSync('echo "initial" > README.md', { cwd: workRepoPath });
  execSync('git add README.md', { cwd: workRepoPath });
  execSync('git commit -m "Initial commit"', { cwd: workRepoPath });
  execSync('git push origin master', { cwd: workRepoPath });

  // Create feature branch
  execSync('git checkout -b feature-ui', { cwd: workRepoPath });
  execSync('echo "feature content" > feature.txt', { cwd: workRepoPath });
  execSync('git add feature.txt', { cwd: workRepoPath });
  execSync('git commit -m "Add feature"', { cwd: workRepoPath });
  execSync('git push origin feature-ui', { cwd: workRepoPath });

  // Clean up work directory
  rmSync(workDir, { recursive: true, force: true });

  console.log('Global setup complete: test repository created');
}

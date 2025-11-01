import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { listRepos, getRepoPath } from '../src/utils/repos';
import { listBranches, listFeatureBranches, getHeadCommit, branchExists } from '../src/git/branches';
import { getMergeBase, getAheadBehindCounts, checkConflicts, getDiff, getMergeMetadata } from '../src/git/merge';
import { getCommitTrailers, hasAutoMergeTrailer } from '../src/git/trailers';

let tempDir: string;
let reposDir: string;
let bareRepoPath: string;
let workRepoPath: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'forge-test-'));
  reposDir = join(tempDir, 'repos');
  bareRepoPath = join(reposDir, 'test-repo.git');
  workRepoPath = join(tempDir, 'work-repo');

  execSync(`mkdir -p "${reposDir}"`);
  execSync(`git init --bare "${bareRepoPath}"`, { stdio: 'pipe' });
  execSync(`git clone "${bareRepoPath}" "${workRepoPath}"`, { stdio: 'pipe' });

  execSync('git config user.name "Test User"', { cwd: workRepoPath, stdio: 'pipe' });
  execSync('git config user.email "test@example.com"', { cwd: workRepoPath, stdio: 'pipe' });

  execSync('echo "Hello World" > README.md', { cwd: workRepoPath, stdio: 'pipe' });
  execSync('git add README.md', { cwd: workRepoPath, stdio: 'pipe' });
  execSync('git commit -m "Initial commit"', { cwd: workRepoPath, stdio: 'pipe' });
  execSync('git push origin master', { cwd: workRepoPath, stdio: 'pipe' });

  execSync('git checkout -b feature-1', { cwd: workRepoPath, stdio: 'pipe' });
  execSync('echo "Feature 1" >> README.md', { cwd: workRepoPath, stdio: 'pipe' });
  execSync('git add README.md', { cwd: workRepoPath, stdio: 'pipe' });
  execSync('git commit -m "Add feature 1"', { cwd: workRepoPath, stdio: 'pipe' });
  execSync('git push origin feature-1', { cwd: workRepoPath, stdio: 'pipe' });

  execSync('git checkout master', { cwd: workRepoPath, stdio: 'pipe' });
  execSync('git checkout -b feature-2', { cwd: workRepoPath, stdio: 'pipe' });
  execSync('echo "Feature 2" >> README.md', { cwd: workRepoPath, stdio: 'pipe' });
  execSync('git add README.md', { cwd: workRepoPath, stdio: 'pipe' });
  execSync('git commit -m "Add feature 2\n\nForge-Auto-Merge: true"', { cwd: workRepoPath, stdio: 'pipe' });
  execSync('git push origin feature-2', { cwd: workRepoPath, stdio: 'pipe' });
});

afterAll(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('Repo enumeration', () => {
  test('listRepos returns bare repositories', () => {
    const repos = listRepos(reposDir);
    expect(repos).toContain('test-repo');
    expect(repos.length).toBe(1);
  });

  test('getRepoPath constructs correct path', () => {
    const path = getRepoPath(reposDir, 'test-repo');
    expect(path).toBe(bareRepoPath);
  });
});

describe('Branch operations', () => {
  test('listBranches returns all branches', () => {
    const branches = listBranches(bareRepoPath);
    expect(branches).toContain('master');
    expect(branches).toContain('feature-1');
    expect(branches).toContain('feature-2');
    expect(branches.length).toBe(3);
  });

  test('listFeatureBranches excludes master', () => {
    const branches = listFeatureBranches(bareRepoPath);
    expect(branches).not.toContain('master');
    expect(branches).toContain('feature-1');
    expect(branches).toContain('feature-2');
    expect(branches.length).toBe(2);
  });

  test('getHeadCommit returns commit hash', () => {
    const commit = getHeadCommit(bareRepoPath, 'master');
    expect(commit).toBeTruthy();
    expect(commit?.length).toBe(40);
  });

  test('branchExists checks branch existence', () => {
    expect(branchExists(bareRepoPath, 'master')).toBe(true);
    expect(branchExists(bareRepoPath, 'feature-1')).toBe(true);
    expect(branchExists(bareRepoPath, 'nonexistent')).toBe(false);
  });
});

describe('Merge operations', () => {
  test('getMergeBase returns common ancestor', () => {
    const base = getMergeBase(bareRepoPath, 'feature-1', 'master');
    expect(base).toBeTruthy();
    expect(base?.length).toBe(40);
  });

  test('getAheadBehindCounts calculates correctly', () => {
    const counts = getAheadBehindCounts(bareRepoPath, 'feature-1', 'master');
    expect(counts.ahead).toBe(1);
    expect(counts.behind).toBe(0);
  });

  test('checkConflicts detects clean merge', () => {
    const hasConflicts = checkConflicts(bareRepoPath, 'master', 'feature-1');
    expect(hasConflicts).toBe(false);
  });

  test('getDiff returns diff output', () => {
    const masterCommit = getHeadCommit(bareRepoPath, 'master');
    const featureCommit = getHeadCommit(bareRepoPath, 'feature-1');
    const diff = getDiff(bareRepoPath, masterCommit!, featureCommit!);
    expect(diff).toContain('Feature 1');
  });

  test('getMergeMetadata returns complete metadata', () => {
    const metadata = getMergeMetadata(bareRepoPath, 'feature-1', 'master');
    expect(metadata).toBeTruthy();
    expect(metadata?.headCommit).toBeTruthy();
    expect(metadata?.mergeBase).toBeTruthy();
    expect(metadata?.aheadCount).toBe(1);
    expect(metadata?.behindCount).toBe(0);
    expect(metadata?.hasConflicts).toBe(false);
  });
});

describe('Trailers', () => {
  test('getCommitTrailers extracts trailers', () => {
    const commit = getHeadCommit(bareRepoPath, 'feature-2');
    const trailers = getCommitTrailers(bareRepoPath, commit!);
    expect(trailers['Forge-Auto-Merge']).toBe('true');
  });

  test('hasAutoMergeTrailer detects trailer', () => {
    const feature2Commit = getHeadCommit(bareRepoPath, 'feature-2');
    const feature1Commit = getHeadCommit(bareRepoPath, 'feature-1');
    
    expect(hasAutoMergeTrailer(bareRepoPath, feature2Commit!)).toBe(true);
    expect(hasAutoMergeTrailer(bareRepoPath, feature1Commit!)).toBe(false);
  });
});

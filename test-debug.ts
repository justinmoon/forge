import { listBranches, listFeatureBranches } from './src/git/branches';
import { getRepoPath } from './src/utils/repos';

const repoPath = process.argv[2] || '/tmp/test-repo/.git';
console.log('Repo path:', repoPath);

const branches = listBranches(repoPath);
console.log('All branches:', branches);

const features = listFeatureBranches(repoPath);
console.log('Feature branches:', features);

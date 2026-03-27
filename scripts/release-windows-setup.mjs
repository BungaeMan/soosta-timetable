import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const workflowFile = 'build-windows-setup.yml';
const allowedReleaseTypes = new Set(['patch', 'minor', 'major']);

const releaseType = process.argv[2] ?? 'patch';
if (!allowedReleaseTypes.has(releaseType)) {
  console.error(`[release:windows] unsupported release type "${releaseType}". Use one of: ${[...allowedReleaseTypes].join(', ')}`);
  process.exit(1);
}

const run = (command, args, options = {}) => {
  const commandLabel = [command, ...args].join(' ');
  console.log(`[release:windows] $ ${commandLabel}`);

  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    if (options.capture && result.stderr) {
      process.stderr.write(result.stderr);
    }
    throw new Error(`command failed (${result.status}): ${commandLabel}`);
  }

  return options.capture ? result.stdout.trim() : '';
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readAppVersion = () => JSON.parse(readFileSync(packageJsonPath, 'utf8')).version;

const getGitStatus = () => run('git', ['status', '--porcelain'], { capture: true });

const getCurrentBranch = () => run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { capture: true });

const getWorkflowRunId = async (tagName) => {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const rawRuns = run(
      'gh',
      [
        'run',
        'list',
        '--workflow',
        workflowFile,
        '--event',
        'push',
        '--json',
        'databaseId,headBranch,status,conclusion,url,createdAt',
        '--limit',
        '20',
      ],
      { capture: true },
    );

    const runs = JSON.parse(rawRuns);
    const matchingRun = runs.find((entry) => entry.headBranch === tagName);
    if (matchingRun) {
      console.log(`[release:windows] matched GitHub Actions run ${matchingRun.databaseId} (${matchingRun.url})`);
      return String(matchingRun.databaseId);
    }

    await sleep(5000);
  }

  throw new Error(`timed out waiting for GitHub Actions run for tag ${tagName}`);
};

const ensureCleanWorkingTree = () => {
  const status = getGitStatus();
  if (status) {
    throw new Error('working tree must be clean before releasing. Commit or stash your changes first.');
  }
};

const ensureGitHubCliAvailable = () => {
  run('gh', ['auth', 'status']);
};

const commitVersionBump = (tagName) => {
  const message = [
    `Cut ${tagName} for a new Windows setup release`,
    '',
    'Bump the app version before tagging so the generated Windows installer and release assets map to a unique semver release.',
    '',
    'Constraint: Windows setup builds are produced on GitHub Actions from versioned tags',
    'Rejected: Reuse the previous app version for another setup build | release assets and installed versions become ambiguous',
    'Confidence: high',
    'Scope-risk: narrow',
    'Reversibility: clean',
    'Directive: Run `npm run release:windows` from a clean working tree for future Windows setup releases',
    'Tested: Version bump, tag, push, and GitHub Actions release automation path',
    'Not-tested: Local Squirrel installer generation on macOS',
  ].join('\n');

  run('git', ['add', 'package.json', 'package-lock.json']);
  run('git', ['commit', '-m', message]);
};

const downloadReleaseAssets = (tagName) => {
  const targetDir = path.join(repoRoot, 'out', 'github-actions', 'releases', tagName);
  mkdirSync(targetDir, { recursive: true });
  run('gh', ['release', 'download', tagName, '--dir', targetDir, '--clobber']);

  console.log(`[release:windows] downloaded release assets to ${targetDir}`);
};

const main = async () => {
  ensureCleanWorkingTree();
  ensureGitHubCliAvailable();

  const branch = getCurrentBranch();
  if (!branch || branch === 'HEAD') {
    throw new Error('release automation requires a checked out branch.');
  }

  run('npm', ['version', releaseType, '--no-git-tag-version']);

  const version = readAppVersion();
  const tagName = `v${version}`;

  commitVersionBump(tagName);
  run('git', ['tag', tagName]);
  run('git', ['push', 'origin', branch, tagName]);

  const workflowRunId = await getWorkflowRunId(tagName);
  run('gh', ['run', 'watch', workflowRunId, '--exit-status']);
  downloadReleaseAssets(tagName);

  console.log(`[release:windows] release complete: ${tagName}`);
};

main().catch((error) => {
  console.error(`[release:windows] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

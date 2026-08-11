// Build version for the footer, derived from git at BUILD time only.
// Deterministic per commit (STANDARDS 7.8): commit date plus short SHA,
// never wall clock. A dirty tree or a git failure renders dev-local so
// a local build can never impersonate a release.
import { execSync } from 'node:child_process';

function git(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

export function buildVersion(): string {
  try {
    if (git('git status --porcelain')) return 'dev-local';
    const sha = git('git rev-parse --short HEAD');
    const date = git('git show -s --format=%cs HEAD');
    return `v${date}-${sha}`;
  } catch {
    return 'dev-local';
  }
}

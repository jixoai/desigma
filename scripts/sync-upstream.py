#!/usr/bin/env python3
"""Merge upstream in an isolated worktree; never reset or rebase the browser branch."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
CONFIG = Path('.github/upstream.json')


def git(root, *args, check=True):
    result = subprocess.run(['git', *map(str, args)], cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f'git {args[0]} failed')
    return result


def sha(root, ref):
    return git(root, 'rev-parse', '--verify', f'{ref}^{{commit}}').stdout.strip()


def ancestor(root, older, newer):
    result = git(root, 'merge-base', '--is-ancestor', older, newer, check=False)
    if result.returncode not in (0, 1):
        raise RuntimeError(result.stderr.strip())
    return result.returncode == 0


def clean(root):
    if git(root, 'status', '--porcelain', '--untracked-files=normal').stdout:
        raise RuntimeError(f'Commit or stash changes in {root} before preparing or recording a sync.')


def load(root):
    config = json.loads((root / CONFIG).read_text())
    for branch in (config['fork']['branch'], config['fork']['mirror'], config['upstream']['branch']):
        git(root, 'check-ref-format', '--branch', branch)
    if config['fork']['branch'] == config['fork']['mirror']:
        raise RuntimeError('The browser maintenance branch and upstream mirror must differ.')
    return config


def remote_key(url):
    return url.removesuffix('/').removesuffix('.git').replace('git@github.com:', 'https://github.com/')


def configure(root, config):
    for name, details in [('origin', config['fork']), ('upstream', config['upstream'])]:
        old = git(root, 'remote', 'get-url', name, check=False)
        if old.returncode:
            git(root, 'remote', 'add', name, details['url'])
        elif remote_key(old.stdout.strip()) != remote_key(details['url']):
            raise RuntimeError(f'{name} must point to {details["url"]}; refusing to replace an existing remote.')
    # Explicitly prevent an accidental push to the original project.
    git(root, 'remote', 'set-url', '--push', 'upstream', 'DISABLED')
    if remote_key(git(root, 'remote', 'get-url', '--push', 'origin').stdout.strip()) != remote_key(config['fork']['url']):
        raise RuntimeError('origin has an unexpected push URL; refusing to push.')
    git(root, 'config', 'remote.pushDefault', 'origin')


def fetch(root, config):
    configure(root, config)
    for name, branches in [('upstream', [config['upstream']['branch']]),
                           ('origin', [config['fork']['branch'], config['fork']['mirror']])]:
        git(root, 'fetch', '--no-tags', name, *[f'+refs/heads/{b}:refs/remotes/{name}/{b}' for b in branches])


def refs(config):
    return f'origin/{config["fork"]["branch"]}', f'upstream/{config["upstream"]["branch"]}'


def status(root, config):
    base, upstream = refs(config)
    old = config['upstream']['revision']
    if not ancestor(root, old, base):
        raise RuntimeError('Recorded upstream revision is not contained in the maintenance branch.')
    return {'maintenance': sha(root, base), 'upstream': sha(root, upstream), 'recorded': old,
            'upstream_commits_pending': int(git(root, 'rev-list', '--count', f'{base}..{upstream}').stdout),
            'fork_commits': int(git(root, 'rev-list', '--count', f'{upstream}..{base}').stdout)}


def record(root, revision):
    clean(root)
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise RuntimeError('Use the full 40-character upstream commit printed by prepare.')
    if not ancestor(root, revision, 'HEAD'):
        raise RuntimeError('Finish the upstream merge before recording its revision.')
    config = load(root)
    if config['upstream']['revision'] == revision:
        return
    if not ancestor(root, config['upstream']['revision'], revision):
        raise RuntimeError('Refusing to move the recorded upstream revision backwards or across rewritten history.')
    config['upstream']['revision'] = revision
    (root / CONFIG).write_text(json.dumps(config, indent=2) + '\n')
    git(root, 'add', '--', CONFIG)
    git(root, 'commit', '-m', f'chore: record upstream synchronization at {revision[:12]}')


def prepare(root, config, destination, branch=None):
    clean(root)
    base, upstream = refs(config)
    revision = sha(root, upstream)
    base_sha = sha(root, base)
    if ancestor(root, revision, base_sha):
        return {'state': 'current', 'revision': revision}
    if not ancestor(root, config['upstream']['revision'], revision):
        raise RuntimeError('Upstream history diverged from the recorded revision; inspect it before merging.')
    branch = branch or f'sync/upstream-{revision[:12]}'
    if not branch.startswith('sync/upstream-'):
        raise RuntimeError('Use a sync/upstream-* branch, not a maintenance or mirror branch.')
    git(root, 'check-ref-format', '--branch', branch)
    if git(root, 'show-ref', '--verify', f'refs/remotes/origin/{branch}', check=False).returncode == 0:
        raise RuntimeError(f'{branch} already exists on origin; continue that sync instead of overwriting it.')
    published = git(root, 'ls-remote', '--exit-code', '--heads', 'origin', f'refs/heads/{branch}', check=False)
    if published.returncode == 0:
        raise RuntimeError(f'{branch} already exists on origin; continue that sync instead of overwriting it.')
    if published.returncode != 2:
        raise RuntimeError(published.stderr.strip() or 'Cannot check for an existing sync branch on origin.')
    git(root, 'worktree', 'add', '-b', branch, destination, base_sha)
    merge = git(destination, 'merge', '--no-ff', '-m', f'merge: upstream {config["upstream"]["branch"]} at {revision[:12]}', revision, check=False)
    result = {'state': 'ready', 'branch': branch, 'worktree': str(destination), 'base': base_sha, 'revision': revision}
    if merge.returncode:
        result['state'] = 'conflicts'
        result['files'] = git(destination, 'diff', '--name-only', '--diff-filter=U').stdout.splitlines()
        result['error'] = merge.stderr.strip() or merge.stdout.strip()
        return result
    record(destination, revision)
    return result


def mirror(root, config):
    configure(root, config)
    source = sha(root, refs(config)[1])
    target = f'origin/{config["fork"]["mirror"]}'
    if not ancestor(root, target, source):
        raise RuntimeError('Fork main contains its own changes or diverged. Refusing to overwrite it.')
    if sha(root, target) != source:
        # A normal push also rejects a concurrent update; no force option is used.
        git(root, 'push', 'origin', f'{source}:refs/heads/{config["fork"]["mirror"]}')
    return {'state': 'mirrored', 'revision': source}


def scope(root):
    config = load(root)
    maintenance = config.get('maintenance', {})
    if maintenance.get('target') != 'wasm32-unknown-unknown':
        raise RuntimeError('This fork maintains only the wasm32-unknown-unknown target.')
    excluded = set(maintenance.get('excluded_workflows', [])) | {'.github/workflows/ci.yml', '.github/workflows/release.yml'}
    restored = [path for path in sorted(excluded) if (root / path).exists()]
    if restored:
        raise RuntimeError('Upstream restored desktop automation outside this fork’s maintenance scope: ' + ', '.join(restored))


def check(root):
    scope(root)
    commands = [
        ['cargo', 'fmt', '--all', '--check'],
        ['cargo', 'clippy', '--locked', '-p', 'desigma-app', '--lib', '--target', 'wasm32-unknown-unknown', '--no-default-features', '--', '-D', 'warnings'],
        ['npm', 'ci', '--prefix', 'web', '--ignore-scripts'], ['npm', 'test', '--prefix', 'web'],
        ['npm', 'ci', '--prefix', 'web/signaling', '--ignore-scripts'], ['npm', 'test', '--prefix', 'web/signaling'],
        [sys.executable, '-m', 'unittest', 'discover', '-s', 'scripts/tests', '-v'],
        [sys.executable, 'scripts/build-web.py'],
    ]
    for command in commands:
        print('+', ' '.join(command), flush=True)
        subprocess.run(command, cwd=root, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    sub = parser.add_subparsers(dest='command', required=True)
    inspect = sub.add_parser('status', help='Compare fetched remote refs; --fetch updates them first')
    inspect.add_argument('--fetch', action='store_true')
    merge = sub.add_parser('prepare', help='Fetch and merge in a new worktree; never pushes')
    merge.add_argument('--worktree', type=Path, required=True)
    merge.add_argument('--branch')
    finish = sub.add_parser('record', help='Record provenance after manually resolving and committing a conflicted merge')
    finish.add_argument('--revision', required=True)
    sub.add_parser('mirror-main', help='Fetch and fast-forward ONLY the fork main mirror; never force pushes')
    sub.add_parser('scope', help='Reject reintroduced desktop automation in this WASM-only fork')
    sub.add_parser('check', help='Run WASM/browser validation and the optimized static build in this checkout')
    args = parser.parse_args()
    root = args.root.resolve()
    config = load(root)
    if args.command in ('prepare', 'mirror-main') or getattr(args, 'fetch', False):
        fetch(root, config)
    if args.command == 'status':
        result = status(root, config)
    elif args.command == 'prepare':
        result = prepare(root, config, args.worktree.resolve(), args.branch)
    elif args.command == 'record':
        record(root, args.revision)
        result = {'state': 'recorded', 'revision': args.revision}
    elif args.command == 'mirror-main':
        result = mirror(root, config)
    elif args.command == 'scope':
        scope(root)
        result = {'state': 'wasm-only'}
    else:
        check(root)
        result = {'state': 'validated'}
    print(json.dumps(result, indent=2))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            for key in ('state', 'branch', 'revision', 'base'):
                if key in result:
                    output.write(f'{key}={result[key]}\n')
    if result.get('state') == 'conflicts':
        print(f'Resolve the listed files in {result["worktree"]}, commit the merge, then run:\n'
              f'python3 scripts/sync-upstream.py record --revision {result["revision"]}\n'
              'python3 scripts/sync-upstream.py check\n'
              'Or run git merge --abort in that worktree to abandon the merge.', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

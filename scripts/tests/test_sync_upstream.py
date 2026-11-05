"""Exercise real Git histories, remotes, conflicts and pushes in temporary repositories."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('sync_upstream', Path(__file__).resolve().parents[1] / 'sync-upstream.py')
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'upstream-source'
        self.source.mkdir()
        sync.git(self.source, 'init', '-b', 'main')
        self.identity(self.source)
        self.commit(self.source, 'shared.txt', 'original\n')
        self.base = sync.sha(self.source, 'HEAD')
        self.upstream = self.root / 'upstream.git'
        self.fork = self.root / 'fork.git'
        self.client = self.root / 'client'
        sync.git(self.root, 'clone', '--bare', self.source, self.upstream)
        sync.git(self.source, 'remote', 'add', 'origin', self.upstream)
        sync.git(self.root, 'clone', '--bare', self.upstream, self.fork)
        sync.git(self.root, 'clone', self.fork, self.client)
        self.identity(self.client)
        sync.git(self.client, 'switch', '-c', 'browser-wasm')
        self.config = {
            'fork': {'url': str(self.fork), 'branch': 'browser-wasm', 'mirror': 'main'},
            'upstream': {'url': str(self.upstream), 'branch': 'main', 'revision': self.base},
            'maintenance': {'target': 'wasm32-unknown-unknown', 'excluded_workflows': []},
        }
        self.commit(self.client, '.github/upstream.json', json.dumps(self.config))
        self.commit(self.client, 'web/browser.js', 'browser implementation\n')
        sync.git(self.client, 'push', '-u', 'origin', 'browser-wasm')
        sync.fetch(self.client, self.config)
        self.destination = self.root / 'integration'

    def identity(self, repo):
        sync.git(repo, 'config', 'user.name', 'Sync test')
        sync.git(repo, 'config', 'user.email', 'sync-test@example.invalid')
        sync.git(repo, 'config', 'commit.gpgsign', 'false')

    def commit(self, repo, file, text):
        path = repo / file
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        sync.git(repo, 'add', '--', file)
        sync.git(repo, 'commit', '-m', f'change {file}')

    def advance(self, file='upstream-new.txt', text='new upstream behavior\n'):
        self.commit(self.source, file, text)
        sync.git(self.source, 'push', 'origin', 'main')
        sync.fetch(self.client, self.config)
        return sync.sha(self.source, 'HEAD')

    def test_merge_preserves_both_histories_and_only_modifies_new_worktree(self):
        local = sync.sha(self.client, 'HEAD')
        revision = self.advance()
        result = sync.prepare(self.client, self.config, self.destination)
        self.assertEqual(result['state'], 'ready')
        self.assertEqual(sync.sha(self.client, 'HEAD'), local)
        self.assertEqual(sync.sha(self.fork, 'browser-wasm'), local)
        self.assertEqual(sync.sha(self.fork, 'main'), self.base)
        self.assertTrue(sync.ancestor(self.destination, local, 'HEAD'))
        self.assertTrue(sync.ancestor(self.destination, revision, 'HEAD'))
        self.assertEqual((self.destination / 'web/browser.js').read_text(), 'browser implementation\n')
        self.assertEqual(sync.load(self.destination)['upstream']['revision'], revision)
        self.assertEqual(sync.git(self.destination, 'status', '--porcelain').stdout, '')

    def test_no_update_creates_no_branch_or_worktree(self):
        before = sync.git(self.client, 'branch', '--format=%(refname)').stdout
        result = sync.prepare(self.client, self.config, self.destination)
        self.assertEqual(result['state'], 'current')
        self.assertFalse(self.destination.exists())
        self.assertEqual(sync.git(self.client, 'branch', '--format=%(refname)').stdout, before)

    def test_conflict_keeps_recoverable_merge_without_touching_maintenance(self):
        self.commit(self.client, 'shared.txt', 'browser change\n')
        sync.git(self.client, 'push', 'origin', 'browser-wasm')
        local = sync.sha(self.client, 'HEAD')
        self.advance('shared.txt', 'upstream change\n')
        result = sync.prepare(self.client, self.config, self.destination)
        self.assertEqual(result['state'], 'conflicts')
        self.assertEqual(result['files'], ['shared.txt'])
        self.assertEqual(sync.sha(self.client, 'HEAD'), local)
        self.assertEqual(sync.load(self.destination)['upstream']['revision'], self.base)
        self.assertIn('<<<<<<<', (self.destination / 'shared.txt').read_text())
        sync.git(self.destination, 'merge', '--abort')
        self.assertEqual(sync.sha(self.destination, 'HEAD'), local)

    def test_mirror_fast_forwards_main_and_refuses_fork_changes(self):
        local = sync.sha(self.fork, 'browser-wasm')
        revision = self.advance()
        sync.mirror(self.client, self.config)
        self.assertEqual(sync.sha(self.fork, 'main'), revision)
        self.assertEqual(sync.sha(self.fork, 'browser-wasm'), local)
        sync.fetch(self.client, self.config)
        sync.git(self.client, 'switch', '-c', 'fork-main', 'origin/main')
        self.commit(self.client, 'own-change.txt', 'must not be discarded\n')
        sync.git(self.client, 'push', 'origin', 'HEAD:main')
        divergent = sync.sha(self.fork, 'main')
        sync.git(self.client, 'switch', 'browser-wasm')
        self.advance('another-upstream.txt', 'another change\n')
        with self.assertRaisesRegex(RuntimeError, 'Refusing to overwrite'):
            sync.mirror(self.client, self.config)
        self.assertEqual(sync.sha(self.fork, 'main'), divergent)

    def test_dirty_checkout_is_not_stashed_or_discarded(self):
        self.advance()
        (self.client / 'shared.txt').write_text('unfinished edit\n')
        with self.assertRaisesRegex(RuntimeError, 'Commit or stash'):
            sync.prepare(self.client, self.config, self.destination)
        self.assertFalse(self.destination.exists())
        self.assertEqual((self.client / 'shared.txt').read_text(), 'unfinished edit\n')

    def test_wrong_remote_is_not_replaced_and_upstream_push_is_disabled(self):
        self.assertEqual(sync.git(self.client, 'remote', 'get-url', '--push', 'upstream').stdout.strip(), 'DISABLED')
        sync.git(self.client, 'remote', 'set-url', 'origin', self.upstream)
        with self.assertRaisesRegex(RuntimeError, 'refusing to replace'):
            sync.configure(self.client, self.config)
        self.assertEqual(sync.git(self.client, 'remote', 'get-url', 'origin').stdout.strip(), str(self.upstream))

    def test_record_rejects_unmerged_revision_and_protected_branch_name(self):
        revision = self.advance()
        with self.assertRaisesRegex(RuntimeError, 'Finish the upstream merge'):
            sync.record(self.client, revision)
        with self.assertRaisesRegex(RuntimeError, 'sync/upstream-'):
            sync.prepare(self.client, self.config, self.destination, 'browser-wasm')
        self.assertEqual(sync.load(self.client)['upstream']['revision'], self.base)

    def test_existing_sync_branch_is_not_overwritten(self):
        revision = self.advance()
        name = f'sync/upstream-{revision[:12]}'
        sync.git(self.client, 'push', 'origin', f'HEAD:refs/heads/{name}')
        sync.git(self.client, 'update-ref', '-d', f'refs/remotes/origin/{name}')
        with self.assertRaisesRegex(RuntimeError, 'already exists'):
            sync.prepare(self.client, self.config, self.destination)
        self.assertFalse(self.destination.exists())

    def test_scope_blocks_upstream_reintroducing_desktop_workflows(self):
        sync.scope(self.client)
        self.commit(self.client, '.github/workflows/ci.yml', 'name: Desktop CI\n')
        with self.assertRaisesRegex(RuntimeError, 'desktop automation'):
            sync.scope(self.client)
        (self.client / '.github/workflows/ci.yml').unlink()
        self.commit(self.client, '.github/workflows/release.yml', 'name: Desktop Release\n')
        with self.assertRaisesRegex(RuntimeError, 'desktop automation'):
            sync.scope(self.client)

    def test_scope_requires_the_wasm_target(self):
        config = sync.load(self.client)
        config['maintenance']['target'] = 'x86_64-unknown-linux-gnu'
        (self.client / sync.CONFIG).write_text(json.dumps(config))
        with self.assertRaisesRegex(RuntimeError, 'only the wasm32'):
            sync.scope(self.client)


if __name__ == '__main__':
    unittest.main()

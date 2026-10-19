#!/usr/bin/env python3
"""Exercise patch regeneration against disposable Git repositories only."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

EXISTING = (
    'application.go', 'application_linux.go', 'application_linux_gtk3.go',
    'application_options.go', 'application_server.go', 'linux_cgo.c', 'linux_cgo.go',
    'linux_cgo.h', 'linux_cgo_gtk3.go', 'webview_window_darwin.go',
)
NEW = (
    'webview_storage.go', 'webview_storage_unix.go', 'webview_storage_other.go',
    'webview_storage_darwin.go', 'webview_storage_darwin.h', 'webview_storage_darwin.m',
    'webview_storage_test.go', 'webview_storage_unix_test.go',
    'webview_storage_darwin_test.go', 'webview_storage_linux_test.go',
    'webview_storage_server_test.go', 'application_server_middleware_test.go',
)


class ExportPatchTest(unittest.TestCase):
    def test_reviewed_base_produces_same_export_in_every_git_state(self):
        with tempfile.TemporaryDirectory(prefix='nativepatch-export-') as directory:
            root = Path(directory)
            source_repo = root / 'source'
            source = source_repo / 'v3'
            pristine = root / 'beta29'
            output_repo = root / 'output'
            for repo in (source_repo, output_repo):
                repo.mkdir()
                self.git(repo, 'init', '-q')
                self.git(repo, 'config', 'user.email', 'fixture@example.invalid')
                self.git(repo, 'config', 'user.name', 'Export fixture')
            source.mkdir()
            exporter = output_repo / 'scripts/nativepatch/export_patch.py'
            exporter.parent.mkdir(parents=True)
            shutil.copyfile(Path(__file__).with_name('export_patch.py'), exporter)
            self.git(output_repo, 'add', '.')
            self.git(output_repo, 'commit', '-qm', 'fixture exporter')
            for name in EXISTING:
                relative = Path('pkg/application') / name
                for tree in (source, pristine):
                    path = tree / relative
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(f'// {name}\noriginal\n')
            (pristine / 'LICENSE').write_text('fixture license\n')
            self.git(source, 'add', '.')
            self.git(source, 'commit', '-qm', 'reviewed base')
            base = self.git(source, 'rev-parse', 'HEAD').strip()
            for name in EXISTING:
                (source / 'pkg/application' / name).write_text(f'// {name}\nreviewed\n')
            for name in NEW:
                (source / 'pkg/application' / name).write_text(f'// {name}\nnew reviewed file\n')
            # Changes outside the exact reviewed inventory must never leak into the export.
            (source / 'unrelated.txt').write_text('not exported\n')
            command = [sys.executable, str(exporter), '--reviewed-source', str(source),
                       '--reviewed-base', base, '--beta29-source', str(pristine)]
            snapshots = []
            for state in ('unstaged', 'staged', 'committed'):
                if state == 'staged':
                    self.git(source, 'add', '.')
                elif state == 'committed':
                    self.git(source, 'commit', '-qm', 'reviewed changes')
                result = subprocess.run(command, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, f'{state}: {result.stderr}')
                patches = exporter.parent / 'patches'
                snapshots.append({p.name: p.read_bytes() for p in patches.iterdir()})
            self.assertEqual(snapshots[0], snapshots[1])
            self.assertEqual(snapshots[0], snapshots[2])
            manifest = json.loads(snapshots[0]['manifest.json'])
            expected = {f'pkg/application/{name}' for name in EXISTING + NEW}
            self.assertEqual({item['path'] for item in manifest['files']}, expected)
            self.assertEqual(manifest['patchSHA256'], hashlib.sha256(
                snapshots[0]['native-storage.patch']).hexdigest())
            self.assertEqual(snapshots[0]['WAILS-LICENSE'], b'fixture license\n')
            for item in manifest['files']:
                self.assertEqual(item['after'], hashlib.sha256((source / item['path']).read_bytes()).hexdigest())
            # Apply the actual exported patch, rather than merely comparing metadata.
            subprocess.run(['git', 'apply', str(patches / 'native-storage.patch')],
                           cwd=pristine, check=True, capture_output=True)
            for relative in expected:
                self.assertEqual((pristine / relative).read_bytes(), (source / relative).read_bytes())
            wrong_base = self.git(source, 'rev-parse', 'HEAD').strip()
            wrong_command = command.copy()
            wrong_command[wrong_command.index('--reviewed-base') + 1] = wrong_base
            result = subprocess.run(wrong_command, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0, 'already-patched base was accepted')
            self.assertIn('base', result.stderr.lower())
            self.assertEqual(snapshots[0], {p.name: p.read_bytes() for p in patches.iterdir()})

    @staticmethod
    def git(root, *arguments):
        return subprocess.check_output(['git', *arguments], cwd=root, text=True)


if __name__ == '__main__':
    unittest.main()

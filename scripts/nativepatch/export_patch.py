#!/usr/bin/env python3
"""Export only the reviewed native-storage changes onto exact beta29 preimages.

Maintainer operation, not part of bootstrap. Requires the reviewed Wails working
copy, its explicit pre-change commit, and pristine beta29 source; changes neither input.
"""
import argparse
import difflib
import hashlib
import json
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--reviewed-source', required=True, type=Path)
parser.add_argument('--reviewed-base', required=True,
                    help='Full reviewed pre-change commit ID (not a moving branch or tag)')
parser.add_argument('--beta29-source', required=True, type=Path)
args = parser.parse_args()
existing = ['application.go', 'application_linux.go', 'application_linux_gtk3.go',
            'application_options.go', 'application_server.go', 'linux_cgo.c', 'linux_cgo.go', 'linux_cgo.h',
            'linux_cgo_gtk3.go', 'webview_window_darwin.go']
if not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', args.reviewed_base):
    raise SystemExit('Reviewed base must be a full commit ID')
try:
    base = subprocess.check_output(
        ['git', 'rev-parse', '--verify', args.reviewed_base + '^{commit}'],
        cwd=args.reviewed_source, text=True).strip()
    subprocess.run(['git', 'merge-base', '--is-ancestor', base, 'HEAD'],
                   cwd=args.reviewed_source, check=True)
except subprocess.CalledProcessError:
    raise SystemExit('Reviewed base must be an existing ancestor commit of reviewed source')
delta = subprocess.check_output(
    ['git', 'diff', '--no-ext-diff', '--no-textconv', '--no-renames',
     '--relative', '--unified=3', base, '--',
     *[f'pkg/application/{name}' for name in existing]],
    cwd=args.reviewed_source, text=True)
patched = {}
for part in re.split(r'(?=^diff --git )', delta, flags=re.M):
    if not part:
        continue
    name = re.search(r'^\+\+\+ b/(?:v3/)?(.+)$', part, re.M).group(1)
    text = (args.beta29_source / name).read_text()
    for hunk in re.split(r'^@@[^\n]*\n', part, flags=re.M)[1:]:
        lines = hunk.splitlines(keepends=True)
        before = ''.join(line[1:] for line in lines if line[:1] in (' ', '-'))
        after = ''.join(line[1:] for line in lines if line[:1] in (' ', '+'))
        if text.count(before) != 1:
            raise SystemExit(f'{name}: reviewed hunk has no unique beta29 preimage')
        text = text.replace(before, after, 1)
    patched[name] = text.encode()
if len(patched) != len(existing):
    raise SystemExit('Reviewed base tracked change inventory is incomplete')
# Explicitly enumerate new files: git diff alone omits untracked source/tests.
new_files = ['webview_storage.go', 'webview_storage_unix.go',
             'webview_storage_other.go', 'webview_storage_darwin.go',
             'webview_storage_darwin.h', 'webview_storage_darwin.m',
             'webview_storage_test.go', 'webview_storage_unix_test.go',
             'webview_storage_darwin_test.go', 'webview_storage_linux_test.go',
             'webview_storage_server_test.go', 'application_server_middleware_test.go']
base_files = subprocess.check_output(
    ['git', 'ls-tree', '-r', '--name-only', base, '--',
     *[f'pkg/application/{name}' for name in existing + new_files]],
    cwd=args.reviewed_source, text=True).splitlines()
if set(base_files) != {f'pkg/application/{name}' for name in existing}:
    raise SystemExit('Reviewed base must contain all ten existing files and none of the twelve new files')
for name in new_files:
    relative = 'pkg/application/' + name
    if (args.beta29_source / relative).exists():
        raise SystemExit(f'{relative}: expected new file, found beta29 preimage')
    patched[relative] = (args.reviewed_source / relative).read_bytes()
patch = []
files = []
for name, after in sorted(patched.items()):
    source = args.beta29_source / name
    before = source.read_bytes() if source.exists() else None
    patch.extend(difflib.unified_diff(
        (before or b'').decode().splitlines(keepends=True),
        after.decode().splitlines(keepends=True),
        fromfile='a/' + name if before is not None else '/dev/null',
        tofile='b/' + name))
    files.append({'path': name,
                  'before': hashlib.sha256(before).hexdigest() if before is not None else '',
                  'after': hashlib.sha256(after).hexdigest()})
patch_bytes = ''.join(patch).encode()
output = Path(__file__).resolve().parent / 'patches'
output.mkdir(parents=True, exist_ok=True)
(output / 'native-storage.patch').write_bytes(patch_bytes)
license_bytes = (args.beta29_source / 'LICENSE').read_bytes()
(output / 'WAILS-LICENSE').write_bytes(license_bytes)
manifest = {
    'schema': 1, 'module': 'github.com/wailsapp/wails/v3',
    'version': 'v3.0.0-beta.29',
    'sum': 'h1:oJbXasfieQmMkYtqPlFSPnDe0RwpzA5BKiov8WPD5lo=',
    'goModSum': 'h1:5DR/EG5FHU8+BNV7tQYQ/rJMjoFsVlYpM+0gp1+gcTI=',
    'patch': 'native-storage.patch',
    'patchSHA256': hashlib.sha256(patch_bytes).hexdigest(),
    'licenses': [{'path': 'LICENSE', 'sha256': hashlib.sha256(license_bytes).hexdigest(),
                  'copy': 'WAILS-LICENSE'}],
    'files': files,
}
(output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Exported {len(files)} files ({len(new_files)} new), SHA256 {manifest["patchSHA256"]}')

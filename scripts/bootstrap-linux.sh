#!/usr/bin/env bash
# Install the locked Linux closure into the machine-wide pnpm pool.
set -euo pipefail
script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
cetus_root=${CETUS_ROOT:-$(dirname -- "$script_dir")}
dependency_root=${CETUS_DEPENDENCY_ROOT:-${DEP_CACHE:-$HOME/dependency-cache}}
node_bin=${CETUS_NODE_BIN:-node}
bootstrap_dev=${CETUS_BOOTSTRAP_DEV:-false}
if [[ $(uname -s) != Linux || ! -d "$dependency_root/pnpm/store" ]]; then
  printf '%s\n' 'bootstrap-linux: Linux and the existing shared pnpm store are required.' >&2
  exit 1
fi
export COREPACK_HOME="$dependency_root/npm-cache/corepack"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export CI="${CI:-true}"
export npm_config_cache="$dependency_root/npm-cache"
export npm_config_devdir="$dependency_root/pnpm/node-gyp"
export npm_config_nodedir=${CETUS_NODE_HEADERS_ROOT:-/usr}
export XDG_CACHE_HOME="$dependency_root/npm-cache/xdg"
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export PUPPETEER_SKIP_DOWNLOAD=true
export CMAKE_BUILD_PARALLEL_LEVEL=2
export npm_config_jobs=2
export TMPDIR="$dependency_root/tmp"
mkdir -p -- "$TMPDIR" "$COREPACK_HOME" "$dependency_root/pnpm/virtual"
# Link farms contain package pointers and pnpm metadata only; package payloads
# are shared by every consumer in pnpm/virtual.
python3 - "$cetus_root" "$dependency_root" <<'PY'
import glob, hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1]).resolve()
cache = pathlib.Path(sys.argv[2]).resolve()
farm = cache / 'pnpm' / 'links' / hashlib.sha256(str(root).encode()).hexdigest()[:16]
manifest = json.loads((root / 'package.json').read_text())
paths = {root}
for pattern in manifest['workspaces'] + ['benchmarks', 'python/sdk-runtime']:
    paths.update(pathlib.Path(p) for p in glob.glob(str(root / pattern)) if (pathlib.Path(p) / 'package.json').is_file())
for path in sorted(paths):
    pointer = path / 'node_modules'
    target = farm / path.relative_to(root) / 'node_modules'
    target.mkdir(parents=True, exist_ok=True)
    if pointer.is_symlink():
        if pointer.resolve() != target:
            if not pointer.resolve().is_relative_to(cache / 'pnpm/links'):
                raise SystemExit(f'bootstrap-linux: existing link points elsewhere: {pointer}')
            pointer.unlink()
            pointer.symlink_to(target, target_is_directory=True)
    elif pointer.exists():
        raise SystemExit(f'bootstrap-linux: refusing existing non-link: {pointer}')
    else:
        pointer.symlink_to(target, target_is_directory=True)
print(f'bootstrap-linux: link farm {farm}')
PY
cd -- "$cetus_root"
pnpm_args=(--config.store-dir="$dependency_root/pnpm/store"
  --config.virtual-store-dir="$dependency_root/pnpm/virtual")
# The production mode keeps the installed closure small. Development mode
# links the complete workspace toolchain from the same shared store so Linux
# builds can run without a project-local dependency payload.
if [[ "$bootstrap_dev" == true ]]; then
  corepack pnpm@11.7.0 "${pnpm_args[@]}" \
    install --frozen-lockfile --ignore-scripts
else
  corepack pnpm@11.7.0 "${pnpm_args[@]}" --filter '@deepseek-ai/dsh...' \
    install --prod --frozen-lockfile --ignore-scripts
fi
corepack pnpm@11.7.0 "${pnpm_args[@]}" --filter '@deepseek-ai/dsh...' \
  --recursive rebuild node-pty koffi esbuild
# Source launch uses the already available reviewed ESM hook. Refuse a missing
# or mismatched hook instead of silently introducing another toolchain.
python3 - "$cetus_root" "$dependency_root" <<'PY'
import json, pathlib, re, sys
root, cache = map(pathlib.Path, sys.argv[1:])
source = cache / 'shared/node_modules/tsx'
if not source.is_dir() or json.loads((source / 'package.json').read_text())['version'] != '4.22.4':
    raise SystemExit('bootstrap-linux: shared tsx@4.22.4 is required')
pointer = root / 'node_modules/tsx'
if pointer.is_symlink():
    resolved = pointer.resolve()
    if not resolved.is_relative_to(cache) or not (resolved / 'package.json').is_file():
        raise SystemExit('bootstrap-linux: tsx points elsewhere')
    if json.loads((resolved / 'package.json').read_text())['version'] != '4.22.4':
        raise SystemExit('bootstrap-linux: shared tsx@4.22.4 is required')
elif pointer.exists():
    raise SystemExit('bootstrap-linux: refusing to overwrite tsx')
else:
    pointer.symlink_to(source, target_is_directory=True)

# The project node_modules directory is a link into the shared link farm.
# pnpm's generated .bin shims otherwise calculate a relative virtual-store
# path from the visible project path and can escape the dependency store. Pin
# each generated shim to the absolute shared target recorded in its footer.
farm = cache / 'pnpm' / 'links' / __import__('hashlib').sha256(str(root).encode()).hexdigest()[:16]
for shim in farm.rglob('.bin/*'):
    if not shim.is_file():
        continue
    try:
        lines = shim.read_text().splitlines(keepends=True)
    except UnicodeDecodeError:
        continue
    target = next((line.strip().removeprefix('# cmd-shim-target=') for line in lines
                   if line.startswith('# cmd-shim-target=')), None)
    if target is None or '/virtual/' not in target:
        continue
    rewritten = []
    changed = False
    for line in lines:
        for marker in ('$basedir/', '$basedir_win/'):
            updated = re.sub(rf'"{re.escape(marker)}[^"]*"', '"' + target + '"', line)
            changed = changed or updated != line
            line = updated
        # Direct executable shims carry the target once as argv[0] and once
        # as the script path. After absolutizing both expressions, collapse
        # the duplicated script argument; otherwise `tsc -b` sees a path
        # before `-b` and rejects the build-mode flag.
        before_collapse = line
        line = re.sub(r'^(\s*exec "[^"]+")\s+"[^"]+"\s+"\$@"$', r'\1 "$@"', line.rstrip('\n')) + ('\n' if line.endswith('\n') else '')
        changed = changed or line != before_collapse
        rewritten.append(line)
    if changed:
        shim.write_text(''.join(rewritten))
manager = cache / 'npm-cache/corepack/v1/pnpm/11.7.0/bin/pnpm.mjs'
bin_dir = cache / 'pnpm/bin'
bin_dir.mkdir(exist_ok=True)
pnpm = bin_dir / 'pnpm'
if pnpm.is_symlink():
    if pnpm.resolve() != manager.resolve():
        raise SystemExit('bootstrap-linux: shared pnpm executable points elsewhere')
elif pnpm.exists():
    raise SystemExit('bootstrap-linux: refusing to overwrite the shared pnpm executable')
else:
    pnpm.symlink_to(manager)
PY
"$node_bin" --import "$cetus_root/node_modules/tsx/dist/esm/index.mjs" \
  "$cetus_root/native/system/scripts/build.ts" --host-addon-only
if [[ "$bootstrap_dev" == true ]]; then
  printf '%s\n' "bootstrap-linux: development workspace ready; dsh launcher is $cetus_root/scripts/dsh-linux"
else
  printf '%s\n' "bootstrap-linux: production closure ready; dsh launcher is $cetus_root/scripts/dsh-linux"
fi

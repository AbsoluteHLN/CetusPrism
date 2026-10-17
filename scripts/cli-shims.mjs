#!/usr/bin/env node
/**
 * Write the installed CLI launchers under a desktop payload's `bin`
 * directory. The cmd launcher uses physical CRLF bytes because Windows
 * command parsing is codepage-sensitive there; the POSIX launcher stays LF.
 * @module scripts/cli-shims
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CMD_SHIM = [
  '@echo off',
  '"%~dp0..\\resources\\app\\backend\\node.exe" "%~dp0..\\resources\\app\\backend\\runtime\\lib\\bin.js" %*',
].join('\r\n') + '\r\n'

const SH_SHIM = [
  '#!/bin/sh',
  'DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
  'exec "$DIR/../resources/app/backend/node.exe" "$DIR/../resources/app/backend/runtime/lib/bin.js" "$@"',
].join('\n') + '\n'

/**
 * Create `dsh.cmd` and `dsh` for cmd/PowerShell and Git Bash respectively.
 * @param {string} binDir Absolute directory that receives both launchers.
 * @returns {void}
 */
export function writeCliShims(binDir) {
  mkdirSync(binDir, { recursive: true })
  writeFileSync(join(binDir, 'dsh.cmd'), CMD_SHIM)
  writeFileSync(join(binDir, 'dsh'), SH_SHIM, { mode: 0o755 })
}

/** Build and dispatch one Docker command for the Windows Linux-packaging path.
 * @param command - Shell command to run inside the Linux build image.
 * @param options - Docker image, mounts, proxy, and injected process runner.
 * @returns The injected runner's result.
 */
export function invokeDockerContainer(command, options) {
  const args = [
    'run', '--rm', '-v', `${options.repoRoot}:/repo`, '-v', `${options.linuxTarget}:/target`,
    '-v', `${options.cargoRegistry}:/usr/local/cargo/registry`, '-v', `${options.linuxNode}:/node`,
    '-v', `${options.containerStore}:/store`, '-v', `${options.containerVstore}:/vstore`, '-v', `${options.outDir}:/out`,
    '-e', 'CARGO_TARGET_DIR=/target',
    '-e', 'CETUS_DIST_DIR=/out',
    '-e', 'CETUS_BUILD_ROOT=/out/build',
    '-e', 'CETUS_PACK_WORK_ROOT=/out/build/pack-work',
    '-e', 'CETUS_NODE_BIN=/node/bin/node',
    '-e', 'CETUS_PNPM_STORE=/store',
    '-e', 'CETUS_PNPM_VSTORE=/vstore',
    '-e', `HTTP_PROXY=${options.containerProxy}`,
    '-e', `HTTPS_PROXY=${options.containerProxy}`,
    '-e', 'NO_PROXY=localhost,127.0.0.1,host.docker.internal',
    '-w', '/repo', options.image, 'bash', '-c', `export PATH=/node/bin:$PATH; ${command}`,
  ]
  return options.run(options.docker, args)
}

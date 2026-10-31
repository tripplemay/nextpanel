import type { NodeSSH } from 'node-ssh';

/** ssh2's connection readyTimeout does not bound command execution. */
export async function remoteExec(ssh: NodeSSH, command: string, timeoutMs = 15000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      ssh.execCommand(command),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ssh.dispose();
          reject(new Error('Remote resource operation timed out'));
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Bound every command on the dedicated cleanup connection, including existing helpers. */
export function boundConnection(ssh: NodeSSH, timeoutMs = 30000): NodeSSH {
  const original = ssh.execCommand.bind(ssh);
  const target = { execCommand: original, dispose: () => ssh.dispose() } as NodeSSH;
  ssh.execCommand = command => remoteExec(target, command, timeoutMs);
  return ssh;
}

/**
 * SSH utility functions — pure wrappers with no side effects or DB access.
 * All functions accept a connected NodeSSH instance.
 */

import { NodeSSH } from 'node-ssh';

export interface SshConnectOptions {
  host: string;
  port: number;
  username: string;
  authType: 'KEY' | 'PASSWORD';
  auth: string;
  /** Connection timeout in ms. Default: 10000 */
  readyTimeout?: number;
}

/** Establish an SSH connection and return the connected client. */
export async function connectSsh(opts: SshConnectOptions): Promise<NodeSSH> {
  const ssh = new NodeSSH();
  const connectOpts: Parameters<NodeSSH['connect']>[0] = {
    host: opts.host,
    port: opts.port,
    username: opts.username,
    readyTimeout: opts.readyTimeout ?? 10000,
  };
  if (opts.authType === 'KEY') {
    connectOpts.privateKey = opts.auth;
  } else {
    connectOpts.password = opts.auth;
  }
  await ssh.connect(connectOpts);
  return ssh;
}

/** Upload text content to a remote path using base64 encoding. */
export async function uploadText(
  ssh: NodeSSH,
  content: string,
  remotePath: string,
  mode = 0o600,
): Promise<void> {
  const b64 = Buffer.from(content).toString('base64');
  const dir = remotePath.substring(0, remotePath.lastIndexOf('/'));
  const modeText = mode.toString(8).padStart(4, '0');
  if (!/^0[0-7]{3}$/.test(modeText)) throw new Error(`Invalid remote file mode: ${mode}`);

  const mkdir = await ssh.execCommand(`mkdir -p -- ${shellQuote(dir)}`);
  if ((mkdir.code ?? 0) !== 0) {
    throw new Error(`Unable to create remote directory ${dir}: ${mkdir.stderr || `exit ${mkdir.code}`}`);
  }

  const write = await ssh.execCommand(
    `umask 077; printf '%s' '${b64}' | base64 -d > ${shellQuote(remotePath)} && ` +
      `chmod ${modeText} -- ${shellQuote(remotePath)}`,
  );
  if ((write.code ?? 0) !== 0) {
    throw new Error(`Unable to write remote file ${remotePath}: ${write.stderr || `exit ${write.code}`}`);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Check whether a remote executable exists. */
export async function binaryExists(ssh: NodeSSH, path: string): Promise<boolean> {
  const { code } = await ssh.execCommand(`test -x ${path}`);
  return code === 0;
}

/** Resolve an executable name to its full path using `which`. */
export async function whichBinary(ssh: NodeSSH, name: string): Promise<string | null> {
  const { stdout, code } = await ssh.execCommand(`which ${name}`);
  if (code === 0 && stdout.trim()) return stdout.trim();
  return null;
}

/** Detect the available package manager on the remote host. */
export async function detectPackageManager(ssh: NodeSSH): Promise<'apt' | 'dnf' | 'yum' | null> {
  const [apt, dnf, yum] = await Promise.all([
    ssh.execCommand('which apt-get'),
    ssh.execCommand('which dnf'),
    ssh.execCommand('which yum'),
  ]);
  if (apt.code === 0) return 'apt';
  if (dnf.code === 0) return 'dnf';
  if (yum.code === 0) return 'yum';
  return null;
}

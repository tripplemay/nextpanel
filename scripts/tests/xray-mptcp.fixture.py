import json
import os
import re
import signal
import socket
import subprocess
import sys
import tempfile
import time


def run(args):
    return subprocess.check_output(args, text=True, timeout=15)


assert sys.platform == 'linux' and os.geteuid() == 0
binary = os.path.abspath(sys.argv[1])
if len(sys.argv) == 2:
    subprocess.run(['unshare', '--net', '--fork', sys.executable, __file__, binary, 'isolated'],
                   env={**os.environ, 'NP_PARENT_NETNS': os.readlink('/proc/self/ns/net')}, check=True, timeout=30)
    sys.exit(0)

assert os.readlink('/proc/self/ns/net') != os.environ['NP_PARENT_NETNS']
run(['ip', 'link', 'set', 'lo', 'up'])
run(['sysctl', '-w', 'net.mptcp.enabled=1'])
# Older iproute2/kernel combinations omit MPTCP listeners from ss -M. Trace the
# actual socket protocol with both controls rather than treating empty ss as safe.
with tempfile.TemporaryDirectory(prefix='np-mptcp-fixture-') as directory:
    def traced(args, filename):
        return ['strace', '-f', '-e', 'trace=socket', '-o', os.path.join(directory, filename)] + args

    pattern = re.compile(r'socket\([^\n]*(?:IPPROTO_MPTCP|, 262\))')
    for protocol in [262, 6, 0]:
        control = f'import socket; s=socket.socket(socket.AF_INET,socket.SOCK_STREAM,{protocol}); s.bind(("127.0.0.1",0)); s.listen(); assert s.getsockopt(socket.SOL_SOCKET,38)=={protocol or 6}'
        run(traced([sys.executable, '-c', control], str(protocol)))
        with open(os.path.join(directory, str(protocol))) as stream:
            trace = stream.read()
        assert bool(pattern.search(trace)) == (protocol == 262), 'Socket protocol control misclassified'
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    config = os.path.join(directory, 'config.json')
    with open(config, 'w') as stream:
        json.dump({'log': {'loglevel': 'none'}, 'inbounds': [{'listen': '127.0.0.1', 'port': port,
                   'protocol': 'socks', 'settings': {'auth': 'noauth'}}], 'outbounds': [{'protocol': 'blackhole'}]}, stream)
    child = subprocess.Popen(traced([binary, 'run', '-config', config], 'candidate'),
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        for _ in range(50):
            assert child.poll() is None, 'Candidate exited before listening'
            if '127.0.0.1:' + str(port) in run(['ss', '-H', '-lnt']):
                break
            time.sleep(0.1)
        else:
            raise AssertionError('Candidate never listened')
        with open(os.path.join(directory, 'candidate')) as stream:
            trace = stream.read()
        ordinary = re.search(r'socket\(AF_INET6?, SOCK_STREAM[^\n]*, IPPROTO_(?:TCP|IP)\)', trace)
        assert ordinary and not pattern.search(trace), 'Candidate socket trace requires review:\n' + trace[-10000:]
    finally:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=5)
print('PASS socket-protocol positive/negative controls and ordinary TCP Xray in private network namespace')

"""Linux command owner. EOF on the host pipe means cleanup, never detach."""
import ctypes
import json
import os
import selectors
import signal
import subprocess
import sys
import time


def children():
    # Subreaper adoption keeps double-fork/setsid descendants under our ownership.
    found = set()
    pending = [os.getpid()]
    while pending:
        parent = pending.pop()
        try:
            with open(f"/proc/{parent}/task/{parent}/children") as stream:
                direct = [int(value) for value in stream.read().split()]
        except FileNotFoundError:
            continue
        for pid in direct:
            if pid not in found:
                found.add(pid)
                pending.append(pid)
    return found


def reap():
    while True:
        try:
            if os.waitpid(-1, os.WNOHANG)[0] == 0:
                return
        except ChildProcessError:
            return


def cleanup(grace):
    deadline = time.monotonic() + grace
    while True:
        owned = children()
        if not owned:
            reap()
            return
        for pid in owned:
            try:
                # pidfds prevent a recycled PID from targeting an unrelated process.
                fd = os.pidfd_open(pid)
                try:
                    if pid in children():
                        signal.pidfd_send_signal(fd, signal.SIGTERM if time.monotonic() < deadline else signal.SIGKILL)
                finally:
                    os.close(fd)
            except ProcessLookupError:
                pass
        reap()
        time.sleep(0.02)


def main():
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise OSError(ctypes.get_errno(), "Cannot become a child subreaper")
    config = json.loads(sys.stdin.buffer.readline())
    stopped = False
    def stop(signum, frame):
        nonlocal stopped
        stopped = True
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    selector = selectors.DefaultSelector()
    selector.register(sys.stdin, selectors.EVENT_READ)
    process = None
    try:
        with open(config["log"], "ab", buffering=0) as output:
            process = subprocess.Popen(["/bin/sh", "-c", config["command"]], cwd=config["cwd"],
                stdin=subprocess.DEVNULL, stdout=output, stderr=output, start_new_session=True)
            print(json.dumps({"event": "started", "pid": process.pid}), flush=True)
            while process.poll() is None and not stopped:
                if selector.select(0.05):
                    # A stop byte OR EOF (including host SIGKILL) requests cleanup.
                    os.read(sys.stdin.fileno(), 4096)
                    stopped = True
            exit_code = process.poll()
    finally:
        cleanup(config.get("graceSeconds", 1))
        selector.close()
    print(json.dumps({"event": "settled", "status": "stopped" if stopped else "completed" if exit_code == 0 else "failed", "exitCode": exit_code}), flush=True)


if __name__ == "__main__":
    main()

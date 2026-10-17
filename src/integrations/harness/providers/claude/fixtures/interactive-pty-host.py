"""Opt-in real CLI tests: Unix PTY plumbing only, no provider/session decisions."""
import base64
import fcntl
import json
import os
import pty
import signal
import struct
import subprocess
import sys
import termios
import threading
import time

lock = threading.Lock()
process = None
master = None
reader = None
output_lock = threading.Lock()
output_total = 0
output_at = time.monotonic()
paste_baseline = 0


def emit(value):
    with lock:
        print(json.dumps(value), flush=True)


def read_output(fd, child):
    global output_total, output_at
    try:
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            with output_lock:
                output_total += len(chunk)
                output_at = time.monotonic()
            emit({"event": "data", "data": base64.b64encode(chunk).decode()})
    except OSError:
        pass
    emit({"event": "exit", "code": child.wait()})


def settle_paste(request, baseline):
    minimum = (500 + (int(request["data"]) + 4095) // 4096) / 1000
    started = time.monotonic()
    while True:
        elapsed = time.monotonic() - started
        with output_lock:
            settled = output_total > baseline and time.monotonic() - output_at >= 1.5
        if elapsed >= minimum and settled:
            emit({"id": request["id"]})
            return
        if elapsed >= minimum + 8:
            emit({"id": request["id"], "error": "Native paste output did not settle; no Enter was sent"})
            return
        time.sleep(0.02)


def stop():
    global process, master, reader
    if process is not None:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        reader.join(timeout=2)
        os.close(master)
        process = master = reader = None


try:
    for line in sys.stdin:
        request = json.loads(line)
        try:
            command = request["command"]
            if command == "paste-settle":
                threading.Thread(target=settle_paste, args=(request, paste_baseline), daemon=True).start()
                continue
            if command == "start":
                stop()
                master, slave = pty.openpty()
                fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
                environment = dict(os.environ)
                for name in ["CLAUDECODE", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"]:
                    environment.pop(name, None)
                environment.update(request["env"])
                try:
                    process = subprocess.Popen(request["argv"], cwd=request["cwd"], env=environment,
                                               stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
                finally:
                    os.close(slave)
                reader = threading.Thread(target=read_output, args=(master, process), daemon=True)
                reader.start()
            elif command == "write":
                data = request["data"].encode()
                if data.startswith(b"\x1b[200~"):
                    with output_lock:
                        paste_baseline = output_total
                while data:
                    count = os.write(master, data)
                    data = data[count:]
                with output_lock:
                    output_at = time.monotonic()
            elif command == "resize":
                fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", request["rows"], request["cols"], 0, 0))
            elif command == "stop":
                stop()
            else:
                raise ValueError("Unknown PTY command")
            emit({"id": request["id"]})
        except Exception as error:
            emit({"id": request["id"], "error": str(error)})
finally:
    stop()

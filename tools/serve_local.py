from __future__ import annotations

import http.client
import argparse
import mimetypes
import os
import re
import socket
import subprocess
import time
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


APP_ROOT = Path(__file__).resolve().parents[1]
TEXTBOOK = APP_ROOT.parent / "无机化学(宋天佑) 4th 下册.pdf"
STATIC_ROOT = APP_ROOT / "dist" / "client"
PAGE_IMAGE_ROOT = APP_ROOT.parent / "pages" / "original"
NODE = Path(r"C:\Users\PeterB\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe")
VINEXT = APP_ROOT / "node_modules" / "vinext" / "dist" / "cli.js"
PUBLIC_PORT = 3000


class ProxyHandler(BaseHTTPRequestHandler):
    server_version = "ElementChemistryQuiz/1.0"
    app_port = 0

    def do_HEAD(self) -> None:
        self.route_request(head_only=True)

    def do_GET(self) -> None:
        self.route_request(head_only=False)

    def route_request(self, *, head_only: bool) -> None:
        request_path = urlsplit(self.path).path
        if request_path == "/textbook.pdf":
            self.serve_pdf(head_only=head_only)
        elif request_path.startswith("/page-images/"):
            image_path = self.page_image_path(request_path)
            if image_path is None:
                self.send_error(HTTPStatus.NOT_FOUND)
            else:
                self.serve_static(image_path, head_only=head_only)
        elif (static_path := self.static_path(request_path)) is not None:
            self.serve_static(static_path, head_only=head_only)
        else:
            self.proxy_to_app(head_only=head_only)

    def page_image_path(self, request_path: str) -> Path | None:
        filename = unquote(request_path.removeprefix("/page-images/"))
        if not re.fullmatch(r"pdf_\d{4}\.jpeg", filename):
            return None
        candidate = PAGE_IMAGE_ROOT / filename
        return candidate if candidate.is_file() else None

    def static_path(self, request_path: str) -> Path | None:
        """Resolve a built client file without allowing path traversal."""
        relative = unquote(request_path).lstrip("/")
        if not relative:
            return None
        candidate = (STATIC_ROOT / relative).resolve()
        try:
            candidate.relative_to(STATIC_ROOT.resolve())
        except ValueError:
            return None
        return candidate if candidate.is_file() else None

    def serve_static(self, path: Path, *, head_only: bool) -> None:
        size = path.stat().st_size
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(size))
        if path.is_relative_to(STATIC_ROOT / "assets") or path.is_relative_to(PAGE_IMAGE_ROOT):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            # Dataset and format files keep stable URLs and may be rebuilt.
            self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if not head_only:
            with path.open("rb") as source:
                while chunk := source.read(1024 * 1024):
                    self.wfile.write(chunk)

    def serve_pdf(self, *, head_only: bool) -> None:
        size = TEXTBOOK.stat().st_size
        start, end = 0, size - 1
        status = HTTPStatus.OK
        range_header = self.headers.get("Range")
        if range_header:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
            if not match:
                self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                return
            if match.group(1):
                start = int(match.group(1))
            if match.group(2):
                end = min(int(match.group(2)), size - 1)
            if start > end or start >= size:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            status = HTTPStatus.PARTIAL_CONTENT

        self.send_response(status)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "public, max-age=3600")
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if head_only:
            return
        with TEXTBOOK.open("rb") as source:
            source.seek(start)
            remaining = end - start + 1
            while remaining:
                chunk = source.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def proxy_to_app(self, *, head_only: bool) -> None:
        connection = http.client.HTTPConnection("127.0.0.1", self.app_port, timeout=30)
        headers = {
            key: value for key, value in self.headers.items()
            if key.lower() not in {"host", "connection", "content-length"}
        }
        try:
            connection.request("HEAD" if head_only else "GET", self.path, headers=headers)
            response = connection.getresponse()
            self.send_response(response.status, response.reason)
            for key, value in response.getheaders():
                if key.lower() not in {"connection", "transfer-encoding", "content-length"}:
                    self.send_header(key, value)
            body = b"" if head_only else response.read()
            if not head_only:
                self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if body:
                self.wfile.write(body)
        except OSError as error:
            self.send_error(HTTPStatus.BAD_GATEWAY, str(error))
        finally:
            connection.close()

    def log_message(self, format: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {format % args}")


def wait_for_port(port: int, timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket() as probe:
            probe.settimeout(0.3)
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.2)
    raise RuntimeError("网页服务启动超时")


def find_free_port() -> int:
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        return int(reservation.getsockname()[1])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()
    if not NODE.exists() or not VINEXT.exists():
        raise SystemExit("未找到本地网页运行环境。")
    # Windows treats environment names case-insensitively. Some launchers expose
    # both Path and PATH, which can make CreateProcess reject the environment.
    environment = {
        key: value for key, value in os.environ.items()
        if key.lower() != "path"
    }
    inherited_path = next(
        (value for key, value in os.environ.items() if key.lower() == "path"),
        "",
    )
    environment["Path"] = f"{NODE.parent};{inherited_path}"
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    app_port = find_free_port()
    ProxyHandler.app_port = app_port
    app = subprocess.Popen(
        [str(NODE), str(VINEXT), "start", "--port", str(app_port)],
        cwd=APP_ROOT,
        env=environment,
        creationflags=flags,
    )
    try:
        wait_for_port(app_port)
        server = ThreadingHTTPServer(("127.0.0.1", PUBLIC_PORT), ProxyHandler)
        address = f"http://127.0.0.1:{PUBLIC_PORT}"
        print(f"元素化学颜色训练已启动：{address}")
        if not args.no_open:
            webbrowser.open(address)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
    finally:
        app.terminate()
        try:
            app.wait(timeout=5)
        except subprocess.TimeoutExpired:
            app.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

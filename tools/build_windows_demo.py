from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import time
import urllib.request
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = APP_ROOT.parent
RELEASE_ROOT = APP_ROOT / "release"
DEMO_ROOT = RELEASE_ROOT / "ElementChemistryDemo"
NODE = Path(r"C:\Users\PeterB\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe")
VINEXT = APP_ROOT / "node_modules" / "vinext" / "dist" / "cli.js"
GXX = Path(r"A:\MizuharaTaffy\mingw64\bin\g++.exe")


def free_port() -> int:
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        return int(reservation.getsockname()[1])


def node_environment() -> dict[str, str]:
    environment = {key: value for key, value in os.environ.items() if key.lower() != "path"}
    inherited_path = next((value for key, value in os.environ.items() if key.lower() == "path"), "")
    environment["Path"] = f"{NODE.parent};{inherited_path}"
    return environment


def build_and_validate_site() -> None:
    environment = node_environment()
    print("[1/4] 构建最新版网页……", flush=True)
    subprocess.run([str(NODE), str(VINEXT), "build"], check=True, cwd=APP_ROOT, env=environment)
    print("[2/4] 校验题库与题目格式……", flush=True)
    subprocess.run(
        [str(NODE), str(APP_ROOT / "tools" / "validate_dataset.mjs")],
        check=True,
        cwd=APP_ROOT,
        env=environment,
    )


def capture_index() -> bytes:
    port = free_port()
    environment = node_environment()
    process = subprocess.Popen(
        [str(NODE), str(VINEXT), "start", "--port", str(port)],
        cwd=APP_ROOT,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    try:
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1) as response:
                    return response.read()
            except OSError:
                if process.poll() is not None:
                    output = process.stdout.read().decode("utf-8", errors="replace") if process.stdout else ""
                    raise RuntimeError(f"网页构建服务提前退出：{output}")
                time.sleep(0.2)
        raise RuntimeError("等待网页构建服务超时")
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def write_readme(path: Path) -> None:
    path.write_text(
        "元素化学颜色题库 Demo（Windows x64）\n"
        "\n"
        "使用方法：\n"
        "1. 请先完整解压压缩包，不要直接在压缩包内运行。\n"
        "2. 双击 ElementChemistryDemo.exe。\n"
        "3. 默认浏览器会自动打开题库。关闭黑色窗口即可停止。\n"
        "\n"
        "说明：\n"
        "- 无需安装 Python、Node.js 或其他运行环境。\n"
        "- resources 目录必须与 EXE 保持在一起。\n"
        "- 程序仅在 127.0.0.1 随机端口提供网页，不接受局域网访问。\n"
        "- 教材扫描页仅用于本题库的原文核对。\n",
        encoding="utf-8-sig",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-zip", action="store_true")
    args = parser.parse_args()

    required = [WORKSPACE / "pages" / "original", APP_ROOT / "data" / "chemistry.sqlite", GXX, NODE, VINEXT]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise SystemExit("缺少打包输入：\n" + "\n".join(missing))

    build_and_validate_site()
    print("[3/4] 汇集网页、数据库和教材页图片……", flush=True)

    if DEMO_ROOT.exists():
        shutil.rmtree(DEMO_ROOT)
    DEMO_ROOT.mkdir(parents=True)
    resources = DEMO_ROOT / "resources"
    site = resources / "site"
    shutil.copytree(APP_ROOT / "dist" / "client", site)
    (site / "index.html").write_bytes(capture_index())
    shutil.copytree(WORKSPACE / "pages" / "original", resources / "page-images")
    (resources / "data").mkdir()
    shutil.copy2(APP_ROOT / "data" / "chemistry.sqlite", resources / "data" / "chemistry.sqlite")
    write_readme(DEMO_ROOT / "使用说明.txt")

    executable = DEMO_ROOT / "ElementChemistryDemo.exe"
    compile_command = [
        str(GXX), "-std=c++17", "-O2", "-Wall", "-Wextra",
        "-static-libstdc++", "-static-libgcc",
        "-o", str(executable), str(APP_ROOT / "portable" / "element_chemistry_demo.cpp"),
        "-lws2_32", "-lshell32",
    ]
    build_temp = APP_ROOT / ".tmp_build"
    build_temp.mkdir(exist_ok=True)
    compile_environment = {key: value for key, value in os.environ.items() if key.lower() not in {"path", "temp", "tmp"}}
    inherited_path = next((value for key, value in os.environ.items() if key.lower() == "path"), "")
    compile_environment["Path"] = f"{GXX.parent};{inherited_path}"
    compile_environment["TEMP"] = str(build_temp)
    compile_environment["TMP"] = str(build_temp)
    subprocess.run(compile_command, check=True, cwd=APP_ROOT, env=compile_environment)
    shutil.rmtree(build_temp, ignore_errors=True)

    if not args.skip_zip:
        print("[4/4] 生成 Windows ZIP……", flush=True)
        archive = RELEASE_ROOT / "ElementChemistryDemo-Windows-x64.zip"
        if archive.exists():
            archive.unlink()
        shutil.make_archive(str(archive.with_suffix("")), "zip", RELEASE_ROOT, DEMO_ROOT.name)

    print(f"Demo: {DEMO_ROOT}")
    if not args.skip_zip:
        print(f"Archive: {RELEASE_ROOT / 'ElementChemistryDemo-Windows-x64.zip'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

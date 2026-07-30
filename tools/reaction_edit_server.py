from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


APP_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = APP_ROOT.parent
OUTPUT_DIR = WORKSPACE / "extraction" / "reaction_draft"
EDIT_PATH = OUTPUT_DIR / "manual_edits.json"
REACTION_PATH = OUTPUT_DIR / "reactions.json"
SUMMARY_PATH = OUTPUT_DIR / "summary.json"
WRITE_LOCK = threading.Lock()

ALLOWED_SIDES = {"reactant", "product"}
ALLOWED_PHASES = {None, "s", "l", "g", "aq"}
ALLOWED_MARKERS = {None, "gas_release", "precipitate"}
ALLOWED_DIRECTIONS = {"irreversible", "reversible", "equilibrium"}
ALLOWED_CONDITION_TYPES = {
    "temperature", "medium", "concentration", "catalyst", "light",
    "pressure", "excess", "atmosphere", "operation", "other",
}


def read_edit_payload() -> dict:
    if not EDIT_PATH.exists():
        return {"version": 1, "edits": {}}
    payload = json.loads(EDIT_PATH.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("edits"), dict):
        raise ValueError("manual_edits.json 结构无效")
    return payload


def write_edit_payload(payload: dict) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    EDIT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def validate_edit(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("修订内容必须是对象")
    direction = raw.get("direction", "irreversible")
    if direction not in ALLOWED_DIRECTIONS:
        raise ValueError("反应方向无效")

    participants_raw = raw.get("participants")
    if not isinstance(participants_raw, list):
        raise ValueError("反应物和产物列表缺失")
    participants: list[dict] = []
    side_counts = {"reactant": 0, "product": 0}
    for index, item in enumerate(participants_raw, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"第 {index} 个物质结构无效")
        side = item.get("side")
        formula = str(item.get("formulaCanonical") or "").strip()
        phase = item.get("phase")
        marker = item.get("formationMarker")
        try:
            coefficient_num = int(item.get("coefficientNum", 1))
            coefficient_den = int(item.get("coefficientDen", 1))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"第 {index} 个物质的系数无效") from exc
        if side not in ALLOWED_SIDES:
            raise ValueError(f"第 {index} 个物质的反应侧无效")
        if not formula:
            raise ValueError(f"第 {index} 个物质缺少化学式")
        if coefficient_num <= 0 or coefficient_den <= 0:
            raise ValueError(f"第 {index} 个物质的系数必须为正数")
        if phase not in ALLOWED_PHASES:
            raise ValueError(f"第 {index} 个物质的物态无效")
        if marker not in ALLOWED_MARKERS:
            raise ValueError(f"第 {index} 个物质的生成标记无效")
        side_counts[side] += 1
        participants.append({
            "side": side,
            "position": side_counts[side],
            "formula_canonical": formula,
            "coefficient_num": coefficient_num,
            "coefficient_den": coefficient_den,
            "phase": phase,
            "formation_marker": marker,
            "is_focus": None,
        })
    if not side_counts["reactant"] or not side_counts["product"]:
        raise ValueError("反应物和产物至少各保留一项")

    conditions: list[dict] = []
    for index, item in enumerate(raw.get("conditions", []), start=1):
        if not isinstance(item, dict):
            raise ValueError(f"第 {index} 个条件结构无效")
        condition_type = item.get("type", "other")
        raw_text = str(item.get("rawText") or "").strip()
        related_formula = str(item.get("relatedFormula") or "").strip() or None
        if condition_type not in ALLOWED_CONDITION_TYPES:
            raise ValueError(f"第 {index} 个条件类型无效")
        if not raw_text:
            raise ValueError(f"第 {index} 个条件缺少内容")
        conditions.append({
            "condition_type": condition_type,
            "operator": "qualitative",
            "value_text": raw_text,
            "value_num": None,
            "value_num_high": None,
            "unit": None,
            "related_formula": related_formula,
            "normalized_value": None,
            "raw_text": raw_text,
        })
    return {
        "direction": direction,
        "participants": participants,
        "conditions": conditions,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def rebuild_artifacts() -> None:
    commands = [
        [sys.executable, str(WORKSPACE / "scripts" / "extract_reactions.py")],
        [sys.executable, str(WORKSPACE / "scripts" / "validate_reactions.py")],
        [sys.executable, str(APP_ROOT / "tools" / "build_reaction_review_data.py")],
    ]
    for command in commands:
        result = subprocess.run(
            command,
            cwd=WORKSPACE,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        if result.returncode:
            detail = (result.stderr or result.stdout or "未知错误").strip()
            raise RuntimeError(detail[-2000:])


def updated_reaction(reaction_id: str) -> dict:
    rows = json.loads(REACTION_PATH.read_text(encoding="utf-8"))
    reaction = next((row for row in rows if row["reaction_id"] == reaction_id), None)
    if reaction is None:
        raise ValueError("找不到对应反应")
    summary = json.loads(SUMMARY_PATH.read_text(encoding="utf-8"))
    return {
        "reactionId": reaction_id,
        "equationCanonical": reaction["equation_canonical"],
        "balanceStatus": reaction["balance_status"],
        "equationKind": reaction["equation_kind"],
        "updatedAt": reaction.get("manual_edit_updated_at"),
        "schemaVersion": summary["schema_version"],
    }


class ReactionEditHandler(BaseHTTPRequestHandler):
    server_version = "ElementChemistryEditServer/1.0"

    def log_message(self, format: str, *args: object) -> None:
        print(f"[reaction-edit] {self.address_string()} {format % args}")

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self._send_json(204, {})

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        try:
            if path == "/health":
                self._send_json(200, {"ok": True})
                return
            if path == "/api/edits":
                payload = read_edit_payload()
                self._send_json(200, {
                    "ok": True,
                    "editIds": sorted(payload["edits"]),
                    "count": len(payload["edits"]),
                })
                return
            self._send_json(404, {"ok": False, "error": "接口不存在"})
        except Exception as exc:
            self._send_json(500, {"ok": False, "error": str(exc)})

    def do_PUT(self) -> None:
        path = urlparse(self.path).path
        prefix = "/api/edits/"
        if not path.startswith(prefix):
            self._send_json(404, {"ok": False, "error": "接口不存在"})
            return
        reaction_id = unquote(path[len(prefix):]).strip()
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = json.loads(self.rfile.read(length).decode("utf-8"))
            edit = validate_edit(raw)
            with WRITE_LOCK:
                previous = EDIT_PATH.read_bytes() if EDIT_PATH.exists() else None
                payload = read_edit_payload()
                payload["version"] = 1
                payload["edits"][reaction_id] = edit
                write_edit_payload(payload)
                try:
                    rebuild_artifacts()
                except Exception:
                    if previous is None:
                        EDIT_PATH.unlink(missing_ok=True)
                    else:
                        EDIT_PATH.write_bytes(previous)
                    rebuild_artifacts()
                    raise
                result = updated_reaction(reaction_id)
            self._send_json(200, {"ok": True, **result})
        except ValueError as exc:
            self._send_json(400, {"ok": False, "error": str(exc)})
        except Exception as exc:
            self._send_json(500, {"ok": False, "error": f"保存失败：{exc}"})

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        prefix = "/api/edits/"
        if not path.startswith(prefix):
            self._send_json(404, {"ok": False, "error": "接口不存在"})
            return
        reaction_id = unquote(path[len(prefix):]).strip()
        try:
            with WRITE_LOCK:
                payload = read_edit_payload()
                existed = payload["edits"].pop(reaction_id, None) is not None
                write_edit_payload(payload)
                rebuild_artifacts()
            self._send_json(200, {"ok": True, "removed": existed})
        except Exception as exc:
            self._send_json(500, {"ok": False, "error": f"恢复失败：{exc}"})


def main() -> None:
    parser = argparse.ArgumentParser(description="Local API for durable reaction edits.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3101)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), ReactionEditHandler)
    print(f"Reaction edit API: http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()

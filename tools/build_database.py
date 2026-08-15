from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

from color_policy import (
    COLOR_GENERALIZATIONS,
    DISALLOWED_COLOR_TERMS,
    OCR_ADDITIONAL_RAW_EXPRESSIONS,
    accepted_terms,
    accepted_terms_for_raw,
    expression_kind,
    known_policy_terms,
    mapped_terms,
    missing_policy_terms,
    normalize_raw_expression,
)


APP_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = APP_ROOT.parent
DEFAULT_INPUT = WORKSPACE / "extraction" / "local_semantic_draft" / "observations_draft.json"
DEFAULT_DB = APP_ROOT / "data" / "chemistry.sqlite"
DEFAULT_JSON = APP_ROOT / "public" / "materials.v1.json"

COMMON_COMPOSITES = {
    "银白", "银灰", "银黄", "灰白", "灰黑", "黑灰", "棕黑", "黄棕", "棕黄",
    "红棕", "棕红", "红褐", "棕褐", "黄橙", "橙黄", "橙红", "橘红", "橘黄",
    "黄绿", "灰绿", "蓝绿", "蓝黑", "红紫", "蓝紫", "紫红", "紫黑", "粉红",
    "桃红", "玫瑰红", "洋红", "天蓝", "灰蓝", "白绿", "红黑", "绿黑", "绿蓝",
    "红黄", "黑绿", "白黄", "红绿", "灰蓝绿", "深蓝紫", "黑棕",
}

STATE_MAP = {
    "结晶": "晶体", "晶状": "晶体", "固态": "固体", "液态": "液体", "气态": "气体",
}


def compact(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def stable_id(prefix: str, *parts: object) -> str:
    raw = "\x1f".join(str(part) for part in parts)
    return f"{prefix}_{hashlib.sha1(raw.encode('utf-8')).hexdigest()[:16]}"


def balanced_outer_parentheses(value: str) -> bool:
    if not (value.startswith("(") and value.endswith(")")):
        return False
    depth = 0
    for index, char in enumerate(value):
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0 and index != len(value) - 1:
                return False
        if depth < 0:
            return False
    return depth == 0


def normalize_formula(value: str | None) -> str | None:
    formula = compact(value)
    if not formula:
        return None
    formula = formula.replace("−", "-").replace("–", "-").replace("·", "·")
    formula = formula.replace("\\mathrm", "")
    formula = formula.replace("\\alpha", "α").replace("\\beta", "β").replace("\\gamma", "γ")
    formula = re.sub(r"\s*·\s*", "·", formula)
    formula = re.sub(r"\s+", "", formula)
    formula = formula.rstrip(":：")
    formula = re.sub(r"(?:无色|[深浅淡暗鲜银金灰白黑黄橙橘红棕褐绿蓝紫粉玫瑰洋桃]+色)(?:\(\d+\))?$", "", formula)
    if balanced_outer_parentheses(formula):
        inner = formula[1:-1]
        if re.search(r"[A-Z]", inner) and not re.search(r"[+\-]$", inner):
            formula = inner
    return formula


def split_formula_phase(formula: str | None) -> tuple[str | None, str | None]:
    if not formula:
        return None, None
    match = re.fullmatch(r"(.+)\(([\u4e00-\u9fffαβγ]+)\)", formula)
    if match and re.search(r"[A-Z]", match.group(1)):
        return match.group(1), match.group(2)
    return formula, None


def formula_quality(formula: str | None) -> str:
    if not formula or not re.search(r"[A-Z]", formula):
        return "invalid"
    if re.search(r"[\\:{}\u4e00-\u9fff]", formula):
        return "suspicious"
    if formula.count("(") != formula.count(")") or formula.count("[") != formula.count("]"):
        return "suspicious"
    return "clean"


def formula_to_mhchem(formula: str | None) -> str | None:
    if not formula:
        return None
    return formula.replace("α", "{$\\alpha$}").replace("β", "{$\\beta$}").replace("γ", "{$\\gamma$}")


def formula_sort_key(formula: str | None) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", formula or "").upper()


ELEMENT_SYMBOLS = {
    "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar",
    "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr",
    "Rb", "Sr", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn", "Sb", "Te", "I", "Xe",
    "Cs", "Ba", "La", "Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu",
    "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg", "Tl", "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra",
    "Ac", "Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr",
}
COMMON_COUNTERIONS = {"Li", "Na", "K", "Rb", "Cs", "Fr", "Be", "Mg", "Ca", "Sr", "Ba", "Ra"}
CENTRAL_PRIORITY = {
    "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh",
    "Pd", "Ag", "Cd", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg", "Al", "Ga", "Ge", "In", "Sn",
    "Sb", "Tl", "Pb", "Bi", "Po", "As", "Se", "Te", "La", "Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb",
    "Dy", "Ho", "Er", "Tm", "Yb", "Lu", "Ac", "Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es",
    "Fm", "Md", "No", "Lr",
}


def infer_focus_element(formula: str | None) -> str | None:
    """Choose the chemically diagnostic element used for related distractors."""
    if not formula:
        return None
    elements = []
    for symbol in re.findall(r"[A-Z][a-z]?", formula):
        if symbol in ELEMENT_SYMBOLS and symbol not in elements:
            elements.append(symbol)
    candidates = [symbol for symbol in elements if symbol not in {"H", "O"}] or elements
    priority = [symbol for symbol in candidates if symbol in CENTRAL_PRIORITY]
    if priority:
        return priority[0]
    non_counterions = [symbol for symbol in candidates if symbol not in COMMON_COUNTERIONS]
    return (non_counterions or candidates or [None])[0]


def normalize_name(value: str | None) -> str | None:
    name = compact(value)
    name = re.sub(r"(?:均|都|为)$", "", name).strip()
    return name or None


def normalize_color_atom(value: str) -> str:
    value = compact(value)
    if value == "无色":
        return value
    return value if value.endswith("色") else f"{value}色"


def normalize_colors(value: str) -> list[dict]:
    """Expand alternatives and ranges into independently acceptable colors.

    In the appendix, separators such as ``黄-橙`` and ``白或棕`` describe
    alternative/ranged appearances. They must not be collapsed into a new
    composite color such as ``黄橙色``.
    """
    raw = (
        compact(value)
        .replace("－", "-")
        .replace("—", "-")
        .replace("至", "-")
        .replace("或", "/")
        .replace("、", "/")
    )
    atoms = [
        normalize_color_atom(atom)
        for alternative in raw.split("/")
        for atom in alternative.split("-")
        if compact(atom)
    ]
    colors: list[dict] = []
    seen: set[str] = set()
    for display in atoms:
        if display in DISALLOWED_COLOR_TERMS:
            continue
        if display in seen:
            continue
        seen.add(display)
        kind = "composite" if display.removesuffix("色") in COMMON_COMPOSITES else "single"
        colors.append({"key": display, "display": display, "kind": kind, "raw": raw})
    return colors


SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE source_documents (
  document_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  page_count INTEGER NOT NULL
);

CREATE TABLE substances (
  substance_id TEXT PRIMARY KEY,
  identity_key TEXT NOT NULL UNIQUE,
  formula_canonical TEXT,
  formula_mhchem TEXT,
  formula_sort_key TEXT,
  focus_element TEXT,
  formula_quality TEXT NOT NULL CHECK(formula_quality IN ('clean','suspicious','invalid')),
  phase_label TEXT,
  preferred_name TEXT,
  display_label TEXT NOT NULL,
  display_mode TEXT NOT NULL CHECK(display_mode IN ('mhchem','text'))
);

CREATE TABLE substance_aliases (
  substance_id TEXT NOT NULL REFERENCES substances(substance_id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  alias_kind TEXT NOT NULL,
  PRIMARY KEY (substance_id, alias, alias_kind)
);

CREATE TABLE colors (
  color_id TEXT PRIMARY KEY,
  color_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  color_kind TEXT NOT NULL CHECK(color_kind IN ('single','composite','range','alternative'))
);

CREATE TABLE color_aliases (
  color_id TEXT NOT NULL REFERENCES colors(color_id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  PRIMARY KEY (color_id, alias)
);

CREATE TABLE color_connections (
  source_color_id TEXT NOT NULL REFERENCES colors(color_id) ON DELETE CASCADE,
  target_color_id TEXT NOT NULL REFERENCES colors(color_id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK(relation IN ('broader')),
  PRIMARY KEY (source_color_id, target_color_id)
);

CREATE TABLE raw_color_expressions (
  raw_color_id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL UNIQUE,
  normalized_text TEXT NOT NULL,
  expression_kind TEXT NOT NULL CHECK(expression_kind IN ('atom','range','alternative'))
);

CREATE TABLE raw_color_mappings (
  raw_color_id TEXT NOT NULL REFERENCES raw_color_expressions(raw_color_id) ON DELETE CASCADE,
  color_id TEXT NOT NULL REFERENCES colors(color_id) ON DELETE CASCADE,
  mapping_kind TEXT NOT NULL,
  PRIMARY KEY (raw_color_id, color_id)
);

CREATE TABLE observations (
  observation_id TEXT PRIMARY KEY,
  substance_id TEXT NOT NULL REFERENCES substances(substance_id),
  color_id TEXT NOT NULL REFERENCES colors(color_id),
  physical_state TEXT,
  observation_kind TEXT NOT NULL,
  medium TEXT,
  conditions TEXT,
  confidence REAL NOT NULL,
  source_count INTEGER NOT NULL DEFAULT 0,
  color_question_eligible INTEGER NOT NULL DEFAULT 0,
  selection_question_eligible INTEGER NOT NULL DEFAULT 0,
  ambiguity_note TEXT,
  UNIQUE (substance_id, color_id, physical_state, observation_kind, medium, conditions)
);

CREATE TABLE observation_sources (
  source_id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL REFERENCES observations(observation_id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES source_documents(document_id),
  pdf_page INTEGER NOT NULL,
  printed_page INTEGER,
  candidate_id TEXT,
  block_index INTEGER,
  row_index INTEGER,
  bbox_json TEXT,
  evidence_text TEXT NOT NULL,
  UNIQUE (observation_id, pdf_page, candidate_id, block_index, row_index, evidence_text)
);

CREATE TABLE observation_raw_colors (
  observation_id TEXT NOT NULL REFERENCES observations(observation_id) ON DELETE CASCADE,
  raw_color_id TEXT NOT NULL REFERENCES raw_color_expressions(raw_color_id) ON DELETE CASCADE,
  PRIMARY KEY (observation_id, raw_color_id)
);

CREATE TABLE observation_accepted_colors (
  observation_id TEXT NOT NULL REFERENCES observations(observation_id) ON DELETE CASCADE,
  color_id TEXT NOT NULL REFERENCES colors(color_id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  PRIMARY KEY (observation_id, color_id)
);

CREATE INDEX observations_substance_idx ON observations(substance_id);
CREATE INDEX observations_color_idx ON observations(color_id);
CREATE INDEX sources_observation_idx ON observation_sources(observation_id);
CREATE INDEX sources_page_idx ON observation_sources(pdf_page);
CREATE INDEX raw_color_mappings_color_idx ON raw_color_mappings(color_id);
CREATE INDEX accepted_colors_color_idx ON observation_accepted_colors(color_id);
"""


def build(input_path: Path, db_path: Path, json_path: Path) -> dict:
    records = json.loads(input_path.read_text(encoding="utf-8"))
    high = [
        row for row in records
        if not row.get("is_exercise")
        and float(row.get("extraction_confidence") or 0) >= 0.75
        and not (row.get("uncertainty_flags") or [])
    ]

    db_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)

    document_id = "doc_song_inorganic_4e_part2"
    con.execute(
        "INSERT INTO source_documents VALUES (?, ?, ?, ?, ?)",
        (document_id, "无机化学（宋天佑）第4版 下册", "无机化学(宋天佑) 4th 下册.pdf", "../无机化学(宋天佑) 4th 下册.pdf", 496),
    )

    observation_ids: dict[tuple, str] = {}
    source_seen: set[tuple] = set()
    raw_color_counts: Counter[str] = Counter()
    raw_mapping_specs: dict[str, dict[str, object]] = {}
    observation_raw_ids: dict[str, set[str]] = defaultdict(set)

    for raw_text in OCR_ADDITIONAL_RAW_EXPRESSIONS:
        raw_color_id = stable_id("rawcol", raw_text)
        raw_mapping_specs[raw_color_id] = {
            "raw": raw_text,
            "normalized": normalize_raw_expression(raw_text),
            "kind": expression_kind(raw_text),
            "mappings": mapped_terms(raw_text),
        }
        con.execute(
            "INSERT OR IGNORE INTO raw_color_expressions VALUES (?, ?, ?, ?)",
            (raw_color_id, raw_text, normalize_raw_expression(raw_text), expression_kind(raw_text)),
        )

    for row in high:
        formula = normalize_formula(row.get("formula_normalized") or row.get("formula_raw"))
        formula, phase_label = split_formula_phase(formula)
        quality = formula_quality(formula) if formula else "clean"
        name = normalize_name(row.get("name_raw"))
        if phase_label and not name:
            name = phase_label
        if formula and quality == "invalid" and not name:
            continue
        if not formula and not name:
            continue
        identity_key = f"formula:{formula}|phase:{phase_label or ''}" if formula else f"name:{name}"
        substance_id = stable_id("sub", identity_key)
        display_label = f"{formula}（{phase_label}）" if formula and phase_label else formula or name or identity_key
        display_mode = "mhchem" if formula and quality == "clean" else "text"
        con.execute(
            """INSERT OR IGNORE INTO substances
               (substance_id, identity_key, formula_canonical, formula_mhchem, formula_sort_key, focus_element, formula_quality, phase_label, preferred_name, display_label, display_mode)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (substance_id, identity_key, formula, formula_to_mhchem(formula) if quality == "clean" else None, formula_sort_key(formula), infer_focus_element(formula), quality, phase_label, name, display_label, display_mode),
        )
        if name:
            con.execute("INSERT OR IGNORE INTO substance_aliases VALUES (?, ?, 'name')", (substance_id, name))
        formula_raw = compact(row.get("formula_raw"))
        if formula_raw:
            con.execute("INSERT OR IGNORE INTO substance_aliases VALUES (?, ?, 'formula_source')", (substance_id, formula_raw))

        state = STATE_MAP.get(compact(row.get("physical_form")), compact(row.get("physical_form"))) or None
        kind = compact(row.get("observation_kind")) or "物质外观"
        medium = compact(row.get("medium")) or None
        conditions = compact(row.get("conditions")) or None
        evidence = compact(row.get("evidence_text"))
        bbox = row.get("source_boxes_normalized_0_999")
        printed_page = row.get("printed_page_estimate")
        if printed_page is not None:
            printed_page = int(printed_page) - 1
        color_value = row.get("color_normalized") or row.get("color_raw") or ""
        colors = normalize_colors(color_value)
        raw_spellings = {
            compact(row.get("color_raw")),
            compact(row.get("color_normalized")),
            normalize_raw_expression(color_value),
        } - {""}
        for raw_text in raw_spellings:
            raw_color_id = stable_id("rawcol", raw_text)
            raw_mapping_specs[raw_color_id] = {
                "raw": raw_text,
                "normalized": normalize_raw_expression(raw_text),
                "kind": expression_kind(raw_text),
                "mappings": mapped_terms(raw_text),
            }
            con.execute(
                "INSERT OR IGNORE INTO raw_color_expressions VALUES (?, ?, ?, ?)",
                (raw_color_id, raw_text, normalize_raw_expression(raw_text), expression_kind(raw_text)),
            )
        for color in colors:
            color_id = stable_id("col", color["key"])
            con.execute(
                "INSERT OR IGNORE INTO colors VALUES (?, ?, ?, ?)",
                (color_id, color["key"], color["display"], color["kind"]),
            )
            for alias in {compact(row.get("color_raw")), compact(row.get("color_normalized")), color["raw"]} - {""}:
                con.execute("INSERT OR IGNORE INTO color_aliases VALUES (?, ?)", (color_id, alias))
                raw_color_counts[alias] += 1

            observation_key = (substance_id, color_id, state, kind, medium, conditions)
            observation_id = observation_ids.setdefault(observation_key, stable_id("obs", *observation_key))
            con.execute(
                """INSERT OR IGNORE INTO observations
                   (observation_id, substance_id, color_id, physical_state, observation_kind, medium, conditions, confidence)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (observation_id, substance_id, color_id, state, kind, medium, conditions, float(row.get("extraction_confidence") or 0)),
            )
            for raw_text in raw_spellings:
                raw_color_id = stable_id("rawcol", raw_text)
                observation_raw_ids[observation_id].add(raw_color_id)
                con.execute(
                    "INSERT OR IGNORE INTO observation_raw_colors VALUES (?, ?)",
                    (observation_id, raw_color_id),
                )

            source_key = (
                observation_id, int(row["pdf_page"]), row.get("source_candidate_id"), row.get("source_block_index"),
                row.get("source_row_index"), evidence,
            )
            if source_key in source_seen:
                continue
            source_seen.add(source_key)
            source_id = stable_id("src", *source_key)
            con.execute(
                """INSERT INTO observation_sources
                   (source_id, observation_id, document_id, pdf_page, printed_page, candidate_id, block_index, row_index, bbox_json, evidence_text)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    source_id, observation_id, document_id, int(row["pdf_page"]), printed_page,
                    row.get("source_candidate_id"), row.get("source_block_index"), row.get("source_row_index"),
                    json.dumps(bbox, ensure_ascii=False) if bbox is not None else None, evidence,
                ),
            )

    # Manually reviewed range interiors are standard answer terms even when
    # the exact standalone spelling does not occur in an observation row.
    for term in sorted(known_policy_terms()):
        normalized = normalize_colors(term)[0]
        con.execute(
            "INSERT OR IGNORE INTO colors VALUES (?, ?, ?, ?)",
            (
                stable_id("col", normalized["key"]),
                normalized["key"],
                normalized["display"],
                normalized["kind"],
            ),
        )

    color_name_to_id = {
        row["display_name"]: row["color_id"]
        for row in con.execute("SELECT color_id, display_name FROM colors")
    }
    missing_terms = missing_policy_terms(color_name_to_id)
    if missing_terms:
        raise ValueError(f"Color policy references terms absent from the dataset: {sorted(missing_terms)}")
    disallowed_terms = DISALLOWED_COLOR_TERMS & set(color_name_to_id)
    if disallowed_terms:
        raise ValueError(f"Disallowed color terms entered the dataset: {sorted(disallowed_terms)}")

    for source_name, target_names in COLOR_GENERALIZATIONS.items():
        for target_name in target_names:
            con.execute(
                "INSERT OR IGNORE INTO color_connections VALUES (?, ?, 'broader')",
                (color_name_to_id[source_name], color_name_to_id[target_name]),
            )

    for raw_color_id, spec in raw_mapping_specs.items():
        for color_name, mapping_kind in spec["mappings"].items():
            color_id = color_name_to_id.get(color_name)
            if not color_id:
                raise ValueError(f"Raw color {spec['raw']!r} maps to unknown term {color_name!r}")
            con.execute(
                "INSERT OR IGNORE INTO raw_color_mappings VALUES (?, ?, ?)",
                (raw_color_id, color_id, mapping_kind),
            )

    reason_priority = {
        "exact": 5,
        "range_endpoint": 4,
        "alternative": 3,
        "range_interior": 2,
        "broader": 1,
    }
    observation_primary_colors = {
        row["observation_id"]: row["color_id"]
        for row in con.execute("SELECT observation_id, color_id FROM observations")
    }
    for observation_id, primary_color_id in observation_primary_colors.items():
        accepted: dict[str, str] = {primary_color_id: "exact"}
        for raw_color_id in observation_raw_ids.get(observation_id, set()):
            raw_text = str(raw_mapping_specs[raw_color_id]["raw"])
            for color_name, reason in accepted_terms_for_raw(raw_text).items():
                color_id = color_name_to_id[color_name]
                previous = accepted.get(color_id)
                if previous is None or reason_priority[reason] > reason_priority[previous]:
                    accepted[color_id] = reason
        for color_id, reason in accepted.items():
            con.execute(
                "INSERT OR IGNORE INTO observation_accepted_colors VALUES (?, ?, ?)",
                (observation_id, color_id, reason),
            )

    con.execute(
        """UPDATE observations SET source_count =
           (SELECT COUNT(*) FROM observation_sources s WHERE s.observation_id = observations.observation_id)"""
    )

    # Eligibility describes whether an observation can safely participate in a
    # generator; it does not materialize any question.
    rows = con.execute(
        """SELECT o.*, c.color_kind, s.formula_quality FROM observations o
           JOIN colors c ON c.color_id = o.color_id
           JOIN substances s ON s.substance_id = o.substance_id"""
    ).fetchall()
    by_subject_qualifier: dict[tuple, set[str]] = defaultdict(set)
    for row in rows:
        qualifier = (row["substance_id"], row["physical_state"], row["observation_kind"], row["medium"], row["conditions"])
        by_subject_qualifier[qualifier].add(row["color_id"])
    for row in rows:
        qualifier = (row["substance_id"], row["physical_state"], row["observation_kind"], row["medium"], row["conditions"])
        simple_color = row["color_kind"] in {"single", "composite"}
        formula_safe = row["formula_quality"] != "suspicious"
        color_eligible = int(simple_color and formula_safe)
        selection_eligible = int(simple_color and formula_safe)
        has_multiple_colors = len(by_subject_qualifier[qualifier]) > 1
        note = "同一物质允许多个正确颜色" if has_multiple_colors else None
        if not formula_safe:
            note = "化学式需人工校正"
        con.execute(
            "UPDATE observations SET color_question_eligible=?, selection_question_eligible=?, ambiguity_note=? WHERE observation_id=?",
            (color_eligible, selection_eligible, note, row["observation_id"]),
        )

    metadata = {
        "schema_version": "1.2.0",
        "dataset_version": "1.4.0",
        "source_high_confidence_rows": str(len(high)),
        "build_policy": "non-exercise; confidence>=0.75; no uncertainty flags",
        "formula_display": "canonical text + mhchem",
        "color_semantics": "raw bidirectional mappings + directed standard-term generalizations",
    }
    con.executemany("INSERT INTO metadata VALUES (?, ?)", metadata.items())
    con.commit()

    substance_rows = [dict(row) for row in con.execute("SELECT * FROM substances ORDER BY formula_sort_key, display_label")]
    color_rows = [dict(row) for row in con.execute("SELECT * FROM colors ORDER BY display_name")]
    observation_rows = [dict(row) for row in con.execute("SELECT * FROM observations ORDER BY observation_id")]
    sources_by_observation: dict[str, list[dict]] = defaultdict(list)
    for row in con.execute(
        """SELECT source_id, observation_id, pdf_page, printed_page, candidate_id, block_index,
                  row_index, bbox_json, evidence_text FROM observation_sources ORDER BY pdf_page, source_id"""
    ):
        item = dict(row)
        item["bbox"] = json.loads(item.pop("bbox_json")) if item.get("bbox_json") else None
        sources_by_observation[row["observation_id"]].append(item)

    substance_map = {row["substance_id"]: row for row in substance_rows}
    color_map = {row["color_id"]: row for row in color_rows}
    accepted_by_observation: dict[str, list[str]] = defaultdict(list)
    acceptance_reasons_by_observation: dict[str, dict[str, str]] = defaultdict(dict)
    for row in con.execute(
        "SELECT observation_id, color_id, reason FROM observation_accepted_colors ORDER BY observation_id, color_id"
    ):
        accepted_by_observation[row["observation_id"]].append(row["color_id"])
        acceptance_reasons_by_observation[row["observation_id"]][row["color_id"]] = row["reason"]
    raw_colors_by_observation: dict[str, list[str]] = defaultdict(list)
    for row in con.execute(
        """SELECT r.observation_id, e.raw_text FROM observation_raw_colors r
           JOIN raw_color_expressions e ON e.raw_color_id = r.raw_color_id
           ORDER BY r.observation_id, e.raw_text"""
    ):
        raw_colors_by_observation[row["observation_id"]].append(row["raw_text"])
    aliases_by_color: dict[str, list[str]] = defaultdict(list)
    for row in con.execute(
        """SELECT m.color_id, e.raw_text FROM raw_color_mappings m
           JOIN raw_color_expressions e ON e.raw_color_id = m.raw_color_id
           ORDER BY m.color_id, e.raw_text"""
    ):
        aliases_by_color[row["color_id"]].append(row["raw_text"])
    runtime_observations = []
    for row in observation_rows:
        substance = substance_map[row["substance_id"]]
        color = color_map[row["color_id"]]
        runtime_observations.append({
            "id": row["observation_id"],
            "substanceId": row["substance_id"],
            "colorId": row["color_id"],
            "formula": substance["formula_canonical"],
            "formulaMhchem": substance["formula_mhchem"],
            "focusElement": substance["focus_element"],
            "name": substance["preferred_name"],
            "displayLabel": substance["display_label"],
            "displayMode": substance["display_mode"],
            "color": color["display_name"],
            "colorKind": color["color_kind"],
            "sourceColors": raw_colors_by_observation[row["observation_id"]],
            "acceptedColorIds": accepted_by_observation[row["observation_id"]] or [row["color_id"]],
            "acceptanceReasons": acceptance_reasons_by_observation[row["observation_id"]],
            "physicalState": row["physical_state"],
            "observationKind": row["observation_kind"],
            "medium": row["medium"],
            "conditions": row["conditions"],
            "colorQuestionEligible": bool(row["color_question_eligible"]),
            "selectionQuestionEligible": bool(row["selection_question_eligible"]),
            "sources": sources_by_observation[row["observation_id"]],
        })

    payload = {
        "metadata": {
            **metadata,
            "substanceCount": len(substance_rows),
            "colorCount": len(color_rows),
            "observationCount": len(observation_rows),
            "sourceCount": len(source_seen),
            "colorQuestionEligibleCount": sum(item["colorQuestionEligible"] for item in runtime_observations),
            "selectionQuestionEligibleCount": sum(item["selectionQuestionEligible"] for item in runtime_observations),
            "rawColorExpressionCount": len(raw_mapping_specs),
            "colorConnectionCount": sum(len(targets) for targets in COLOR_GENERALIZATIONS.values()),
        },
        "colors": [{
            "id": row["color_id"],
            "name": row["display_name"],
            "kind": row["color_kind"],
            "acceptedColorIds": [color_name_to_id[name] for name in accepted_terms(row["display_name"])],
            "sourceAliases": aliases_by_color[row["color_id"]],
        } for row in color_rows],
        "rawColorMappings": [{
            "id": raw_color_id,
            "raw": spec["raw"],
            "normalized": spec["normalized"],
            "kind": spec["kind"],
            "colorIds": [color_name_to_id[name] for name in spec["mappings"]],
            "colors": list(spec["mappings"]),
        } for raw_color_id, spec in sorted(raw_mapping_specs.items(), key=lambda item: str(item[1]["raw"]))],
        "observations": runtime_observations,
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    con.close()
    return payload["metadata"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--json", type=Path, default=DEFAULT_JSON)
    args = parser.parse_args()
    summary = build(args.input, args.db, args.json)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

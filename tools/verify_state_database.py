from __future__ import annotations

import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path


DB_PATH = Path(__file__).resolve().parents[1] / "data" / "chemistry.sqlite"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REQUIRED_COLUMNS = {
    "physical_state",
    "state_category",
    "state_form",
    "state_form_raw",
    "state_variant_type",
    "state_variant_label_raw",
    "state_basis",
    "state_evidence_text",
    "state_evidence_scope",
    "state_confidence",
    "state_inference_rule",
    "state_reference_condition",
    "state_notes",
}


def main() -> int:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    columns = {row[1] for row in con.execute("PRAGMA table_info(observations)")}
    missing = REQUIRED_COLUMNS - columns
    if missing:
        raise AssertionError(f"Missing state columns: {sorted(missing)}")

    rows = con.execute("SELECT * FROM observations").fetchall()
    if any(not row["physical_state"] or not row["state_category"] for row in rows):
        raise AssertionError("Every observation must have a display state and category")
    if any(not row["state_basis"] or not row["state_inference_rule"] for row in rows):
        raise AssertionError("Every observation must retain its state provenance")

    corrected = [dict(row) for row in con.execute(
        """SELECT s.formula_canonical, o.physical_state, o.state_category, o.state_form,
                  o.state_basis, o.medium, o.conditions, o.state_inference_rule
             FROM observations o
             JOIN substances s ON s.substance_id = o.substance_id
            WHERE s.formula_canonical IN ('IF3', '(NH4)2S', 'CrF6')
            ORDER BY s.formula_canonical"""
    )]
    if any(row["formula_canonical"] == "CrF6" for row in corrected):
        raise AssertionError("CrF6 must not be present")
    if not any(
        row["formula_canonical"] == "IF3"
        and row["state_category"] == "solid"
        and "低温下" in (row["conditions"] or "")
        for row in corrected
    ):
        raise AssertionError("IF3 low-temperature solid correction is missing")
    if not any(
        row["formula_canonical"] == "(NH4)2S"
        and row["state_category"] == "solution"
        and row["medium"] == "水"
        for row in corrected
    ):
        raise AssertionError("(NH4)2S aqueous-solution correction is missing")

    summary = {
        "observationCount": len(rows),
        "stateCategories": dict(sorted(Counter(row["state_category"] for row in rows).items())),
        "stateUnknownCount": sum(row["state_category"] == "unknown" for row in rows),
        "requiredStateColumns": sorted(REQUIRED_COLUMNS),
        "correctedRows": corrected,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    con.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

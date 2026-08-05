from __future__ import annotations

import json
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = APP_ROOT.parent
INPUT_PATH = WORKSPACE / "extraction" / "reaction_draft" / "reactions.json"
SUMMARY_PATH = WORKSPACE / "extraction" / "reaction_draft" / "summary.json"
OUTPUT_PATH = APP_ROOT / "public" / "reactions.quiz.v1.json"


def main() -> None:
    reactions = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    summary = json.loads(SUMMARY_PATH.read_text(encoding="utf-8"))
    payload = {
        "metadata": {
            "schemaVersion": summary["schema_version"],
            "reactionCount": summary["reaction_candidates"],
            "parsedCount": summary["parsed_reactions"],
            "balancedCount": summary["balanced_reactions"],
            "pagesScanned": summary["ocr_pages_scanned"],
        },
        "reactions": [
            {
                "id": row["reaction_id"],
                "equationRaw": row["equation_raw"],
                "equationCanonical": row["equation_canonical"],
                "equationKind": row["equation_kind"],
                "direction": row["direction"],
                "balanceStatus": row["balance_status"],
                "parseStatus": row["parse_status"],
                "isExercise": row["is_exercise"],
                "uncertaintyFlags": row["uncertainty_flags"],
                "eligibleForQuiz": row["review_status"] != "rejected",
                "participants": [
                    {
                        "side": item["side"],
                        "position": item["position"],
                        "formulaRaw": item["formula_raw"],
                        "formulaCanonical": item["formula_canonical"],
                        "coefficientNum": item["coefficient_num"],
                        "coefficientDen": item["coefficient_den"],
                        "phase": item["phase"],
                        "formationMarker": item["formation_marker"],
                        "parseStatus": item["parse_status"],
                    }
                    for item in row["participants"]
                ],
                "conditions": [
                    {
                        "type": item["condition_type"],
                        "operator": item["operator"],
                        "valueText": item["value_text"],
                        "valueNum": item["value_num"],
                        "valueNumHigh": item["value_num_high"],
                        "unit": item["unit"],
                        "relatedFormula": item["related_formula"],
                        "normalizedValue": item["normalized_value"],
                        "rawText": item["raw_text"],
                    }
                    for item in row["conditions"]
                ],
                "source": {
                    "pdfPage": row["source"]["pdf_page"],
                    "printedPage": row["source"]["printed_page"],
                    "heading": row["source"]["heading"],
                    "evidenceText": row["source"]["evidence_text"],
                    "markdownPath": row["source"]["markdown_path"],
                    "lineStart": row["source"]["line_start"],
                    "lineEnd": row["source"]["line_end"],
                },
            }
            for row in reactions
        ],
    }
    OUTPUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Wrote {len(payload['reactions'])} reactions to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()

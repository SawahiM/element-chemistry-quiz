from __future__ import annotations

import re
from collections.abc import Iterable


# Directed edges mean "a description using the key may also be answered with
# the value".  The reverse direction is intentionally not implied.
COLOR_GENERALIZATIONS: dict[str, tuple[str, ...]] = {
    "暗红色": ("红色",),
    "暗灰色": ("灰色",),
    "暗绿色": ("绿色",),
    "暗棕色": ("棕色",),
    "淡黄色": ("黄色",),
    "淡蓝色": ("蓝色",),
    "淡紫色": ("紫色",),
    "粉红色": ("粉色",),
    "橙红色": ("橙色",),
    "橙黄色": ("橙色",),
    "黄橙色": ("黄色",),
    "橘黄色": ("橙色",),
    "灰黑色": ("灰色", "黑色"),
    "蓝黑色": ("黑色",),
    "绿黑色": ("黑色",),
    "红黑色": ("黑色",),
    "金黄色": ("黄色",),
    "近白色": ("白色",),
    "近黑色": ("黑色",),
    "近无色": ("无色",),
    "柠檬黄色": ("黄色",),
    "浅粉色": ("粉色",),
    "浅黄色": ("黄色",),
    "浅蓝绿色": ("蓝绿色",),
    "浅蓝色": ("蓝色",),
    "浅绿色": ("绿色",),
    "深红色": ("红色",),
    "深黄色": ("黄色",),
    "深蓝色": ("蓝色",),
    "深绿色": ("绿色",),
    "深银色": ("银色",),
    "银白色": ("银色", "白色"),
    "砖红色": ("红色",),
    # This is an explicit exception requested for a dark neutral blend.
    "棕黑色": ("棕色", "黑色"),
}


# Manually reviewed placements from the full-text OCR audit.  Keep this table
# explicit and separate so later judgment changes do not affect raw-expression
# parsing or range mechanics.
OCR_INITIAL_GENERALIZATIONS: dict[str, tuple[str, ...]] = {
    "亮黄色": ("黄色",),
    "亮绿色": ("绿色",),
    "淡红色": ("红色",),
    "红黄色": ("红色", "黄色", "橙色"),
    "土黄色": ("黄色", "棕色", "棕黄色"),
    "橄榄绿色": ("绿色", "黄绿色"),
    "黑绿色": ("黑色", "绿色"),
    "白黄色": ("白色", "黄色"),
    "红绿色": ("红色", "绿色"),
    "灰蓝绿色": ("灰蓝色", "蓝绿色"),
    "玫瑰色": ("粉色", "红色"),
    "深蓝紫色": ("蓝紫色",),
    "蓝紫色": ("紫色",),
    "黑棕色": ("棕色", "深棕色"),
    "紫黑色": ("紫色", "深紫色"),
    "褐色": ("棕色",),
    "灰绿色": ("灰色", "绿色"),
    "橘红色": ("橙红色",),
    "乳白色": ("白色",),
    "鲜红色": ("红色",),
    "黑灰色": ("灰色", "深灰色"),
    "浅红色": ("红色",),
    "桃红色": ("粉色", "红色"),
    "洋红色": ("红色", "紫色"),
    "银黄色": ("黄色",),
    "棕褐色": ("棕色", "褐色"),
}

COLOR_GENERALIZATIONS.update(OCR_INITIAL_GENERALIZATIONS)


# These OCR spellings should exist in the runtime bidirectional raw mapping
# even when their observations remain excluded by confidence/exercise policy.
OCR_ADDITIONAL_RAW_EXPRESSIONS = tuple(OCR_INITIAL_GENERALIZATIONS) + (
    "玫瑰",
    "粉红色、黄色",
)

# “深色” carries no hue and is intentionally unavailable as either an answer
# or a distractor.
DISALLOWED_COLOR_TERMS = frozenset(("深色",))


# A hyphen in the appendix is a range, not a concatenated compound color.
# End points are always accepted; these are the standard terms that lie
# naturally inside each range and occur in the current textbook vocabulary.
RANGE_INTERMEDIATES: dict[frozenset[str], tuple[str, ...]] = {
    frozenset(("白色", "黄色")): ("浅黄色", "淡黄色"),
    frozenset(("白色", "灰色")): ("近白色", "灰白色", "浅灰色"),
    frozenset(("白色", "绿色")): ("白绿色", "浅绿色", "淡绿色"),
    frozenset(("白色", "蓝色")): ("浅蓝色", "淡蓝色"),
    frozenset(("白色", "银色")): ("银白色",),
    frozenset(("灰色", "黑色")): ("暗灰色", "深灰色", "灰黑色", "近黑色"),
    frozenset(("黄色", "橙色")): ("黄橙色", "橙黄色", "橘黄色"),
    frozenset(("红色", "橙色")): ("橙红色",),
    frozenset(("红色", "黄色")): ("橙红色", "橙色", "橙黄色", "黄橙色", "橘黄色"),
    frozenset(("黄色", "绿色")): ("黄绿色",),
    frozenset(("黄色", "棕色")): ("黄棕色", "棕黄色"),
    frozenset(("红色", "棕色")): ("红棕色", "棕红色"),
    frozenset(("棕色", "黑色")): ("深棕色", "暗棕色", "棕黑色"),
    frozenset(("红色", "紫色")): ("紫红色",),
    frozenset(("蓝色", "绿色")): ("蓝绿色", "青色",),
    frozenset(("蓝色", "黑色")): ("蓝黑色", "深蓝色"),
    frozenset(("绿色", "黑色")): ("暗绿色", "绿黑色", "墨绿色"),
    frozenset(("红色", "黑色")): ("暗红色", "红黑色", "近黑色"),
    frozenset(("银色", "灰色")): ("银灰色", "浅灰色"),
    frozenset(("金色", "黄色")): ("金黄色",),
}


# RANGE_INTERMEDIATES is an explicit, manually reviewed table.  Every listed
# interior term conflicts with both endpoints, regardless of whether its name
# is a lexical blend (黄棕色) or an independent hue name (青色、橙色).
RANGE_ENDPOINT_CONNECTIONS: dict[str, tuple[str, ...]] = {}
for endpoints, intermediates in RANGE_INTERMEDIATES.items():
    for intermediate in intermediates:
        existing = RANGE_ENDPOINT_CONNECTIONS.get(intermediate, ())
        RANGE_ENDPOINT_CONNECTIONS[intermediate] = tuple(
            dict.fromkeys((*existing, *sorted(endpoints)))
        )

for intermediate, endpoints in RANGE_ENDPOINT_CONNECTIONS.items():
    existing = COLOR_GENERALIZATIONS.get(intermediate, ())
    COLOR_GENERALIZATIONS[intermediate] = tuple(dict.fromkeys((*existing, *endpoints)))


def compact(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def normalize_color_atom(value: str) -> str:
    value = compact(value)
    if value == "无色":
        return value
    return value if value.endswith("色") else f"{value}色"


def normalize_raw_expression(value: str) -> str:
    return (
        compact(value)
        .replace("－", "-")
        .replace("—", "-")
        .replace("–", "-")
        .replace("至", "-")
        .replace("或", "/")
        .replace("、", "/")
    )


def expression_kind(value: str) -> str:
    normalized = normalize_raw_expression(value)
    if "/" in normalized:
        return "alternative"
    if "-" in normalized:
        return "range"
    return "atom"


def direct_terms(value: str) -> list[str]:
    """Return the explicitly written standard terms, without range interiors."""
    normalized = normalize_raw_expression(value)
    result: list[str] = []
    for branch in normalized.split("/"):
        for atom in branch.split("-"):
            if compact(atom):
                term = normalize_color_atom(atom)
                if term in DISALLOWED_COLOR_TERMS:
                    continue
                if term not in result:
                    result.append(term)
    return result


def mapped_terms(value: str) -> dict[str, str]:
    """Map one raw textbook spelling to all directly acceptable standard terms."""
    normalized = normalize_raw_expression(value)
    branches = [branch for branch in normalized.split("/") if compact(branch)]
    result: dict[str, str] = {}
    for branch in branches:
        atoms = [
            term
            for atom in branch.split("-")
            if compact(atom)
            for term in (normalize_color_atom(atom),)
            if term not in DISALLOWED_COLOR_TERMS
        ]
        for atom in atoms:
            result.setdefault(atom, "alternative" if len(branches) > 1 else "exact")
        if len(atoms) > 1:
            for left, right in zip(atoms, atoms[1:]):
                for intermediate in RANGE_INTERMEDIATES.get(frozenset((left, right)), ()):
                    result.setdefault(intermediate, "range_interior")
                result[left] = "range_endpoint"
                result[right] = "range_endpoint"
    return result


def accepted_terms(term: str) -> list[str]:
    """Return the reflexive, transitive closure of the directed color graph."""
    result: list[str] = []
    pending = [term]
    while pending:
        current = pending.pop(0)
        if current in result:
            continue
        result.append(current)
        pending.extend(COLOR_GENERALIZATIONS.get(current, ()))
    return result


def accepted_terms_for_raw(value: str) -> dict[str, str]:
    result = dict(mapped_terms(value))
    for term in tuple(result):
        for accepted in accepted_terms(term):
            result.setdefault(accepted, "broader")
    return result


def known_policy_terms() -> set[str]:
    terms = set(COLOR_GENERALIZATIONS)
    for targets in COLOR_GENERALIZATIONS.values():
        terms.update(targets)
    for endpoints, intermediates in RANGE_INTERMEDIATES.items():
        terms.update(endpoints)
        terms.update(intermediates)
    return terms


def missing_policy_terms(available: Iterable[str]) -> set[str]:
    return known_policy_terms() - set(available)

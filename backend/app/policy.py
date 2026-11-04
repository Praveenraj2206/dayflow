from pathlib import Path
from decimal import Decimal
import re

from .domain import PolicyDocument, Rules, canonical, fingerprint

POLICY_PATH = Path(__file__).resolve().parents[2] / "docs" / "mock-policy.md"
if not POLICY_PATH.exists():
    POLICY_PATH = Path(__file__).resolve().parents[2].parent / "docs" / "mock-policy.md"

CITATIONS = {
    "daily_minutes": "DF-004",
    "double_minutes": "DF-004",
    "weekly_minutes": "DF-004",
    "night_differential": "DF-003",
    "first_meal_minutes": "DF-005",
    "second_meal_minutes": "DF-005",
    "meal_length": "DF-005",
    "first_waiver_limit": "DF-005",
    "second_waiver_limit": "DF-005",
    "tolerance_minutes": "DF-006",
    "long_shift_minutes": "DF-006",
    "comp_cap": "DF-008",
}


def baseline() -> PolicyDocument:
    source = POLICY_PATH.read_text()
    sections = re.split(r"^## (DF-\d{3}) - ", source, flags=re.MULTILINE)
    clauses = {sections[i]: sections[i + 1].strip() for i in range(1, len(sections), 2)}
    return PolicyDocument(version="dayflow-usd-v1", clauses=clauses, rules=Rules())


def compile_policy(document: PolicyDocument) -> dict:
    required = {f"DF-{i:03}" for i in range(1, 12)}
    if set(document.clauses) != required:
        raise ValueError("Exactly the supported DF-001 through DF-011 clauses are required")
    mappings = []
    for field, clause in CITATIONS.items():
        value = getattr(document.rules, field)
        text = document.clauses[clause]
        normalized = text.replace(",", "")
        literals = {Decimal(n) for n in re.findall(r"\d+(?:\.\d+)?", normalized)}
        if Decimal(value) not in literals:
            raise ValueError(f"{field}={value} has no literal supporting value in {clause}")
        mappings.append({"field": field, "value": str(value), "clause": clause, "source": text})
    return {
        "document": document.model_dump(mode="json"),
        "hash": fingerprint(document),
        "source_hash": fingerprint(document.clauses),
        "mappings": mappings,
        "compiler": "bounded-policy-v1",
        "canonical": canonical(document),
    }

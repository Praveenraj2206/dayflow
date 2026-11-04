import sqlite3
from datetime import date, datetime

from fastapi import HTTPException
import pytest

from app.data import generate
from app.domain import Correction, Employee, Timecard, canonical, fingerprint
from app.policy import baseline, compile_policy
from app.services import Service


def signed(service, users):
    source = service.policies(users["avery"])["versions"][0]
    service.sign(source["id"], source["content_hash"], users["avery"])
    return source


def proposal(service, users, *, sign=True):
    if sign:
        signed(service, users)
    cards, _, fixes = generate()
    identity, fix = next(iter(fixes.items()))
    card = next(c for c in cards if c.id == identity)
    row = service.propose(identity, Correction.model_validate(fix), 1, users["avery"])
    return card, row


def test_full_approval_persistence_and_null_delta(service, users):
    card, row = proposal(service, users)
    blocked = service.verify(row["id"], users["avery"])
    assert not blocked["verified"] and blocked["employee_confirmation_required"]
    service.attest(row["id"], "employee_confirmation", "I confirm this work record.", users[card.employee.id])
    proof = service.verify(row["id"], users["avery"])
    assert proof["verified"], proof["failures"]
    assert proof["periods"][0]["before"]["total"] is None
    assert proof["periods"][0]["delta"] is None
    assert proof["periods"][0]["after"]["total"] is not None
    with pytest.raises(HTTPException, match="Self-approval"):
        service.approve(row["id"], proof["hash"], users["avery"])
    with pytest.raises(HTTPException, match="stale"):
        service.approve(row["id"], "0" * 64, users["taylor"])
    result = service.approve(row["id"], proof["hash"], users["taylor"])
    assert not result["idempotent"]
    assert service.approve(row["id"], proof["hash"], users["taylor"])["idempotent"]
    reopened = Service(service.db)
    detail = reopened.detail(card.id, users["avery"])
    assert detail["card"]["revision"] == 2
    assert fingerprint(detail["card"]) == proof["periods"][0]["candidate_hash"]
    assert detail["pay"] == proof["periods"][0]["after"]
    assert reopened.audit_log(users["avery"])["integrity"]
    assert reopened.audit_log(users["avery"])["unverified_commits"] == 0


def test_unsigned_and_policy_change_block(service, users):
    card, row = proposal(service, users, sign=False)
    with pytest.raises(HTTPException, match="Sign and activate"):
        service.verify(row["id"], users["avery"])
    signed(service, users)
    document = baseline()
    document.version = "new-reviewed-version"
    new = service.compile(document, users["avery"])
    service.sign(new["id"], new["hash"], users["taylor"])
    with pytest.raises(HTTPException, match="Policy activation changed"):
        service.verify(row["id"], users["avery"])


def test_stale_proposal_rejected(service, users):
    card, first = proposal(service, users)
    second = service.propose(card.id, Correction.model_validate(first["correction"]), 1, users["avery"])
    service.attest(first["id"], "employee_confirmation", "I confirm this work record.", users[card.employee.id])
    proof = service.verify(first["id"], users["avery"])
    service.approve(first["id"], proof["hash"], users["taylor"])
    with pytest.raises(HTTPException, match="Source records changed"):
        service.verify(second["id"], users["avery"])


def test_authorization_and_references(service, users):
    card, row = proposal(service, users)
    other = users["e030"] if card.employee.id != "e030" else users["e029"]
    with pytest.raises(HTTPException):
        service.detail(card.id, other)
    with pytest.raises(HTTPException):
        service.attest(row["id"], "employee_confirmation", "Not the subject employee.", users["taylor"])
    with pytest.raises(HTTPException):
        service.verify(row["id"], users[card.employee.id])
    correction = Correction.model_validate(row["correction"])
    correction.clauses = ["INVENTED"]
    with pytest.raises(HTTPException, match="does not exist"):
        service.propose(card.id, correction, 1, users["avery"])
    correction.clauses = ["DF-006"]
    correction.evidence = ["shift:invented"]
    with pytest.raises(HTTPException, match="unknown evidence"):
        service.propose(card.id, correction, 1, users["avery"])


def test_rejected_correction_and_dispute(service, users):
    card, row = proposal(service, users)
    service.reject(row["id"], "The proposed time is not substantiated.", users["taylor"])
    with pytest.raises(HTTPException):
        service.verify(row["id"], users["avery"])
    detail = service.detail(card.id, users[card.employee.id])
    line = detail["pay"]["lines"][0]["id"]
    dispute = service.dispute(card.id, line, "This earnings line needs review.", users[card.employee.id])
    service.resolve(dispute["id"], "Reviewed the source evidence with employee.", users["taylor"])
    persisted = service.detail(card.id, users[card.employee.id])["disputes"][0]
    assert persisted["resolution"] == "Reviewed the source evidence with employee."
    with pytest.raises(HTTPException):
        service.resolve(dispute["id"], "Repeated resolution is not permitted.", users["taylor"])


@pytest.mark.parametrize("statement", [
    "UPDATE cards SET revision=revision+1",
    "DELETE FROM cards",
    "UPDATE audit SET actor='forged'",
    "DELETE FROM audit",
    "UPDATE policies SET version='forged'",
])
def test_database_guards(service, statement):
    with pytest.raises(sqlite3.IntegrityError):
        with service.db.transaction() as cx:
            cx.execute(statement)


def test_atomic_rollback_on_write_error(service, users):
    card, row = proposal(service, users)
    service.attest(row["id"], "employee_confirmation", "I confirm this work record.", users[card.employee.id])
    proof = service.verify(row["id"], users["avery"])
    with service.db.transaction() as cx:
        cx.execute("CREATE TRIGGER force_failure BEFORE UPDATE ON cards "
                   "BEGIN SELECT RAISE(ABORT,'simulated write failure'); END")
    with pytest.raises(sqlite3.IntegrityError):
        service.approve(row["id"], proof["hash"], users["taylor"])
    assert service.detail(card.id, users["avery"])["card"]["revision"] == 1
    with service.db.connect() as cx:
        assert cx.execute("SELECT COUNT(*) FROM approvals").fetchone()[0] == 0
        assert cx.execute("SELECT COUNT(*) FROM write_permits").fetchone()[0] == 0


def test_policy_compiler_rejects_unsupported_source():
    document = baseline()
    compiled = compile_policy(document)
    assert len(compiled["mappings"]) == 12
    document.rules.night_differential = "3"
    with pytest.raises(ValueError):
        compile_policy(document)


def test_cross_period_outside_history_rejected(service, users):
    card, row = proposal(service, users)
    correction = Correction.model_validate(row["correction"])
    correction.edits[0].start = correction.edits[0].start.replace(year=2027)
    correction.edits[0].end = correction.edits[0].end.replace(year=2027)
    correction.edits[0].breaks = []
    new = service.propose(card.id, correction, 1, users["avery"])
    service.attest(new["id"], "employee_confirmation", "I confirm the proposed source.", users[card.employee.id])
    proof = service.verify(new["id"], users["avery"])
    assert not proof["verified"]
    assert any("neighboring periods" in message for message in proof["failures"])


def cross_period_proposal(service, users, *, closed_neighbor=False):
    signed(service, users)
    employee = Employee.model_validate({
        **generate()[0][0].employee.model_dump(), "id": "cross", "hourly_rate": "20",
    })
    # Reverse lexical identifiers ensure history follows dates, not record names.
    cards = [
        Timecard(id=identity, employee=employee, period_start=start,
                 period_status="closed" if closed_neighbor and index else "open",
                 as_of=datetime.fromisoformat("2026-11-30T00:00:00-05:00"))
        for index, (identity, start) in enumerate([
            ("cross-z", date(2026, 11, 2)), ("cross-a", date(2026, 11, 16)),
        ])
    ]
    with service.db.transaction() as cx:
        for card in cards:
            cx.execute("INSERT INTO cards VALUES(?,?,?,?,?)",
                       (card.id, employee.id, 1, canonical(card), fingerprint(card)))
    correction = Correction.model_validate({
        "reason": "Manager source evidence supports the additional overnight work.",
        "clauses": ["DF-006"], "evidence": ["note"],
        "edits": [{"operation": "add", "shift_id": "overnight",
                   "start": "2026-11-15T23:30:00-05:00", "end": "2026-11-16T00:30:00-05:00",
                   "breaks": []}],
    })
    row = service.propose(cards[0].id, correction, 1, users["avery"])
    service.attest(row["id"], "manager_attestation", "Reviewed the work evidence.", users["avery"])
    return cards, row, service.verify(row["id"], users["avery"])


def test_cross_period_atomic_commit_and_chronological_history(service, users):
    cards, row, proof = cross_period_proposal(service, users)
    assert proof["verified"], proof["failures"]
    assert [period["card_id"] for period in proof["periods"]] == [c.id for c in cards]
    assert [period["after"]["total"] for period in proof["periods"]] == ["11.00", "11.00"]
    service.approve(row["id"], proof["hash"], users["taylor"])
    for period in proof["periods"]:
        detail = Service(service.db).detail(period["card_id"], users["avery"])
        assert detail["card"]["revision"] == 2
        assert fingerprint(detail["card"]) == period["candidate_hash"]
        assert detail["pay"] == period["after"]


def test_cross_period_closed_neighbor_blocks_all_writes(service, users):
    cards, row, proof = cross_period_proposal(service, users, closed_neighbor=True)
    assert not proof["verified"]
    assert any("cross-a is closed" in failure for failure in proof["failures"])
    with pytest.raises(HTTPException, match="verified proof"):
        service.approve(row["id"], proof["hash"], users["taylor"])
    assert all(service.detail(c.id, users["avery"])["card"]["revision"] == 1 for c in cards)


def test_cross_period_second_write_failure_rolls_back_first(service, users):
    cards, row, proof = cross_period_proposal(service, users)
    assert proof["verified"], proof["failures"]
    with service.db.transaction() as cx:
        cx.execute("CREATE TRIGGER fail_second BEFORE UPDATE ON cards WHEN OLD.id='cross-a' "
                   "BEGIN SELECT RAISE(ABORT,'second period failed'); END")
    with pytest.raises(sqlite3.IntegrityError, match="second period failed"):
        service.approve(row["id"], proof["hash"], users["taylor"])
    assert all(service.detail(c.id, users["avery"])["card"]["revision"] == 1 for c in cards)
    with service.db.connect() as cx:
        assert cx.execute("SELECT COUNT(*) FROM approvals").fetchone()[0] == 0
        assert cx.execute("SELECT COUNT(*) FROM write_permits").fetchone()[0] == 0
    assert service.audit_log(users["avery"])["integrity"]

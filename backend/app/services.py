from __future__ import annotations

from datetime import datetime, time, timedelta
from decimal import Decimal
from functools import lru_cache
import json
import os
import secrets
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from .data import generate
from .db import Database, audit, audit_integrity, now, password_hash, uid
from .domain import (
    Correction, Employment, PolicyDocument, Timecard, WorkShift, canonical, fingerprint, utc,
)
from .engine import calculate, minute_instants, money
from .policy import baseline, compile_policy


def fail(message, status=409):
    raise HTTPException(status_code=status, detail=message)


def reviewer(user):
    if user["role"] != "reviewer":
        fail("An authorized reviewer is required", 403)


@lru_cache(maxsize=512)
def cached_pay(payload, policy):
    document = PolicyDocument.model_validate_json(policy)
    return calculate(
        Timecard.model_validate_json(payload), document.rules, document.version
    ).model_dump(mode="json")


class Service:
    def __init__(self, database: Database):
        self.db = database
        self.seed()

    def seed(self):
        with self.db.transaction() as cx:
            if cx.execute("SELECT 1 FROM meta WHERE key='seed_version'").fetchone():
                return
            password = os.environ.get("DAYFLOW_DEMO_PASSWORD", "Dayflow-demo-2026!")
            users = [
                ("avery", "avery@dayflow.demo", "Avery Quinn", "reviewer", None),
                ("taylor", "taylor@dayflow.demo", "Taylor Reed", "reviewer", None),
            ]
            cards, _, _ = generate()
            for card in cards[::2]:
                e = card.employee
                users.append((e.id, f"{e.id}@dayflow.demo", e.name, "employee", e.id))
            for identity, email, name, role, employee_id in users:
                salt = secrets.token_hex(16)
                cx.execute("INSERT INTO users VALUES(?,?,?,?,?,?,?)", (
                    identity, email, name, role, employee_id, salt, password_hash(password, salt),
                ))
            for card in cards:
                cx.execute("INSERT INTO cards VALUES(?,?,?,?,?)", (
                    card.id, card.employee.id, card.revision, canonical(card), fingerprint(card),
                ))
            compiled = compile_policy(baseline())
            cx.execute("INSERT INTO policies VALUES(?,?,?,?,?,?,?)", (
                "baseline", compiled["document"]["version"], canonical(compiled["document"]),
                compiled["hash"], compiled["source_hash"], "fixture", now(),
            ))
            cx.execute("INSERT INTO meta VALUES('seed_version','1')")
            audit(cx, "fixture", "synthetic_dataset_created", "dataset", {
                "seed": 42, "employees": 30, "periods": 2, "cards": len(cards),
                "policy_status": "unsigned", "synthetic_only": True,
            })

    def policy(self, cx, require_signed=False):
        active = cx.execute("SELECT value FROM meta WHERE key='active_policy'").fetchone()
        identity = active["value"] if active else "baseline"
        row = cx.execute("SELECT * FROM policies WHERE id=?", (identity,)).fetchone()
        signature = cx.execute(
            "SELECT * FROM policy_signatures WHERE policy_id=?", (identity,)
        ).fetchone()
        if require_signed and not signature:
            fail("Sign and activate a reviewed policy ruleset before verification")
        return dict(row), bool(signature)

    def llm_enabled(self):
        with self.db.connect() as cx:
            row = cx.execute("SELECT value FROM meta WHERE key='llm_enabled'").fetchone()
        return not row or row["value"] == "1"

    def llm_model(self):
        with self.db.connect() as cx:
            row = cx.execute("SELECT value FROM meta WHERE key='llm_model'").fetchone()
        return row["value"] if row else None

    def set_llm(self, enabled, user, model=None):
        reviewer(user)
        with self.db.transaction() as cx:
            cx.execute("INSERT INTO meta VALUES('llm_enabled',?) "
                       "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                       ("1" if enabled else "0",))
            if model:
                cx.execute("INSERT INTO meta VALUES('llm_model',?) "
                           "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (model,))
            audit(cx, user["id"], "llm_toggled", "llm", {"enabled": enabled, "model": model})
        return {"enabled": enabled, "model": model or self.llm_model()}

    def all_cards(self, cx, employee_id=None):
        if employee_id:
            rows = cx.execute(
                "SELECT payload FROM cards WHERE employee_id=? ORDER BY id", (employee_id,)
            ).fetchall()
        else:
            rows = cx.execute("SELECT payload FROM cards ORDER BY id").fetchall()
        cards = [Timecard.model_validate_json(row["payload"]) for row in rows]
        return sorted(cards, key=lambda card: (card.period_start, card.id))

    def card(self, cx, identity, user):
        row = cx.execute("SELECT payload FROM cards WHERE id=?", (identity,)).fetchone()
        if not row:
            fail("Timecard not found", 404)
        card = Timecard.model_validate_json(row["payload"])
        if user["role"] == "employee" and user["employee_id"] != card.employee.id:
            fail("You can access only your own timecards", 403)
        return card

    def materialize(self, card, cards):
        result = card.model_copy(deep=True)
        zone = ZoneInfo(card.employee.timezone)
        start = utc(datetime.combine(card.period_start, time(0), zone))
        end = utc(datetime.combine(card.period_end, time(0), zone))
        for other in cards:
            if other.id == card.id:
                continue
            for shift in other.shifts:
                if shift.start and shift.end and utc(shift.start) < end and utc(shift.end) >= start:
                    result.shifts.append(shift)
        return result

    def pay(self, card, cards, document):
        return cached_pay(canonical(self.materialize(card, cards)), document)

    def policies(self, user):
        with self.db.connect() as cx:
            active, signed = self.policy(cx)
            rows = cx.execute(
                """SELECT p.*,s.signer,s.signed_at FROM policies p
                LEFT JOIN policy_signatures s ON s.policy_id=p.id ORDER BY p.created_at DESC"""
            ).fetchall()
            return {
                "active_id": active["id"] if signed else None,
                "versions": [{
                    **{k: row[k] for k in ("id", "version", "content_hash", "source_hash",
                                          "created_at", "created_by", "signer", "signed_at")},
                    **compile_policy(PolicyDocument.model_validate_json(row["document"])),
                } for row in rows],
            }

    def compile(self, document, user):
        reviewer(user)
        try:
            compiled = compile_policy(document)
        except ValueError as exc:
            fail(str(exc), 422)
        identity = uid("pol-")
        with self.db.transaction() as cx:
            if cx.execute("SELECT 1 FROM policies WHERE version=?", (document.version,)).fetchone():
                fail("Policy version already exists; choose a new immutable version")
            cx.execute("INSERT INTO policies VALUES(?,?,?,?,?,?,?)", (
                identity, document.version, canonical(document), compiled["hash"],
                compiled["source_hash"], user["id"], now(),
            ))
            audit(cx, user["id"], "policy_compiled", identity, {
                "hash": compiled["hash"], "source_hash": compiled["source_hash"],
            })
        return {"id": identity, **compiled}

    def sign(self, identity, digest, user):
        reviewer(user)
        with self.db.transaction() as cx:
            row = cx.execute("SELECT * FROM policies WHERE id=?", (identity,)).fetchone()
            if not row:
                fail("Policy not found", 404)
            if row["content_hash"] != digest:
                fail("Policy hash changed; review the source again")
            compiled = compile_policy(PolicyDocument.model_validate_json(row["document"]))
            if compiled["hash"] != digest:
                fail("Stored ruleset failed integrity verification")
            if not cx.execute(
                "SELECT 1 FROM policy_signatures WHERE policy_id=?", (identity,)
            ).fetchone():
                cx.execute("INSERT INTO policy_signatures VALUES(?,?,?,?)",
                           (identity, user["id"], now(), digest))
            cx.execute(
                "INSERT INTO meta VALUES('active_policy',?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (identity,)
            )
            audit(cx, user["id"], "policy_signed_and_activated", identity, {"hash": digest})
        return {"status": "active", "id": identity, "hash": digest}

    def list_cards(self, user):
        with self.db.connect() as cx:
            cards = self.all_cards(cx, user["employee_id"] if user["role"] == "employee" else None)
            policy, signed = self.policy(cx)
            rows = []
            for card in cards:
                peers = [c for c in cards if c.employee.id == card.employee.id]
                result = self.pay(card, peers, policy["document"])
                latest = cx.execute(
                    "SELECT state FROM proposals WHERE card_id=? ORDER BY created_at DESC LIMIT 1",
                    (card.id,),
                ).fetchone()
                rows.append({
                    "id": card.id, "employee": card.employee.model_dump(mode="json"),
                    "period_start": str(card.period_start), "period_end": str(card.period_end),
                    "revision": card.revision, "period_status": card.period_status,
                    "pay_status": result["status"], "total": result["total"],
                    "work_minutes": result["work_minutes"],
                    "overtime_minutes": result["overtime_minutes"],
                    "exceptions": result["exceptions"], "reasons": result["reasons"],
                    "workflow": latest["state"] if latest else "detected",
                })
            return {"cards": rows, "policy_signed": signed, "policy_version": policy["version"]}

    def detail(self, identity, user):
        with self.db.connect() as cx:
            card = self.card(cx, identity, user)
            policy, signed = self.policy(cx)
            cards = self.all_cards(cx, card.employee.id)
            proposals = []
            for row in cx.execute(
                "SELECT * FROM proposals WHERE card_id=? ORDER BY created_at DESC", (identity,)
            ):
                proposals.append(self.proposal_json(cx, row))
            disputes = self.disputes_for(cx, identity)
            investigations = [{
                "id": row["id"], "at": row["at"], "result": json.loads(row["result"]),
            } for row in cx.execute(
                "SELECT * FROM investigations WHERE card_id=? ORDER BY at DESC LIMIT 20", (identity,)
            )]
            return {
                "card": card.model_dump(mode="json"),
                "pay": self.pay(card, cards, policy["document"]),
                "policy_signed": signed, "policy_hash": policy["content_hash"],
                "proposals": proposals, "disputes": disputes, "investigations": investigations,
            }

    def proposal_json(self, cx, row):
        result = dict(row)
        result["correction"] = json.loads(row["correction"])
        result["proof"] = json.loads(row["proof"]) if row["proof"] else None
        result["attestations"] = [dict(r) for r in cx.execute(
            "SELECT * FROM attestations WHERE proposal_id=? ORDER BY at", (row["id"],)
        )]
        result["approval"] = next(({
            "id": r["id"], "actor": r["actor"], "at": r["at"], "proof_hash": r["proof_hash"],
        } for r in cx.execute("SELECT * FROM approvals WHERE proposal_id=?", (row["id"],))), None)
        return result

    def validate_references(self, card, correction, document):
        evidence = {"note"} | {f"shift:{s.id}" for s in card.shifts} | {
            f"schedule:{s.id}" for s in card.schedules
        } | {f"leave:{s.id}" for s in card.leave}
        if not set(correction.evidence) <= evidence:
            fail("Correction cites unknown evidence", 422)
        if not set(correction.clauses) <= set(document.clauses):
            fail("Correction cites a clause that does not exist", 422)

    def propose(self, identity, correction, revision, user, parent_id=None):
        with self.db.transaction() as cx:
            card = self.card(cx, identity, user)
            if card.period_status != "open":
                fail("Corrections are allowed only on open periods")
            if revision != card.revision:
                fail("Timecard revision is stale")
            policy, _ = self.policy(cx)
            document = PolicyDocument.model_validate_json(policy["document"])
            self.validate_references(card, correction, document)
            if parent_id:
                parent = cx.execute("SELECT card_id FROM proposals WHERE id=?", (parent_id,)).fetchone()
                if not parent or parent["card_id"] != identity:
                    fail("Parent correction must belong to this timecard", 422)
            cards = self.all_cards(cx, card.employee.id)
            proposal_id = uid("fix-")
            cx.execute(
                """INSERT INTO proposals(id,card_id,author,correction,input_hash,policy_id,
                state,created_at,parent_id) VALUES(?,?,?,?,?,?,'proposed',?,?)""",
                (proposal_id, identity, user["id"], canonical(correction),
                 fingerprint([c.model_dump(mode="json") for c in cards]), policy["id"],
                 now(), parent_id),
            )
            audit(cx, user["id"], "correction_proposed", proposal_id, {
                "card_id": identity, "input_revision": revision,
                "correction_hash": fingerprint(correction), "parent_id": parent_id,
            })
            return self.proposal_json(
                cx, cx.execute("SELECT * FROM proposals WHERE id=?", (proposal_id,)).fetchone()
            )

    def attest(self, proposal_id, kind, reason, user):
        with self.db.transaction() as cx:
            row = cx.execute("SELECT * FROM proposals WHERE id=?", (proposal_id,)).fetchone()
            if not row:
                fail("Correction not found", 404)
            card = self.card(cx, row["card_id"], user)
            if row["state"] in ("committed", "rejected"):
                fail("This correction is closed")
            if kind == "employee_confirmation":
                if user["employee_id"] != card.employee.id:
                    fail("Only the subject employee can confirm worked time", 403)
            else:
                reviewer(user)
            cx.execute("INSERT INTO attestations VALUES(?,?,?,?,?,?)",
                       (uid("att-"), proposal_id, user["id"], kind, reason, now()))
            cx.execute("UPDATE proposals SET state='proposed',proof=NULL WHERE id=?", (proposal_id,))
            audit(cx, user["id"], kind, proposal_id, {"reason": reason})
        return {"status": "recorded", "kind": kind}

    def apply_edits(self, target, correction):
        result = target.model_copy(deep=True)
        for edit in correction.edits:
            matches = [s for s in result.shifts if s.id == edit.shift_id]
            if edit.operation == "add":
                if matches:
                    fail("Cannot add a shift whose identifier already exists", 422)
                result.shifts.append(WorkShift(
                    id=edit.shift_id, start=edit.start, end=edit.end, breaks=edit.breaks,
                ))
            elif edit.operation == "remove":
                if not matches:
                    fail("Cannot remove an unknown shift", 422)
                # Removing one duplicated event must not erase the valid original.
                result.shifts.remove(matches[-1])
            else:
                if len(matches) != 1:
                    fail("Replacement requires exactly one matching shift", 422)
                original = matches[0]
                if (original.start, original.end, original.breaks) != (
                    edit.start, edit.end, edit.breaks
                ):
                    original.first_waiver = False
                    original.second_waiver = False
                    original.work_approved = False
                original.start, original.end, original.breaks = edit.start, edit.end, edit.breaks
        return result

    def worked_by_date(self, card):
        zone = ZoneInfo(card.employee.timezone)
        result = {}
        for shift in card.shifts:
            if not shift.start or not shift.end or utc(shift.end) <= utc(shift.start):
                return None
            if (utc(shift.end) - utc(shift.start)) > timedelta(days=2):
                return None
            unpaid = set()
            for br in shift.breaks:
                if (utc(br.end) <= utc(br.start) or utc(br.start) < utc(shift.start)
                        or utc(br.end) > utc(shift.end)):
                    return None
                current = set(minute_instants(br.start, br.end))
                if unpaid & current:
                    return None
                unpaid |= current
            for instant in minute_instants(shift.start, shift.end):
                if instant not in unpaid:
                    result.setdefault(instant.astimezone(zone).date(), set()).add(instant)
        return {day: len(instants) for day, instants in result.items()}

    def compute_proof(self, cx, row, user):
        card = self.card(cx, row["card_id"], user)
        policy, _ = self.policy(cx, require_signed=True)
        if policy["id"] != row["policy_id"]:
            fail("Policy activation changed; create a fresh correction revision")
        original_cards = self.all_cards(cx, card.employee.id)
        input_hash = fingerprint([c.model_dump(mode="json") for c in original_cards])
        if input_hash != row["input_hash"]:
            fail("Source records changed; create and re-verify a fresh correction revision")
        correction = Correction.model_validate_json(row["correction"])
        self.validate_references(card, correction,
                                 PolicyDocument.model_validate_json(policy["document"]))
        candidate = self.apply_edits(card, correction)
        attests = cx.execute(
            "SELECT * FROM attestations WHERE proposal_id=?", (row["id"],)
        ).fetchall()
        confirmed = any(a["kind"] == "employee_confirmation" for a in attests)
        manager = any(a["kind"] == "manager_attestation" for a in attests)
        before_work, after_work = self.worked_by_date(card), self.worked_by_date(candidate)
        reduction = before_work is None or after_work is None or any(
            after_work.get(day, 0) < count for day, count in (before_work or {}).items()
        )
        failures = []
        if card.period_status != "open":
            failures.append("The source period is closed")
        zone = ZoneInfo(card.employee.timezone)
        coverage_start = utc(datetime.combine(original_cards[0].period_start, time(0), zone))
        coverage_end = utc(datetime.combine(original_cards[-1].period_end, time(0), zone))
        for edit in correction.edits:
            existing = [s for s in card.shifts if s.id == edit.shift_id]
            for shift in [*existing, *[s for s in candidate.shifts if s.id == edit.shift_id]]:
                if any(value and not coverage_start <= utc(value) <= coverage_end
                       for value in (shift.start, shift.end)):
                    failures.append("Cross-period edit requires all affected neighboring periods")
                if (card.employee.employment == Employment.salaried_exempt
                        and shift.work_approved and shift.end
                        and utc(shift.end) == coverage_end):
                    failures.append("Comp-off credit requires the following period to exist")
        for earlier, later in zip(original_cards, original_cards[1:]):
            if earlier.period_end != later.period_start:
                failures.append("Employee pay-period history has a gap")
        if reduction and not confirmed:
            failures.append("Employee confirmation of this revision is required for reduced/unknown time")
        if not (confirmed or manager):
            failures.append("Employee confirmation or evidence-backed manager attestation is required")
        candidates = [candidate if c.id == candidate.id else c.model_copy(deep=True)
                      for c in original_cards]
        before_results = {
            c.id: self.pay(c, original_cards, policy["document"]) for c in original_cards
        }
        results, changed = {}, []
        for index, current in enumerate(candidates):
            if current.employee.employment == Employment.salaried_exempt and index:
                previous = results[candidates[index - 1].id]
                if previous["closing_comp_minutes"] is None:
                    if current.period_start >= candidate.period_start:
                        failures.append("Earlier comp-off balance is incomplete")
                else:
                    current.opening_comp_minutes = previous["closing_comp_minutes"]
            result = self.pay(current, candidates, policy["document"])
            results[current.id] = result
            original = next(c for c in original_cards if c.id == current.id)
            contextual_change = (
                result != before_results[current.id]
                or fingerprint(current) != fingerprint(original)
            )
            if current.id == candidate.id or contextual_change:
                if current.period_status != "open":
                    failures.append(f"Affected period {current.id} is closed")
                if result["status"] != "complete":
                    failures.extend(f"{current.id}: {r}" for r in result["reasons"])
                current.revision += 1
                changed.append(current)
        proofs = []
        for current in changed:
            before, after = before_results[current.id], results[current.id]
            delta = money(Decimal(after["total"]) - Decimal(before["total"])) \
                if after["total"] is not None and before["total"] is not None else None
            proofs.append({
                "card_id": current.id,
                "original_hash": fingerprint(next(c for c in original_cards if c.id == current.id)),
                "candidate_hash": fingerprint(current), "before": before, "after": after,
                "delta": delta,
                "delta_reason": None if delta is not None else "Original or candidate pay is incomplete",
            })
        proof = {
            "verified": not failures, "verifier": "dayflow-full-period-v1",
            "input_hash": input_hash, "correction_hash": fingerprint(correction),
            "policy_hash": policy["content_hash"], "policy_id": policy["id"],
            "employee_confirmation_required": reduction, "failures": list(dict.fromkeys(failures)),
            "periods": proofs,
            "attestation_ids": sorted(a["id"] for a in attests),
        }
        proof["hash"] = fingerprint(proof)
        return proof, changed

    def verify(self, proposal_id, user):
        reviewer(user)
        with self.db.transaction() as cx:
            row = cx.execute("SELECT * FROM proposals WHERE id=?", (proposal_id,)).fetchone()
            if not row:
                fail("Correction not found", 404)
            if row["state"] in ("committed", "rejected"):
                fail("Correction is already closed")
            proof, _ = self.compute_proof(cx, row, user)
            cx.execute("UPDATE proposals SET proof=?,state=? WHERE id=?", (
                canonical(proof), "verified" if proof["verified"] else "manual_review", proposal_id,
            ))
            audit(cx, user["id"], "verification_passed" if proof["verified"]
                  else "verification_blocked", proposal_id, {
                      "hash": proof["hash"], "failures": proof["failures"],
                  })
            return proof

    def approve(self, proposal_id, expected_hash, user):
        reviewer(user)
        with self.db.transaction() as cx:
            row = cx.execute("SELECT * FROM proposals WHERE id=?", (proposal_id,)).fetchone()
            if not row:
                fail("Correction not found", 404)
            existing = cx.execute(
                "SELECT * FROM approvals WHERE proposal_id=?", (proposal_id,)
            ).fetchone()
            if existing:
                if existing["actor"] != user["id"] or existing["proof_hash"] != expected_hash:
                    fail("Correction was already committed by a different approval")
                return {"status": "committed", "approval_id": existing["id"], "idempotent": True}
            card = self.card(cx, row["card_id"], user)
            if user["id"] == row["author"] or user["employee_id"] == card.employee.id:
                fail("Self-approval is prohibited; another reviewer must approve", 403)
            if row["state"] != "verified" or not row["proof"]:
                fail("A current verified proof is required")
            proof, changed = self.compute_proof(cx, row, user)
            if not proof["verified"] or proof["hash"] != expected_hash:
                fail("Verification is stale or no longer passes; verify again")
            approval_id = uid("apr-")
            cx.execute("INSERT INTO approvals VALUES(?,?,?,?,?,?)", (
                approval_id, proposal_id, user["id"], proof["hash"], canonical(proof), now(),
            ))
            for current in changed:
                old_revision = current.revision - 1
                digest = fingerprint(current)
                cx.execute("INSERT INTO write_permits VALUES(?,?,?,?)",
                           (current.id, old_revision, digest, approval_id))
                cx.execute("UPDATE cards SET revision=?,payload=?,content_hash=? WHERE id=?",
                           (current.revision, canonical(current), digest, current.id))
                cx.execute("DELETE FROM write_permits WHERE card_id=?", (current.id,))
            cx.execute("UPDATE proposals SET state='committed' WHERE id=?", (proposal_id,))
            audit(cx, user["id"], "verified_correction_committed", proposal_id, {
                "approval_id": approval_id, "proof_hash": proof["hash"],
                "periods": [c.id for c in changed],
            })
            return {"status": "committed", "approval_id": approval_id, "idempotent": False}

    def reject(self, proposal_id, reason, user):
        reviewer(user)
        with self.db.transaction() as cx:
            row = cx.execute("SELECT * FROM proposals WHERE id=?", (proposal_id,)).fetchone()
            if not row:
                fail("Correction not found", 404)
            if row["state"] == "committed":
                fail("Committed corrections cannot be rejected")
            cx.execute("UPDATE proposals SET state='rejected' WHERE id=?", (proposal_id,))
            audit(cx, user["id"], "correction_rejected", proposal_id, {"reason": reason})
        return {"status": "rejected"}

    def disputes_for(self, cx, identity):
        return [dict(row) for row in cx.execute(
            """SELECT d.*,r.actor AS resolved_by,r.reason AS resolution,r.created_at AS resolved_at
            FROM disputes d LEFT JOIN dispute_resolutions r ON r.dispute_id=d.id
            WHERE d.card_id=? ORDER BY d.created_at DESC""", (identity,)
        )]

    def dispute(self, identity, line_id, reason, user):
        with self.db.transaction() as cx:
            card = self.card(cx, identity, user)
            if user["employee_id"] != card.employee.id:
                fail("Only the subject employee may dispute their pay", 403)
            policy, _ = self.policy(cx)
            pay = self.pay(card, self.all_cards(cx, card.employee.id), policy["document"])
            if line_id and line_id not in {line["id"] for line in pay["lines"]}:
                fail("Pay line does not exist on this timecard", 422)
            identity_new = uid("dsp-")
            cx.execute("INSERT INTO disputes VALUES(?,?,?,?,?,?,?)", (
                identity_new, identity, user["id"], line_id, card.revision, reason, now(),
            ))
            audit(cx, user["id"], "pay_disputed", identity_new, {
                "card_id": identity, "line_id": line_id, "revision": card.revision, "reason": reason,
            })
        return {"id": identity_new, "status": "open"}

    def resolve(self, identity, reason, user):
        reviewer(user)
        with self.db.transaction() as cx:
            if not cx.execute("SELECT 1 FROM disputes WHERE id=?", (identity,)).fetchone():
                fail("Dispute not found", 404)
            if cx.execute("SELECT 1 FROM dispute_resolutions WHERE dispute_id=?", (identity,)).fetchone():
                fail("Dispute is already resolved")
            cx.execute("INSERT INTO dispute_resolutions VALUES(?,?,?,?)",
                       (identity, user["id"], reason, now()))
            audit(cx, user["id"], "dispute_resolved", identity, {"reason": reason})
        return {"status": "resolved"}

    def audit_log(self, user):
        reviewer(user)
        with self.db.connect() as cx:
            rows = [dict(row) for row in cx.execute("SELECT * FROM audit ORDER BY sequence DESC")]
            for row in rows:
                row["details"] = json.loads(row["details"])
            return {"events": rows, "integrity": audit_integrity(cx),
                    "unverified_commits": cx.execute(
                        """SELECT COUNT(*) FROM audit a WHERE action='verified_correction_committed'
                        AND NOT EXISTS(SELECT 1 FROM approvals p
                        WHERE p.proposal_id=a.entity)"""
                    ).fetchone()[0]}

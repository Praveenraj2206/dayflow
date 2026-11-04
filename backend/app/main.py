from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import os
from pathlib import Path
import time

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import Field, StrictBool

from .agent import Provider, investigate
from .db import Database, audit, now, password_hash, uid
from .domain import Correction, DISCLAIMER, Model, PolicyDocument, canonical
from .services import Service, fail, reviewer


class Login(Model):
    email: str = Field(max_length=120)
    password: str = Field(max_length=200)


class Reason(Model):
    reason: str = Field(min_length=8, max_length=2000)


class Sign(Model):
    hash: str = Field(min_length=64, max_length=64)
    reviewed: StrictBool


class ProposalInput(Model):
    revision: int = Field(ge=1)
    correction: Correction
    parent_id: str | None = None


class Attest(Reason):
    kind: str = Field(pattern=r"^(employee_confirmation|manager_attestation)$")


class Approval(Model):
    proof_hash: str = Field(min_length=64, max_length=64)


class DisputeInput(Reason):
    line_id: str | None = Field(default=None, max_length=200)


def create_app(database_path=None):
    @asynccontextmanager
    async def lifespan(app):
        app.state.service = Service(Database(database_path))
        app.state.failed_logins = {}
        yield

    app = FastAPI(title="Dayflow", version="0.1.0", lifespan=lifespan,
                  description=f"Verified timecard exception resolution. {DISCLAIMER}.")

    @app.middleware("http")
    async def request_guards(request: Request, call_next):
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            allowed = {
                "http://localhost:5173", "http://127.0.0.1:5173",
                "http://localhost:8000", "http://127.0.0.1:8000",
            } | set(filter(None, os.environ.get("DAYFLOW_ALLOWED_ORIGINS", "").split(",")))
            if origin and origin not in allowed:
                return Response("Origin not allowed", status_code=403)
            try:
                length = int(request.headers.get("content-length", "0"))
            except ValueError:
                return Response("Invalid content length", status_code=400)
            if length < 0:
                return Response("Invalid content length", status_code=400)
            if length > 2_000_000:
                return Response("Request too large", status_code=413)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
        return response

    def service(request: Request):
        return request.app.state.service

    def current_user(request: Request, svc=Depends(service)):
        token = request.cookies.get("dayflow_session", "")
        hashed = hashlib.sha256(token.encode()).hexdigest()
        with svc.db.connect() as cx:
            row = cx.execute(
                """SELECT u.id,u.email,u.name,u.role,u.employee_id,s.csrf,s.expires
                FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?""", (hashed,)
            ).fetchone()
            if not row or datetime.fromisoformat(row["expires"]) < datetime.now(timezone.utc):
                fail("Sign in to continue", 401)
            if request.method not in ("GET", "HEAD", "OPTIONS") and not hmac.compare_digest(
                request.headers.get("x-csrf-token", ""), row["csrf"]
            ):
                fail("Invalid CSRF token", 403)
            return dict(row)

    @app.get("/api/health")
    def health():
        return {"status": "ok", "disclaimer": DISCLAIMER}

    @app.post("/api/login")
    def login(payload: Login, request: Request, response: Response, svc=Depends(service)):
        key = (request.client.host if request.client else "local", payload.email.lower())
        prior = request.app.state.failed_logins.get(key, [])
        prior = [timestamp for timestamp in prior if timestamp > time.monotonic() - 300]
        if len(prior) >= 10:
            fail("Too many sign-in attempts; try again later", 429)
        with svc.db.transaction() as cx:
            row = cx.execute("SELECT * FROM users WHERE email=?", (payload.email.lower(),)).fetchone()
            salt = row["salt"] if row else "unknown-account"
            supplied = password_hash(payload.password, salt)
            if not row or not hmac.compare_digest(supplied, row["password_hash"]):
                request.app.state.failed_logins[key] = prior + [time.monotonic()]
                fail("Invalid email or password", 401)
            token, csrf = uid("session-"), uid("csrf-")
            cx.execute("INSERT INTO sessions VALUES(?,?,?,?)", (
                hashlib.sha256(token.encode()).hexdigest(), row["id"], csrf,
                (datetime.now(timezone.utc) + timedelta(hours=8)).isoformat(),
            ))
            audit(cx, row["id"], "session_started", row["id"], {})
            response.set_cookie("dayflow_session", token, httponly=True, samesite="strict",
                                secure=os.environ.get("DAYFLOW_SECURE_COOKIES") == "1",
                                max_age=28800, path="/")
            return {k: row[k] for k in ("id", "email", "name", "role", "employee_id")} | {"csrf": csrf}

    @app.get("/api/me")
    def me(user=Depends(current_user)):
        return {k: v for k, v in user.items() if k != "expires"}

    @app.post("/api/logout")
    def logout(request: Request, response: Response, user=Depends(current_user), svc=Depends(service)):
        with svc.db.transaction() as cx:
            cx.execute("DELETE FROM sessions WHERE token_hash=?", (
                hashlib.sha256(request.cookies["dayflow_session"].encode()).hexdigest(),
            ))
            audit(cx, user["id"], "session_ended", user["id"], {})
        response.delete_cookie("dayflow_session", path="/")
        return {"status": "signed_out"}

    @app.get("/api/cards")
    def cards(user=Depends(current_user), svc=Depends(service)):
        return svc.list_cards(user)

    @app.get("/api/cards/{identity}")
    def card(identity: str, user=Depends(current_user), svc=Depends(service)):
        return svc.detail(identity, user)

    @app.get("/api/policies")
    def policies(user=Depends(current_user), svc=Depends(service)):
        return svc.policies(user)

    @app.post("/api/policies/compile")
    def compile_policy(payload: PolicyDocument, user=Depends(current_user), svc=Depends(service)):
        return svc.compile(payload, user)

    @app.post("/api/policies/{identity}/sign")
    def sign(identity: str, payload: Sign, user=Depends(current_user), svc=Depends(service)):
        if not payload.reviewed:
            fail("Explicit source-to-rule review acknowledgment is required", 422)
        return svc.sign(identity, payload.hash, user)

    @app.post("/api/cards/{identity}/proposals")
    def propose(identity: str, payload: ProposalInput,
                user=Depends(current_user), svc=Depends(service)):
        return svc.propose(identity, payload.correction, payload.revision, user, payload.parent_id)

    @app.post("/api/proposals/{identity}/attest")
    def attest(identity: str, payload: Attest, user=Depends(current_user), svc=Depends(service)):
        return svc.attest(identity, payload.kind, payload.reason, user)

    @app.post("/api/proposals/{identity}/verify")
    def verify(identity: str, user=Depends(current_user), svc=Depends(service)):
        return svc.verify(identity, user)

    @app.post("/api/proposals/{identity}/approve")
    def approve(identity: str, payload: Approval, user=Depends(current_user), svc=Depends(service)):
        return svc.approve(identity, payload.proof_hash, user)

    @app.post("/api/proposals/{identity}/reject")
    def reject(identity: str, payload: Reason, user=Depends(current_user), svc=Depends(service)):
        return svc.reject(identity, payload.reason, user)

    @app.post("/api/cards/{identity}/disputes")
    def dispute(identity: str, payload: DisputeInput, user=Depends(current_user), svc=Depends(service)):
        return svc.dispute(identity, payload.line_id, payload.reason, user)

    @app.post("/api/disputes/{identity}/resolve")
    def resolve(identity: str, payload: Reason, user=Depends(current_user), svc=Depends(service)):
        return svc.resolve(identity, payload.reason, user)

    @app.get("/api/audit")
    def audit_log(user=Depends(current_user), svc=Depends(service)):
        return svc.audit_log(user)

    @app.post("/api/cards/{identity}/investigate")
    def investigation(identity: str, user=Depends(current_user), svc=Depends(service)):
        reviewer(user)
        detail = svc.detail(identity, user)
        with svc.db.connect() as cx:
            card = svc.card(cx, identity, user)
            policy, _ = svc.policy(cx)
        result = investigate(card, detail["pay"],
                             PolicyDocument.model_validate_json(policy["document"]))
        with svc.db.transaction() as cx:
            cx.execute("INSERT INTO investigations VALUES(?,?,?,?,?)",
                       (uid("inv-"), identity, user["id"], canonical(result), now()))
            audit(cx, user["id"], "investigation_completed", identity, {
                "status": result["status"], "mode": result["mode"],
                "critic_safe": result["critic"]["safe"],
            })
        return result

    @app.get("/api/config")
    def config(user=Depends(current_user)):
        provider = Provider()
        return {"llm_mode": provider.mode, "model": provider.model if provider.mode != "off" else None,
                "disclaimer": DISCLAIMER, "dataset": "Synthetic / seed 42",
                "verifier": "dayflow-full-period-v1"}

    @app.get("/api/scorecard")
    def scorecard(user=Depends(current_user)):
        reviewer(user)
        from .evals import detection_scorecard
        return detection_scorecard()

    dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if dist.exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}")
        def frontend(path: str):
            if path.startswith("api/"):
                raise HTTPException(404, "API endpoint not found")
            return FileResponse(dist / "index.html")

    return app


app = create_app()

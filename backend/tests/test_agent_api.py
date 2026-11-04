import json

from fastapi.testclient import TestClient
import httpx
import pytest

from app.agent import Provider, ProviderFailure, investigate, local_critic, validate_investigation
from app.data import generate
from app.domain import CriticVerdict, Investigation
from app.engine import calculate
from app.evals import BENIGN_CASES, INJECTION_CASES
from app.main import create_app
from app.policy import baseline


def response(content):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]},
                          request=httpx.Request("POST", "http://provider.test"))


@pytest.mark.parametrize("note", INJECTION_CASES)
def test_known_injections(note):
    assert not local_critic(note).safe


@pytest.mark.parametrize("note", BENIGN_CASES)
def test_benign_notes(note):
    assert local_critic(note).safe


def test_schema_retry_exactly_once(monkeypatch):
    monkeypatch.setenv("DAYFLOW_LLM_API_KEY", "synthetic-test-value")
    calls = []

    def malformed(*args, **kwargs):
        calls.append(kwargs)
        return response("not json")

    monkeypatch.setattr("app.agent.httpx.post", malformed)
    with pytest.raises(ProviderFailure, match="one retry"):
        Provider().extract(CriticVerdict, "Test", {})
    assert len(calls) == 2
    assert calls[0]["headers"]["Authorization"] == "Bearer synthetic-test-value"
    calls.clear()
    outputs = iter(["bad", '{"safe": true, "reason": "No instruction override."}'])

    def eventual(*args, **kwargs):
        calls.append(kwargs)
        return response(next(outputs))

    monkeypatch.setattr("app.agent.httpx.post", eventual)
    assert Provider().extract(CriticVerdict, "Test", {}).safe
    assert len(calls) == 2


def test_semantic_retry_and_strict_schema(monkeypatch):
    monkeypatch.setenv("DAYFLOW_LLM_API_KEY", "synthetic-test-value")
    card = generate()[0][0]
    bad = {"summary": "Pay is 999 dollars.", "clauses": ["DF-006"],
           "evidence": ["note"], "correction": None}
    good = {**bad, "summary": "Review the cited evidence."}
    outputs = iter([json.dumps(bad), json.dumps(good)])
    monkeypatch.setattr("app.agent.httpx.post", lambda *a, **k: response(next(outputs)))
    value = Provider().extract(
        Investigation, "Test", {}, validate=lambda item: validate_investigation(item, card, baseline())
    )
    assert value.summary == good["summary"]
    with pytest.raises(ValueError):
        CriticVerdict.model_validate({"safe": "true", "reason": "Not a boolean."})
    with pytest.raises(ValueError):
        Investigation.model_validate({**good, "salary": 999})


def test_no_llm_and_missing_provider_manual_review(monkeypatch):
    card = generate()[0][0]
    pay = calculate(card).model_dump(mode="json")
    monkeypatch.setenv("DAYFLOW_LLM_MODE", "off")
    assert investigate(card, pay, baseline())["status"] == "offline"
    monkeypatch.setenv("DAYFLOW_LLM_MODE", "openai")
    monkeypatch.delenv("DAYFLOW_LLM_API_KEY", raising=False)
    assert investigate(card, pay, baseline())["status"] == "manual_review"
    card.note = INJECTION_CASES[0]
    assert investigate(card, pay, baseline())["critic"]["safe"] is False


def test_api_auth_csrf_and_actual_roundtrip(service):
    with TestClient(create_app(service.db.path)) as client:
        assert client.get("/api/cards").status_code == 401
        assert client.get("/api/health").json()["status"] == "ok"
        result = client.post("/api/login", json={
            "email": "avery@dayflow.demo", "password": "Dayflow-demo-2026!",
        })
        assert result.status_code == 200
        csrf = result.json()["csrf"]
        policies = client.get("/api/policies").json()
        policy = policies["versions"][0]
        assert client.post(f"/api/policies/{policy['id']}/sign", json={
            "hash": policy["content_hash"], "reviewed": True,
        }).status_code == 403
        client.headers["X-CSRF-Token"] = csrf
        assert client.post(f"/api/policies/{policy['id']}/sign", json={
            "hash": policy["content_hash"], "reviewed": True,
        }).status_code == 200
        assert len(client.get("/api/cards").json()["cards"]) == 60
        score = client.get("/api/scorecard")
        assert score.status_code == 200
        assert 148 <= score.json()["labelled_exceptions"] <= 160
        client.post("/api/logout")
        client.post("/api/login", json={
            "email": "e001@dayflow.demo", "password": "Dayflow-demo-2026!",
        })
        assert len(client.get("/api/cards").json()["cards"]) == 2
        assert client.get("/api/cards/e002-2026-10-05").status_code == 403
        assert client.get("/api/audit").status_code == 403
        assert client.post("/api/logout", headers={"Origin": "https://untrusted.test"}).status_code == 403

# Dayflow

**Workforce intelligence, with receipts.**

**simplified mock policy, not legal advice**

Dayflow turns timecard exceptions into evidence-backed, independently reproduced
corrections. **The LLM proposes. The engine verifies. A human approves.**
Employees can inspect each earnings line and dispute it without silently changing pay.

This is a functioning, local-first challenge demonstrator, not a payroll service,
legal compliance product, or production-ready identity system. All people and
attendance records are synthetic. No screenshots of workers, location, biometrics,
keystrokes, or other surveillance data are collected.

## Run it

Requirements: Python 3.11+, Node 22+, npm. The verified development environment
uses Python 3.14 and Node 24.

```bash
git clone https://github.com/ketanram-am/dayflow.git
cd dayflow
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock
.venv/bin/python -m pip install --no-deps -e './backend[dev]'
npm ci --prefix frontend
npm run build --prefix frontend
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000**. The first startup creates a persistent SQLite
database with 30 employees, two pay periods, 60 timecards, and 155 independently
labelled exceptions. The initial policy is **unsigned**: preview calculations work,
but verification and commits remain blocked until a reviewer signs it.

For frontend development, run `npm run dev --prefix frontend` in another terminal
and open http://localhost:5173. Vite proxies `/api` to port 8000.
Use `DAYFLOW_API_URL` to change the proxy target.

| Account | Role |
|---|---|
| `avery@dayflow.demo` | Reviewer and proposal author |
| `taylor@dayflow.demo` | Independent reviewer/approver |
| `e001@dayflow.demo` | Maya Chen, employee |
| `e002@dayflow.demo` through `e030@dayflow.demo` | Other employees |

Local demo password: `Dayflow-demo-2026!`. These are real separate cookie sessions,
not a client-side role switch. Set `DAYFLOW_DEMO_PASSWORD` **before the first
database startup** to change the seeded password. The demo identity shortcuts
still display the documented default; enter a custom password manually.

The app does not load `.env` implicitly. Copy `.env.example` for reference, then
export the settings you need in your shell. `DAYFLOW_DB` chooses a database path;
starting with a **new path** creates a fresh unsigned demo without deleting history.
Do not expose demo accounts on the public internet.

## A complete user journey

1. **Review policy.** Open Policy studio, inspect source clauses and all twelve
   executable mappings, then acknowledge review and sign the exact content hash.
   New versions compile into immutable drafts; the original cannot be overwritten.
2. **Investigate.** In Exception desk, select Maya's October 19 period. Inspect
   punches, planned/actual breaks, blocking exceptions, and the untrusted employee note.
   Run an investigation: Maya's intentionally hostile note is flagged by the
   critic and routed to manual review. A benign note receives an explicitly
   labelled offline evidence brief. Detection and derivations work without a model.
3. **Propose.** Draft a punch/break correction. A schedule can populate an
   explicitly unconfirmed suggestion, never proof that work occurred. Proposals
   include evidence and clause references and do not write attendance records.
4. **Confirm.** Unknown or reduced time requires the subject employee's authenticated
   confirmation of that exact immutable proposal. Other corrections can use an
   evidence-backed manager attestation. Switch accounts by signing out and in.
5. **Verify and approve.** Avery verifies the whole period. Another reviewer,
   such as Taylor, must approve. Approval recomputes again inside one SQLite
   transaction and binds source revisions, policy, attestations, candidate hashes,
   and before/after derivations. Stale or invalid changes cannot commit.
6. **Explain and dispute.** Maya sees the persisted earnings, regular rates,
   rounding, source references, and formulas. A per-line or whole-card dispute
   opens a review. Reviewer resolution does not silently alter pay.
7. **Inspect governance.** Audit ledger shows the hash chain, actors, evidence,
   and zero-unverified-commit measurement. Eval scorecard separates deterministic
   synthetic results from unavailable real-model measurements.

## AI-assisted features (all optional, all validated)

**Open-weight models (recommended).** Run locally with Ollama; no key, no data leaves the machine:

```bash
ollama pull gpt-oss:20b          # Apache-2.0 + gpt-oss usage policy (or: ollama pull qwen3:8b, Apache-2.0)
export DAYFLOW_LLM_MODE=ollama DAYFLOW_LLM_MODEL=gpt-oss:20b
```

The Overview page shows the installed models, reachability and licence hint. **Verify the
selected model's licence and acceptable-use terms before use**; the in-app hint is not legal
review. The compiler, explainer and investigator were exercised live against `qwen3:8b`.
Use `DAYFLOW_LLM_MODE=openai` for any hosted OpenAI-compatible endpoint.

With AI configured a reviewer can switch AI on or off at runtime from
the sidebar; off behaves exactly like mode `off` and is audited.

| Feature | Where | Guardrail |
|---|---|---|
| **AI policy compiler** | Policy studio, *Extract rules from policy text* | Each rule needs a verbatim quote; value must literally appear in it; unclear rules keep the reviewed baseline and are flagged. Draft only; a human compiles and signs. |
| **Explain my paycheck** | Pay derivation tab | Model wording only. Every number must appear in the engine trace and cited lines must exist, else one retry then a deterministic template built from the trace. |
| **Policy change replay** | Policy studio, any non-active version | Recomputes the latest period under old and new rulesets with the same engine; per-employee dollar diff. Read-only. |
| **Injection lab** | AI investigation tab | Free text goes through the pattern critic and, when on, a model critic. Never stored. |
| **Unsafe fix demo** | Correction & proof tab | Creates a real overlapping proposal that the verifier must reject; never committed. |

## Architecture and trust boundaries

```text
React / TypeScript glass workspace
        | authenticated cookie + CSRF
FastAPI API ---------------------- OpenAPI: /docs and /openapi.json
        |
        +-- Policy compiler --> immutable source/rules/hash --> human sign-off
        |
        +-- Investigator --> optional structured provider + independent critic
        |                    untrusted notes; no DB capabilities; no pay arithmetic
        |
        +-- Pure Decimal engine --> detectors + full earnings derivation
        |
        +-- Immutable proposal --> confirmation / evidence attestation
        |                          --> full-period verifier --> independent reviewer
        |
        +-- SQLite transaction --> immutable approval + gated timecard revision
                                   + append-only, hash-linked audit
```

| Location | Responsibility |
|---|---|
| `backend/app/domain.py` | Strict Pydantic contracts and timezone-aware timestamps |
| `backend/app/policy.py` | Bounded source-to-rules compiler and clause mappings |
| `backend/app/engine.py` | Pure minute-based Decimal pay, detectors, traces, comp-off |
| `backend/app/data.py` | Seeded synthetic fixtures and independently assigned labels |
| `backend/app/agent.py` | Optional schema-validated provider, one retry, injection critic, fallback |
| `backend/app/services.py` | Authorization, proposals, attestations, proofs, atomic approval, disputes |
| `backend/app/db.py` | Schema, update guards, immutable history, audit hash chain |
| `backend/app/main.py` | API, sessions, CSRF, same-origin guards, static frontend |
| `backend/app/evals.py` | Reproducible detection and workflow scorecards |
| `frontend/src/` | Exception workbench, paycheck explorer, policy studio, ledger, scorecard |

### Payroll decisions

The authoritative fictional source is [docs/mock-policy.md](docs/mock-policy.md):
eleven clauses, twelve reviewed assumptions, and 63 documented worked/boundary examples.
The engine handles hourly non-exempt, salaried non-exempt, and salaried exempt
employees. It implements daily/weekly non-stacking overtime, double time, regular-rate
bonus/differential allocation, meal premiums and source waivers, leave deductions,
and chronological exempt comp-off.

UTC elapsed minutes are attributed to local dates/weeks. Breaks remain separate
from work. Midnight splits reset daily counters without splitting the source meal
obligation. Monetary components aggregate weekly before half-up cent rounding;
meal premiums aggregate per shift-start date. Unknown earnings are `null`, never
zero. The UI formats engine amounts but never calculates earnings.

Every verification recomputes full affected periods, including linked neighboring
periods and comp-off balances. All affected periods must exist and be open.
Changed shift boundaries invalidate old waivers and weekend-work approval:
those trusted facts cannot be copied to materially changed work by the model.
Missing before-pay produces a **null delta**, not an invented dollar savings claim.

The compiler accepts a bounded JSON policy document, not arbitrary employment law.
It validates supported fields, bounds, ordering, and numeric source support.
Literal matching is **not semantic proof**: a human signs the interpretation.
Fixed salary, calendar, rounding, leave, and approval semantics live in the
versioned engine; unsupported rule types require implementation and review.

## Optional LLM

The default is `DAYFLOW_LLM_MODE=off`; no provider credential is required.

```bash
export DAYFLOW_LLM_MODE=openai
export DAYFLOW_LLM_API_KEY='your-provider-key'
export DAYFLOW_LLM_MODEL='your-supported-model'
# Optional OpenAI-compatible provider:
# export DAYFLOW_LLM_BASE_URL='https://your-provider.example/v1'
```

Only enable this for synthetic data and a provider you trust. Enabling it sends
synthetic time evidence and mock policy clauses to that configured provider.
The local pattern critic runs first; a separate structured-model critic runs before
the investigator. Every response is parsed against Pydantic's forbidden-extra
schema and validated for allowed citations and engine-only numeric prose.
Each schema operation has **one retry**, then explicit manual review. Timeout,
invalid JSON, invented citations, forbidden fields, missing keys, or rejected
critic output do not fall back to a fake successful recommendation.

Suggested boundaries are untrusted proposals, never verified work. There is no
provider callback capable of committing attendance, changing pay rates, granting
leave/waivers, signing policy, or approving a correction. Provider calls and
semantic-retry behavior have stub coverage; **a real-provider evaluation has not
been run**, and no general prompt-injection-resistance claim is made.

## Reproduce the evidence

```bash
.venv/bin/pytest backend/tests -q
.venv/bin/ruff check backend
.venv/bin/python -m app.evals
cd frontend
npx playwright install chromium
npm run test:e2e
```

The scorecard writes `artifacts/scorecard.json` and `.md`. CI runs the same commands,
publishes the scorecard and browser artifacts, and fails on detection mismatches or
failed integrity/workflow assertions. The in-app scorecard displays integration
gates only when the artifact's source hash matches the current backend.

Current fixture evidence: 155 labelled exceptions (40 missed-punch, 8 overtime-risk,
60 schedule-conflict, 47 policy-breach); 10 independently eligible missing-punch
corrections; 10 known-pattern injection cases and 8 benign controls. Detection
precision is `TP/(TP+FP)`, recall is `TP/(TP+FN)`. Fix acceptance means **verifier**
acceptance of eligible fixtures, not manager acceptance in the real world.
The held-out seed varies rates and notes within the same six scenario templates;
it is not unseen scenario or real-world validation.

Negative coverage includes unsigned/stale policy, changed source records,
self-approval, wrong employee, missing confirmation, tampered proof hash,
unsupported rosters, invalid offsets, overlaps, comp-off shortfalls, failed
transaction writes, unauthorized access, and direct unverified database updates.
Browser coverage exercises distinct authenticated identities and persistence,
not just mocked dashboard screenshots.

## Interface design

The UI uses one stylesheet (`frontend/src/dayflow.css`). The palette is deep
navy, royal blue and a sky-blue accent on a white canvas. Glass is used only
over the navy page header. Text is set in Instrument Sans, and every figure is
set in JetBrains Mono so columns align. Each workspace has its own layout:

- the exception desk is a queue with a detail pane and a scheduled-vs-recorded
  timeline;
- the pay explorer is a derivation ledger;
- the policy studio shows parameters next to their source clause;
- the audit ledger is a hash chain.

The UI displays engine output only; it never computes pay.

## What is and is not new

Missed-punch detection, regularization, overtime reports, scheduling alerts,
and manager approval already exist in workforce systems. Dayflow does not claim
these as inventions. The demonstration emphasizes visible signed rules,
proof-carrying corrections, employee-readable derivations/disputes, and a measured
fail-closed harness. The proof is reproducible deterministic evidence, **not an
SMT/formal proof or certification of legal correctness**.

All P2 features (solver repair, per-day jurisdiction,
consented off-the-clock prompts) remain explicitly deferred under the agreed scope.
Taxes, net pay, disbursement, arbitrary statutory policy compilation, and real HRIS
integration are outside this mock policy.

All implementation code here is original to this project. No GPL/AGPL or
unconfirmed-license reference implementation was copied. Direct dependencies
are FastAPI, Pydantic, HTTPX, Uvicorn, React, Vite, TypeScript, and Lucide; their
licenses remain with their respective packages. Research links supplied during
planning were design context, not independently verified evidence or copied code.

## Challenge deliverables

- [Five-slide presentation](docs/deck.html): open locally in a browser; arrow keys
  navigate and print produces five presentation pages.
- [Ten-minute demo runbook](docs/demo.md): exact identities and failure/success flow.
- **Demo video: pending a real recording and upload.** No placeholder is presented
  as a recorded video. Add the actual ten-minute video URL here before submission.

### Operational limits

This demo uses public seeded identities, a shared local password, a single local
workspace, and PBKDF2-backed SQLite sessions. It is not enterprise SSO, tenant
isolation, production authorization provisioning, MFA, key management, a payroll
integration, or an externally audited secure service. Use HTTPS and secure cookies
outside localhost, and replace demo authentication before deployment.
SQLite triggers and hashes protect the application workflow, not against an
administrator who can replace database files or executable code.

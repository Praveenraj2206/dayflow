# Dayflow: ten-minute demo runbook

**simplified mock policy, not legal advice**

Use synthetic data only. Build the frontend, run the evals, and start the backend
against a fresh `DAYFLOW_DB` path before recording. Verify the video capture tool
is recording; this runbook is not itself a recording.

| Time | Show | Explain |
|---|---|---|
| 0:00-0:45 | Login and product framing | “Existing systems already detect exceptions. We focus on making every correction inspectable, independently reproduced, and explicitly approved.” |
| 0:45-1:45 | Avery signs the baseline in Policy studio | Show a clause, compiled threshold, immutable hash, and human acknowledgment. Explain literal checks versus semantic review. Say the mock-policy disclaimer. |
| 1:45-2:45 | Exception desk; Maya, October 19 | Show missing clock-out, source schedule, actual breaks, nullable gross pay. Unknown time is not zero. Expand computed evidence. |
| 2:45-3:30 | Injection critic and manual lane | Run investigation on Maya's deliberately hostile note. Show the instruction-override warning and manual-review routing. Detection and engine derivations remain available with the model off; the note cannot change a rate or approve anything. |
| 3:30-4:30 | Draft correction and try verification | Use the scheduled missing boundary as a suggestion. Cite evidence and explain why it is not proof of work. Verification blocks without employee confirmation. |
| 4:30-5:30 | Sign out; `e001` confirms | Maya reviews every boundary/break and records authenticated confirmation. No attendance has changed yet. |
| 5:30-6:30 | Avery verifies | Show full-period before/after, null dollar delta because baseline pay was unknown, fingerprints, and candidate traces. Avery's own approve button stays disabled. |
| 6:30-7:15 | Taylor approves | Separate account; independent approval recomputes inside the transaction. Show committed revision 2 and reload to demonstrate persistence. |
| 7:15-8:15 | Maya's paycheck and dispute | Expand a monetary line, regular rate, formula, unrounded result, weekly half-up rounding, and source citations. Open a dispute; explain that it never silently changes pay. |
| 8:15-9:00 | Audit ledger | Show policy sign-off, proposal, confirmation, verification, independent approval, immutable commit, intact hash chain, and dispute. State administrator-tampering limitation. |
| 9:00-9:40 | Eval scorecard | Show exact denominators, eligible-fix acceptance, unsafe rejection, known injection patterns plus benign controls, and zero unverified commits. Real-model evaluation is not run. |
| 9:40-10:00 | Scope and close | Three employee classes; no surveillance; no net pay/legal guarantee. Policy replay/P2 deferred. End: “LLM proposes. Engine verifies. Human approves.” |

Accounts: `avery@dayflow.demo`, `taylor@dayflow.demo`, `e001@dayflow.demo`.
Default local password: `Dayflow-demo-2026!`.

For a benign no-LLM segment, select a card with an ordinary employee note and run
investigation. Show the explicitly labelled offline evidence brief, not an
invented assistant response. A live-provider segment is optional and requires
genuine configuration and rehearsal. Neither local patterns nor stub tests
establish general model robustness.

Use `docs/deck.html` as the five-slide companion. Upload the real recording and
replace the pending-video notice in the README with its actual URL before submission.

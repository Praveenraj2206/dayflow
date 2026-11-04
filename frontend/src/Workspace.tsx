import { useEffect, useRef, useState } from "react";
import {
  ArrowDown, ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronDown, Clock3,
  FileText, Fingerprint, GitCompareArrows, LockKeyhole, MessageSquare, Plus,
  ShieldAlert, ShieldCheck, Sparkles, Trash2, X,
} from "lucide-react";
import { api, type Correction, type Detail, type Edit, type Pay, type Proposal, type User } from "./api";
import { currency, duration, friendly, initials, period, type Run } from "./App";

function useModalFocus(active: boolean, close: () => void) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement;
    const dialog = ref.current;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'
    ) || [])];
    focusable()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); if (previous instanceof HTMLElement) previous.focus(); };
  }, [active]);
  return ref;
}

function timeLabel(value: string | null, zone: string) {
  return value ? new Date(value).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: zone,
  }) : "Missing punch";
}

function TraceTable({ pay, onDispute }: { pay: Pay; onDispute?: (id: string) => void }) {
  const weeks = [...new Set(pay.lines.map(line => line.week))];
  return <div className="trace">
    <div className={`pay-total ${pay.total === null ? "incomplete" : ""}`}><div><span className="eyebrow">DETERMINISTIC GROSS EARNINGS</span>
      <h2>{currency(pay.total)}</h2><p>{pay.total === null ? "Partial derivations are visible. Unknown earnings are never treated as zero." : "The sum of rounded component lines. Not net pay or a disbursement."}</p></div>
      <Fingerprint size={32} /></div>
    {pay.reasons.length > 0 && <div className="error-box"><strong>Final pay is blocked</strong><ul>{pay.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>}
    {weeks.map(week => <section key={week} className="trace-week"><h3>Week of {week}<span>{pay.regular_rates[week] ? `Regular rate $${Number(pay.regular_rates[week]).toFixed(6)}` : "Exempt salary basis"}</span></h3>
      <table className="earnings-table"><thead><tr><th>COMPONENT & DERIVATION</th><th className="numeric">GROSS AMOUNT</th>{onDispute && <th />}</tr></thead>
        <tbody>{pay.lines.filter(line => line.week === week).map(line => <tr key={line.id}>
          <td><details><summary><span className="line-label">{line.label}</span><span className="citation">{line.clause}</span><ChevronDown size={13} /></summary>
            <div className="formula"><p>{line.formula}</p><dl><div><dt>Quantity</dt><dd>{line.quantity} {line.unit}</dd></div>
              <div><dt>Unrounded rate</dt><dd>{line.rate}</dd></div><div><dt>Unrounded result</dt><dd>{line.unrounded}</dd></div></dl>
              <small>Weekly component aggregation · ROUND_HALF_UP · source references {line.sources.join(", ") || "approved compensation / leave"}</small></div></details></td>
          <td className={`numeric amount ${Number(line.amount) < 0 ? "negative" : ""}`}>{currency(line.amount)}</td>
          {onDispute && <td><button className="icon-button" title={`Dispute ${line.label}`} aria-label={`Dispute ${line.label}`} onClick={() => onDispute(line.id)}><MessageSquare size={15} /></button></td>}
        </tr>)}</tbody></table>
    </section>)}
    {!!pay.comp_events.length && <section className="bank-ledger"><h3>Comp-off movement <span>{pay.closing_comp_minutes === null ? "Balance incomplete" : `${pay.closing_comp_minutes} minutes closing`}</span></h3>
      {pay.comp_events.map((event, i) => <div key={`${event.source}-${i}`}><span>{event.kind === "leave_debit" ? <ArrowDown size={15} /> : <Plus size={15} />}{friendly(event.kind)}</span>
        <small>{new Date(event.at).toLocaleString()}</small><strong>{event.minutes > 0 ? "+" : ""}{event.minutes} min</strong><span>→ {event.balance ?? "outside period"} min</span></div>)}</section>}
  </div>;
}

function CorrectionEditor({ detail, initial, onClose, run, busy }: {
  detail: Detail; initial?: Correction; onClose: () => void; run: Run; busy: boolean;
}) {
  const modalRef = useModalFocus(true, onClose);
  const original = detail.card.shifts.find(s => !s.start || !s.end) || detail.card.shifts[0];
  const makeEdit = (): Edit => ({ operation: original ? "replace" : "add",
    shift_id: original?.id || detail.card.schedules[0]?.id || "new-shift",
    start: original?.start || null, end: original?.end || null,
    breaks: original?.breaks.map(b => ({ ...b })) || [] });
  const [edits, setEdits] = useState<Edit[]>(initial?.edits || [makeEdit()]);
  const [reason, setReason] = useState(initial?.reason || "");
  const [clauses, setClauses] = useState((initial?.clauses || ["DF-006", "DF-009"]).join(", "));
  const [evidence, setEvidence] = useState((initial?.evidence ||
    [original ? `shift:${original.id}` : "note"]).join(", "));
  const references = (value: string) => value.split(",").map(s => s.trim()).filter(Boolean);
  const update = (index: number, patch: Partial<Edit>) => setEdits(old => old.map((e, i) => i === index ? { ...e, ...patch } : e));
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="correction-title" className="modal large">
      <header><div><span className="eyebrow">PROPOSE, NEVER COMMIT</span><h2 id="correction-title">Draft a correction</h2></div><button className="icon-button" aria-label="Close correction" onClick={onClose}><X size={20} /></button></header>
      <div className="info-box"><LockKeyhole size={17} /><span>This creates an immutable proposal, not a timecard change. Exact evidence, confirmation, full-period verification, and independent approval still apply.</span></div>
      <form onSubmit={e => { e.preventDefault(); run(async () => {
        await api(`/cards/${detail.card.id}/proposals`, "POST", {
          revision: detail.card.revision, correction: { edits, reason, clauses: references(clauses), evidence: references(evidence) },
        }); onClose();
      }, "Correction proposed. No payroll records have changed."); }}>
        {edits.map((edit, index) => <div className="edit-block" key={index}>
          <div className="edit-heading"><strong>Source edit {index + 1}</strong><button type="button" className="icon-button" aria-label={`Remove edit ${index + 1}`} onClick={() => setEdits(old => old.filter((_, i) => i !== index))}><Trash2 size={15} /></button></div>
          <div className="form-grid"><label>Operation<select value={edit.operation} onChange={e => update(index, { operation: e.target.value as Edit["operation"] })}>
            <option value="replace">Replace event boundaries</option><option value="add">Add missed shift</option><option value="remove">Remove event</option></select></label>
            <label>Source shift{edit.operation === "add" ? <input value={edit.shift_id} onChange={e => update(index, { shift_id: e.target.value })} required /> :
              <select value={edit.shift_id} onChange={e => {
                const s = detail.card.shifts.find(s => s.id === e.target.value)!;
                update(index, { shift_id: s.id, start: s.start, end: s.end, breaks: s.breaks });
              }}>{detail.card.shifts.map((s, i) => <option key={`${s.id}-${i}`} value={s.id}>{s.id}</option>)}</select>}</label></div>
          {edit.operation !== "remove" && <>
            <div className="form-grid"><label>Clock-in · timezone-aware ISO<input aria-label={`Clock-in ${index + 1}`} value={edit.start || ""} onChange={e => update(index, { start: e.target.value || null })} placeholder="2026-10-07T09:00:00-04:00" required /></label>
              <label>Clock-out · timezone-aware ISO<input aria-label={`Clock-out ${index + 1}`} value={edit.end || ""} onChange={e => update(index, { end: e.target.value || null })} placeholder="2026-10-07T17:30:00-04:00" required /></label></div>
            <button type="button" className="text-button" onClick={() => {
              const s = detail.card.schedules.find(s => s.id === edit.shift_id);
              if (s) update(index, { start: edit.start || s.start, end: edit.end || s.end });
            }}>Use scheduled missing boundary as an unconfirmed suggestion <ArrowUpRight size={13} /></button>
            <div className="breaks-editor"><span className="field-title">Actual unpaid breaks</span>{edit.breaks.map((b, n) => <div key={n}>
              <input aria-label={`Break start ${index + 1}-${n + 1}`} value={b.start} onChange={e => update(index, { breaks: edit.breaks.map((v, k) => k === n ? { ...v, start: e.target.value } : v) })} required />
              <ArrowRight size={14} /><input aria-label={`Break end ${index + 1}-${n + 1}`} value={b.end} onChange={e => update(index, { breaks: edit.breaks.map((v, k) => k === n ? { ...v, end: e.target.value } : v) })} required />
              <button type="button" className="icon-button" aria-label="Remove break" onClick={() => update(index, { breaks: edit.breaks.filter((_, k) => k !== n) })}><X size={15} /></button></div>)}
              <button type="button" className="text-button" onClick={() => update(index, { breaks: [...edit.breaks, { start: "", end: "" }] })}><Plus size={13} />Add actual break</button></div>
          </>}
        </div>)}
        <button type="button" className="button secondary small" onClick={() => setEdits(old => [...old, makeEdit()])}><Plus size={14} />Add another edit</button>
        <label className="spaced">Reason for correction<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={8} required placeholder="Describe the reviewed source evidence. Do not invent worked time." /></label>
        <label>Clause citations<input value={clauses} onChange={e => setClauses(e.target.value)} required /></label>
        <label>Evidence references<input value={evidence} onChange={e => setEvidence(e.target.value)} required /></label>
        <details className="reference-help"><summary>Available evidence references</summary><code>{[
          ...detail.card.schedules.map(s => `schedule:${s.id}`), ...detail.card.shifts.map(s => `shift:${s.id}`),
          ...detail.card.leave.map(s => `leave:${s.id}`), "note",
        ].join("\n")}</code></details>
        <footer><span>Revision {detail.card.revision} · {detail.card.employee.timezone}</span><button className="button primary" disabled={!edits.length || busy}>Create proposal<ArrowRight size={16} /></button></footer>
      </form>
    </section>
  </div>;
}

function ProposalReview({ proposal, user, run, busy }: { proposal: Proposal; user: User; run: Run; busy: boolean }) {
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const reviewer = user.role === "reviewer";
  const closed = ["committed", "rejected"].includes(proposal.state);
  return <section className="proposal-review">
    <div className="section-heading"><span className={`badge ${proposal.state === "committed" || proposal.state === "verified" ? "green" : "amber"}`}>{friendly(proposal.state)}</span><code>{proposal.id.slice(0, 16)}</code></div>
    <p>{proposal.correction.reason}</p>
    <div className="edit-summary">{proposal.correction.edits.map(e => <div key={e.shift_id}><span>{friendly(e.operation)}</span><code>{e.shift_id}</code><small>{e.start || "—"} <ArrowRight size={11} /> {e.end || "—"}</small>
      {e.breaks.length > 0 && <small>Unpaid breaks: {e.breaks.map(b => `${b.start} → ${b.end}`).join("; ")}</small>}</div>)}</div>
    <div className="citation-row">{proposal.correction.clauses.map(c => <span className="citation" key={c}>{c}</span>)}</div>
    <small className="muted">Evidence: {proposal.correction.evidence.join(", ")}</small>
    {!!proposal.attestations.length && <div className="attestations">{proposal.attestations.map((a, i) => <div key={i}><CheckCheck size={15} /><span>{friendly(a.kind)}<small>{a.actor} · {a.reason}</small></span></div>)}</div>}
    {!closed && <div className="attest-form"><label>Review / confirmation reason<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={8} placeholder={reviewer ? "Describe the independent evidence you reviewed." : "Confirm these exact time boundaries reflect the work you performed."} /></label>
      {!reviewer && <label className="checkbox"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />I reviewed every proposed boundary and unpaid break above.</label>}
      <button className="button secondary wide" disabled={reason.length < 8 || busy || (!reviewer && !ack)} onClick={() => run(() => api(`/proposals/${proposal.id}/attest`, "POST", {
        kind: reviewer ? "manager_attestation" : "employee_confirmation", reason,
      }), "Attestation recorded against this exact proposal.")}><Check size={15} />{reviewer ? "Record evidence attestation" : "Confirm my worked time"}</button></div>}
    {proposal.proof && <div className={`proof-panel ${proposal.proof.verified ? "passed" : "failed"}`}>
      <div className="proof-title">{proposal.proof.verified ? <ShieldCheck size={22} /> : <ShieldAlert size={22} />}<div><strong>{proposal.proof.verified ? "Independently reproduced" : "Verification blocked"}</strong><small>Full-period deterministic recomputation</small></div></div>
      {proposal.proof.failures.length > 0 && <ul>{proposal.proof.failures.map(f => <li key={f}>{f}</li>)}</ul>}
      {proposal.proof.periods.map(p => <div key={p.card_id} className="proof-comparison"><span>{p.card_id}</span><div><label>Before<strong>{currency(p.before.total)}</strong></label><ArrowRight size={17} /><label>After<strong>{currency(p.after.total)}</strong></label></div>
        <small>Delta: {p.delta === null ? p.delta_reason : currency(p.delta)}</small></div>)}
      {proposal.proof.employee_confirmation_required && <p className="small-note">Employee confirmation is required for reduced or previously unknown paid time.</p>}
      <details className="hash-details"><summary><Fingerprint size={13} />Proof & policy fingerprints</summary><code>Proof: {proposal.proof.hash}<br />Policy: {proposal.proof.policy_hash}</code></details>
      <button className="text-button" onClick={() => setShowTrace(!showTrace)}><GitCompareArrows size={14} />{showTrace ? "Hide" : "Inspect"} candidate derivations</button>
      {showTrace && proposal.proof.periods.map(p => <TraceTable key={p.card_id} pay={p.after} />)}
    </div>}
    {reviewer && !closed && <div className="approval-actions">
      <button className="button secondary" disabled={busy} onClick={() => run(() => api(`/proposals/${proposal.id}/verify`, "POST"), "Verification completed. Inspect the result before approval.")}><ShieldCheck size={16} />Verify full period</button>
      <button className="button primary" title={proposal.author === user.id ? "Another reviewer must approve your proposal" : "Recomputes again inside the approval transaction"}
        disabled={busy || proposal.state !== "verified" || proposal.author === user.id} onClick={() => run(() => api(`/proposals/${proposal.id}/approve`, "POST", {
          proof_hash: proposal.proof?.hash,
        }), "Verified correction approved and atomically committed.")}><CheckCheck size={16} />Approve & commit</button>
      <button className="text-button danger" disabled={reason.length < 8 || busy} onClick={() => run(() => api(`/proposals/${proposal.id}/reject`, "POST", { reason }), "Correction rejected. Original time records preserved.")}>Reject with reason</button>
      {proposal.author === user.id && <small className="muted">You authored this proposal. Taylor or another authorized reviewer must approve it.</small>}
    </div>}
    {proposal.approval && <div className="success-box"><CheckCheck size={18} />Committed by {proposal.approval.actor} · {new Date(proposal.approval.at).toLocaleString()}</div>}
  </section>;
}

export default function Workspace({ detail, user, run, page, busy, onPolicy }: {
  detail: Detail; user: User; run: Run; page: string; busy: boolean; onPolicy: () => void;
}) {
  const [tab, setTab] = useState(page === "pay" ? "pay" : "evidence");
  const [draft, setDraft] = useState<Correction | null | undefined>(undefined);
  const [proposalId, setProposalId] = useState(detail.proposals[0]?.id || "");
  const [disputeLine, setDisputeLine] = useState<string | null | undefined>(undefined);
  const disputeRef = useModalFocus(disputeLine !== undefined, () => setDisputeLine(undefined));
  const [disputeReason, setDisputeReason] = useState("");
  const [resolution, setResolution] = useState<Record<string, string>>({});
  const { card, pay } = detail;
  const proposal = detail.proposals.find(p => p.id === proposalId) || detail.proposals[0];
  const investigation = detail.investigations[0]?.result;
  const reviewer = user.role === "reviewer";
  return <section className="detail">
    <header className="person-header"><div className="person-heading"><span className="avatar large">{initials(card.employee.name)}</span><div><span className="eyebrow">{card.employee.department}</span><h2>{card.employee.name}</h2><p>{card.employee.title} <span>·</span> {friendly(card.employee.employment)}</p></div></div>
      <div className="person-meta"><span><Clock3 size={13} />{period(card.period_start)}</span><span>Revision {card.revision}</span><span className="badge neutral">{card.period_status}</span></div></header>
    <nav className="detail-tabs" aria-label="Timecard sections">{[
      ["evidence", "Evidence"], ...(reviewer ? [["ai", "AI investigation"]] : []),
      ["correction", "Correction & proof"], ["pay", "Pay derivation"],
    ].map(([key, title]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{title}</button>)}</nav>
    <div className="detail-body">
      {tab === "evidence" && <>
        <div className="section-heading"><span className="eyebrow">THE EXCEPTIONS</span><span>{pay.exceptions.length} detected</span></div>
        {!pay.exceptions.length && <div className="success-box"><ShieldCheck size={19} />No exceptions detected in this period.</div>}
        <div className="exceptions">{pay.exceptions.map(e => <div className={`exception ${e.blocking ? "blocking" : ""}`} key={e.id}>
          <span className="exception-marker">{e.blocking ? <ShieldAlert size={16} /> : <Clock3 size={16} />}</span>
          <div><strong>{e.title}</strong><p>{friendly(e.family)} <span>·</span> {e.blocking ? "Blocks final pay" : "Payable / review required"}</p><small>{e.reference}</small>
            {!!Object.keys(e.facts).length && <details><summary>Computed evidence</summary><pre>{JSON.stringify(e.facts, null, 2)}</pre></details>}</div>
          <button className="citation" onClick={onPolicy}>{e.clause}<ArrowUpRight size={11} /></button></div>)}</div>
        <div className="section-heading spaced"><span className="eyebrow">SOURCE RECORDS</span><span>{card.employee.timezone}</span></div>
        <div className="time-evidence">{card.schedules.map(s => {
          const actual = card.shifts.find(w => w.id === s.id);
          const flagged = pay.exceptions.some(e => e.reference.includes(s.id));
          return <details key={s.id} className={flagged ? "flagged" : ""}><summary><span className="day-dot" /><span>{new Date(s.start).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: card.employee.timezone })}</span>
            <span className={!actual?.start || !actual?.end ? "missing" : ""}>{actual ? `${timeLabel(actual.start, card.employee.timezone)} → ${timeLabel(actual.end, card.employee.timezone)}` : s.absence_confirmed ? "Confirmed absence" : "No punches recorded"}</span><ChevronDown size={13} /></summary>
            <div className="source-details"><div><span>Scheduled</span><strong>{timeLabel(s.start, card.employee.timezone)} → {timeLabel(s.end, card.employee.timezone)}</strong></div>
              <div><span>Planned unpaid breaks</span><strong>{s.planned_unpaid_break_minutes} min</strong></div>
              {actual?.breaks.map((b, i) => <div key={i}><span>Actual unpaid break</span><strong>{timeLabel(b.start, card.employee.timezone)} → {timeLabel(b.end, card.employee.timezone)}</strong></div>)}
              <code>schedule:{s.id}</code>{actual && <code>shift:{actual.id}</code>}</div></details>;
        })}</div>
        {card.shifts.filter(w => !card.schedules.some(s => s.id === w.id)).map(w => <div className="info-box" key={w.id}><Clock3 size={16} /><span>Unscheduled: {timeLabel(w.start, card.employee.timezone)} → {timeLabel(w.end, card.employee.timezone)}<small>{w.id}</small></span></div>)}
        <div className="employee-note"><span className="eyebrow"><MessageSquare size={13} />EMPLOYEE NOTE · UNTRUSTED INPUT</span><blockquote>{card.note}</blockquote><small>Context, not a command or proof of time worked.</small></div>
        <button className="button primary wide" onClick={() => { setTab(reviewer ? "ai" : "correction"); }}>{reviewer ? "Investigate this timecard" : "Review corrections"}<ArrowRight size={16} /></button>
      </>}
      {tab === "ai" && <>
        <div className="investigation-intro"><span className="ai-orbit"><Sparkles size={25} /></span><span className="eyebrow">YOUR INVESTIGATOR, NOT YOUR PAY ENGINE</span><h3>Make the evidence useful.</h3>
          <p>Read the source records, find the relevant clauses, and draft a correction. Nothing here can approve or write payroll.</p>
          <button className="button primary" disabled={busy} onClick={() => run(() => api(`/cards/${card.id}/investigate`, "POST"), "Investigation recorded in the audit ledger.")}><Sparkles size={16} />{busy ? "Investigating…" : "Run investigation"}</button></div>
        {investigation && <div className="investigation-result"><div className="section-heading"><span className="badge neutral">{friendly(investigation.status)}</span><span>{investigation.mode === "off" ? "No-LLM fallback" : "Model-assisted"}</span></div>
          <h3>Investigation brief</h3><p>{investigation.summary}</p><div className="citation-row">{investigation.clauses.map(c => <button className="citation" key={c} onClick={onPolicy}>{c}<ArrowUpRight size={11} /></button>)}</div>
          <div className={`critic ${investigation.critic.safe ? "" : "flagged"}`}><ShieldCheck size={19} /><div><strong>{investigation.critic.safe ? "Critic: no override detected" : "Critic: instruction override flagged"}</strong><p>{investigation.critic.reason}</p></div></div>
          <small className="muted">Pattern screening is not a security guarantee. The verifier and approval boundary remain mandatory.</small>
          {investigation.correction && <button className="button secondary wide" onClick={() => setDraft(investigation.correction)}>Inspect suggested correction<ArrowRight size={16} /></button>}</div>}
        <div className="architecture-note"><span>LLM proposes</span><ArrowRight size={14} /><span>Engine reproduces</span><ArrowRight size={14} /><span>Human approves</span></div>
        <button className="text-button" onClick={() => { setDraft(null); setTab("correction"); }}>Continue with a manual proposal<ArrowRight size={14} /></button>
      </>}
      {tab === "correction" && <>
        <div className="section-heading"><div><span className="eyebrow">IMMUTABLE PROPOSALS</span><h3>A change with a proof trail.</h3></div><button className="button secondary small" onClick={() => setDraft(null)}><Plus size={14} />Draft correction</button></div>
        {!detail.policy_signed && <div className="info-box"><LockKeyhole size={17} /><span>Review and sign a ruleset in Policy studio before verifying or committing corrections.</span></div>}
        {detail.proposals.length > 0 ? <>
          <label className="proposal-picker">Correction history<select value={proposal?.id || ""} onChange={e => setProposalId(e.target.value)}>{detail.proposals.map(p => <option value={p.id} key={p.id}>{friendly(p.state)} · {p.author} · {new Date(p.created_at).toLocaleString()}</option>)}</select></label>
          {proposal && <ProposalReview key={proposal.id} proposal={proposal} user={user} run={run} busy={busy} />}
        </> : <div className="empty"><GitCompareArrows size={30} /><h3>No correction proposed yet</h3><p>Start from source evidence. Drafting a proposal never changes the underlying timecard.</p><button className="button primary" onClick={() => setDraft(null)}>Draft the first correction<ArrowRight size={15} /></button></div>}
      </>}
      {tab === "pay" && <>
        <TraceTable pay={pay} onDispute={!reviewer ? id => setDisputeLine(id) : undefined} />
        {!reviewer && <button className="button secondary wide" onClick={() => setDisputeLine(null)}><MessageSquare size={15} />Ask about this timecard</button>}
        <section className="disputes"><div className="section-heading"><span className="eyebrow">PAY QUESTIONS & DISPUTES</span><span>{detail.disputes.length} recorded</span></div>
          {!detail.disputes.length && <p className="muted">No disputes recorded. A dispute opens a review—it never changes pay automatically.</p>}
          {detail.disputes.map(d => <div key={d.id} className="dispute"><span className={`badge ${d.resolution ? "green" : "amber"}`}>{d.resolution ? "Resolved" : "Open review"}</span>
            <p>{d.reason}</p><small className="muted">{d.line_id || "Whole timecard"} · revision {d.revision}</small>
            {d.resolution ? <div className="resolution"><CheckCheck size={14} />{d.resolved_by}: {d.resolution}</div> : reviewer && <div className="resolution-form">
              <label>Resolution<textarea value={resolution[d.id] || ""} onChange={e => setResolution(old => ({ ...old, [d.id]: e.target.value }))} placeholder="Explain the resolution. Any time correction needs its own verified approval." /></label>
              <button className="button secondary small" disabled={(resolution[d.id] || "").length < 8 || busy} onClick={() => run(() => api(`/disputes/${d.id}/resolve`, "POST", { reason: resolution[d.id] }), "Dispute resolution recorded. Pay was not changed.")}>Record resolution</button></div>}</div>)}
        </section>
      </>}
    </div>
    {draft !== undefined && <CorrectionEditor detail={detail} initial={draft || undefined} onClose={() => setDraft(undefined)} run={run} busy={busy} />}
    {disputeLine !== undefined && <div className="modal-backdrop"><section ref={disputeRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="dispute-title"><header><h2 id="dispute-title">Let's make this clear.</h2><button className="icon-button" aria-label="Close dispute" onClick={() => setDisputeLine(undefined)}><X size={19} /></button></header>
      <p className="muted">Your question is linked to {disputeLine || "this timecard"} at revision {card.revision}. Your pay will not change automatically.</p>
      <form onSubmit={e => { e.preventDefault(); run(async () => {
        await api(`/cards/${card.id}/disputes`, "POST", { line_id: disputeLine, reason: disputeReason });
        setDisputeLine(undefined); setDisputeReason("");
      }, "Pay dispute opened and recorded for review."); }}><label>What would you like reviewed?<textarea value={disputeReason} onChange={e => setDisputeReason(e.target.value)} minLength={8} required autoFocus /></label>
        <button className="button primary wide" disabled={busy}>Submit for review<MessageSquare size={16} /></button></form></section></div>}
  </section>;
}

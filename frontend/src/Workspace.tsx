import { useEffect, useRef, useState } from "react";
import { ArrowRight, MessageSquare, Plus, X } from "lucide-react";
import { api, type Correction, type Detail, type Edit, type Pay, type Proposal, type User } from "./api";
import { currency, duration, friendly, initials, period, type Run } from "./App";
import { ExplainChat, InjectionLab, UnsafeFixDemo } from "./AiPanels";

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

function clock(value: string | null, zone: string) {
  return value ? new Date(value).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }) : "--:--";
}

function minuteOfDay(value: string, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).formatToParts(new Date(value));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value || 0);
  return get("hour") * 60 + get("minute");
}

type Row = {
  id: string; day: string; flagged: boolean; status: string;
  scheduled: [number, number]; actual: [number, number] | null; open: "start" | "end" | null;
  breaks: [number, number][];
};

function DayTimeline({ detail }: { detail: Detail }) {
  const { card, pay } = detail;
  const zone = card.employee.timezone;
  const rows: Row[] = card.schedules.map(s => {
    const base = new Date(s.start).getTime() - minuteOfDay(s.start, zone) * 60000;
    const at = (v: string) => (new Date(v).getTime() - base) / 60000;
    const actual = card.shifts.find(w => w.id === s.id);
    const scheduled: [number, number] = [at(s.start), at(s.end)];
    let span: [number, number] | null = null;
    let open: Row["open"] = null;
    if (actual?.start || actual?.end) {
      span = [actual.start ? at(actual.start) : scheduled[0], actual.end ? at(actual.end) : scheduled[1]];
      open = !actual.start ? "start" : !actual.end ? "end" : null;
    }
    return {
      id: s.id, flagged: pay.exceptions.some(e => e.reference.includes(s.id)), scheduled, actual: span, open,
      day: new Date(s.start).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zone }),
      status: actual ? (open ? "Missing punch" : `${clock(actual.start, zone)}–${clock(actual.end, zone)}`) : s.absence_confirmed ? "Confirmed absence" : "No punches",
      breaks: (actual?.breaks || []).map(b => [at(b.start), at(b.end)] as [number, number]),
    };
  });
  if (!rows.length) return null;
  const points = rows.flatMap(r => [...r.scheduled, ...(r.actual || [])]);
  const lo = Math.floor((Math.min(...points) - 60) / 60) * 60;
  const hi = Math.ceil((Math.max(...points) + 60) / 60) * 60;
  const pos = (m: number) => `${((m - lo) / (hi - lo)) * 100}%`;
  const width = (a: number, b: number) => `${((b - a) / (hi - lo)) * 100}%`;
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += 120) ticks.push(t);
  return <figure className="timeline" aria-label="Scheduled and recorded time by day">
    <div className="timeline-axis" aria-hidden="true"><span />{<div>{ticks.map(t => <i key={t} style={{ left: pos(t) }}>{String(Math.floor(t / 60) % 24).padStart(2, "0")}</i>)}</div>}<span /></div>
    {rows.map(r => <div key={r.id} className={`timeline-row ${r.flagged ? "flagged" : ""}`}>
      <span className="timeline-day">{r.day}</span>
      <div className="timeline-track" aria-hidden="true">
        {ticks.map(t => <i key={t} className="grid" style={{ left: pos(t) }} />)}
        <b className="planned" style={{ left: pos(r.scheduled[0]), width: width(...r.scheduled) }} />
        {r.actual && <b className={`worked ${r.open ? `open-${r.open}` : ""}`} style={{ left: pos(r.actual[0]), width: width(...r.actual) }} />}
        {r.breaks.map((b, i) => <b key={i} className="break" style={{ left: pos(b[0]), width: width(...b) }} />)}
      </div>
      <span className={`timeline-status figure ${r.open || !r.actual ? "missing" : ""}`}>{r.status}</span>
    </div>)}
    <figcaption><span><b className="key planned" />Scheduled</span><span><b className="key worked" />Recorded</span><span><b className="key open" />Unconfirmed boundary</span><span><b className="key break" />Unpaid break</span><span className="zone">{zone}</span></figcaption>
  </figure>;
}

function HoursBar({ pay }: { pay: Pay }) {
  const total = pay.work_minutes;
  if (!total) return null;
  const overtime = Math.min(pay.overtime_minutes, total);
  const straight = total - overtime;
  return <div className="hours">
    <div className="hours-bar" role="img" aria-label={`${duration(total)} worked, ${duration(overtime)} overtime`}>
      <i className="straight" style={{ width: `${(straight / total) * 100}%` }} />
      <i className="overtime" style={{ width: `${(overtime / total) * 100}%` }} />
    </div>
    <dl>
      <div><dt><b className="key straight" />Straight time</dt><dd className="figure">{duration(straight)}</dd></div>
      <div><dt><b className="key overtime" />Overtime</dt><dd className="figure">{duration(overtime)}</dd></div>
      <div><dt><b className="key night" />Night hours</dt><dd className="figure">{duration(pay.night_minutes)}</dd></div>
    </dl>
  </div>;
}

function TraceTable({ pay, onDispute }: { pay: Pay; onDispute?: (id: string) => void }) {
  const weeks = [...new Set(pay.lines.map(line => line.week))];
  return <div className="trace">
    <div className={`pay-total ${pay.total === null ? "incomplete" : ""}`}>
      <div className="pay-total-figure"><span className="label">Gross earnings</span>
        <h2 className="figure">{currency(pay.total)}</h2>
        <p>{pay.total === null ? "Partial lines are shown. Unknown earnings are never counted as zero." : "Sum of the rounded lines below. Before tax and deductions."}</p></div>
      <HoursBar pay={pay} />
    </div>
    {pay.reasons.length > 0 && <div className="error-box"><strong>Final pay is blocked</strong><ul>{pay.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>}
    {weeks.map(week => <section key={week} className="trace-week"><h3>Week of {week}<span className="figure">{pay.regular_rates[week] ? `Regular rate $${Number(pay.regular_rates[week]).toFixed(6)}` : "Exempt salary basis"}</span></h3>
      <table className="earnings-table"><thead><tr><th>Line</th><th className="numeric">Amount</th>{onDispute && <th><span className="sr-only">Question</span></th>}</tr></thead>
        <tbody>{pay.lines.filter(line => line.week === week).map(line => <tr key={line.id}>
          <td><details><summary><span className="line-label">{line.label}</span><span className="citation">{line.clause}</span></summary>
            <div className="formula"><code>{line.formula}</code><dl><div><dt>Quantity</dt><dd className="figure">{line.quantity} {line.unit}</dd></div>
              <div><dt>Unrounded rate</dt><dd className="figure">{line.rate}</dd></div><div><dt>Unrounded result</dt><dd className="figure">{line.unrounded}</dd></div></dl>
              <small>Weekly component aggregation · ROUND_HALF_UP · source references {line.sources.join(", ") || "approved compensation / leave"}</small></div></details></td>
          <td className={`numeric amount figure ${Number(line.amount) < 0 ? "negative" : ""}`}>{currency(line.amount)}</td>
          {onDispute && <td className="row-action"><button className="icon-button" title={`Dispute ${line.label}`} aria-label={`Dispute ${line.label}`} onClick={() => onDispute(line.id)}><MessageSquare size={14} /></button></td>}
        </tr>)}</tbody></table>
    </section>)}
    {!!pay.comp_events.length && <section className="bank-ledger"><h3>Comp-off movement <span>{pay.closing_comp_minutes === null ? "Balance incomplete" : `${pay.closing_comp_minutes} minutes closing`}</span></h3>
      {pay.comp_events.map((event, i) => <div key={`${event.source}-${i}`}><span className={event.kind === "leave_debit" ? "debit" : "credit"}>{event.kind === "leave_debit" ? "↓" : "+"} {friendly(event.kind)}</span>
        <small>{new Date(event.at).toLocaleString()}</small><strong className="figure">{event.minutes > 0 ? "+" : ""}{event.minutes} min</strong><span className="figure">→ {event.balance ?? "outside period"} min</span></div>)}</section>}
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
      <header><div><h2 id="correction-title">Draft a correction</h2><p>{detail.card.employee.name} · {period(detail.card.period_start)}</p></div><button className="icon-button" aria-label="Close correction" onClick={onClose}><X size={18} /></button></header>
      <div className="info-box">This creates a proposal, not a change. The timecard stays as it is until the engine reproduces the result and a second person approves it.</div>
      <form onSubmit={e => { e.preventDefault(); run(async () => {
        await api(`/cards/${detail.card.id}/proposals`, "POST", {
          revision: detail.card.revision, correction: { edits, reason, clauses: references(clauses), evidence: references(evidence) },
        }); onClose();
      }, "Correction proposed. No payroll records have changed."); }}>
        {edits.map((edit, index) => <fieldset className="edit-block" key={index}>
          <div className="edit-heading"><strong>Source edit {index + 1}</strong><button type="button" className="text-button danger" aria-label={`Remove edit ${index + 1}`} onClick={() => setEdits(old => old.filter((_, i) => i !== index))}>Remove</button></div>
          <div className="form-grid"><label>Operation<select value={edit.operation} onChange={e => update(index, { operation: e.target.value as Edit["operation"] })}>
            <option value="replace">Replace event boundaries</option><option value="add">Add missed shift</option><option value="remove">Remove event</option></select></label>
            <label>Source shift{edit.operation === "add" ? <input value={edit.shift_id} onChange={e => update(index, { shift_id: e.target.value })} required /> :
              <select value={edit.shift_id} onChange={e => {
                const s = detail.card.shifts.find(s => s.id === e.target.value)!;
                update(index, { shift_id: s.id, start: s.start, end: s.end, breaks: s.breaks });
              }}>{detail.card.shifts.map((s, i) => <option key={`${s.id}-${i}`} value={s.id}>{s.id}</option>)}</select>}</label></div>
          {edit.operation !== "remove" && <>
            <div className="form-grid"><label>Clock-in<input className="figure" aria-label={`Clock-in ${index + 1}`} value={edit.start || ""} onChange={e => update(index, { start: e.target.value || null })} placeholder="2026-10-07T09:00:00-04:00" required /></label>
              <label>Clock-out<input className="figure" aria-label={`Clock-out ${index + 1}`} value={edit.end || ""} onChange={e => update(index, { end: e.target.value || null })} placeholder="2026-10-07T17:30:00-04:00" required /></label></div>
            <button type="button" className="text-button" onClick={() => {
              const s = detail.card.schedules.find(s => s.id === edit.shift_id);
              if (s) update(index, { start: edit.start || s.start, end: edit.end || s.end });
            }}>Use scheduled missing boundary as an unconfirmed suggestion</button>
            <div className="breaks-editor"><span className="field-title">Actual unpaid breaks</span>{edit.breaks.map((b, n) => <div key={n}>
              <input className="figure" aria-label={`Break start ${index + 1}-${n + 1}`} value={b.start} onChange={e => update(index, { breaks: edit.breaks.map((v, k) => k === n ? { ...v, start: e.target.value } : v) })} required />
              <span aria-hidden="true">→</span><input className="figure" aria-label={`Break end ${index + 1}-${n + 1}`} value={b.end} onChange={e => update(index, { breaks: edit.breaks.map((v, k) => k === n ? { ...v, end: e.target.value } : v) })} required />
              <button type="button" className="icon-button" aria-label="Remove break" onClick={() => update(index, { breaks: edit.breaks.filter((_, k) => k !== n) })}><X size={14} /></button></div>)}
              <button type="button" className="text-button" onClick={() => update(index, { breaks: [...edit.breaks, { start: "", end: "" }] })}>Add actual break</button></div>
          </>}
        </fieldset>)}
        <button type="button" className="button secondary small" onClick={() => setEdits(old => [...old, makeEdit()])}><Plus size={14} />Add another edit</button>
        <label className="spaced">Reason for correction<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={8} required placeholder="What source evidence supports this change?" /></label>
        <div className="form-grid"><label>Clause citations<input className="figure" value={clauses} onChange={e => setClauses(e.target.value)} required /></label>
          <label>Evidence references<input className="figure" value={evidence} onChange={e => setEvidence(e.target.value)} required /></label></div>
        <details className="reference-help"><summary>Available evidence references</summary><code>{[
          ...detail.card.schedules.map(s => `schedule:${s.id}`), ...detail.card.shifts.map(s => `shift:${s.id}`),
          ...detail.card.leave.map(s => `leave:${s.id}`), "note",
        ].join("\n")}</code></details>
        <footer><span className="figure">Revision {detail.card.revision} · {detail.card.employee.timezone}</span><button className="button primary" disabled={!edits.length || busy}>Create proposal</button></footer>
      </form>
    </section>
  </div>;
}

function ProposalSteps({ proposal }: { proposal: Proposal }) {
  const rejected = proposal.state === "rejected";
  const steps = [
    ["Drafted", true],
    ["Attested", proposal.attestations.length > 0],
    ["Reproduced", !!proposal.proof?.verified],
    ["Approved", proposal.state === "committed"],
  ] as const;
  return <ol className={`steps ${rejected ? "rejected" : ""}`} aria-label="Proposal progress">
    {steps.map(([label, done]) => <li key={label} className={done ? "done" : ""}>{label}</li>)}
  </ol>;
}

function ProposalReview({ proposal, user, run, busy }: { proposal: Proposal; user: User; run: Run; busy: boolean }) {
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const reviewer = user.role === "reviewer";
  const closed = ["committed", "rejected"].includes(proposal.state);
  return <section className="proposal-review">
    <div className="proposal-head"><span className={`badge ${proposal.state === "committed" || proposal.state === "verified" ? "green" : proposal.state === "rejected" ? "red" : "amber"}`}>{friendly(proposal.state)}</span><code className="figure">{proposal.id.slice(0, 16)}</code><span className="muted">by {proposal.author}</span></div>
    <ProposalSteps proposal={proposal} />
    <p className="proposal-reason">{proposal.correction.reason}</p>
    <table className="edit-summary"><thead><tr><th>Change</th><th>Record</th><th>From</th><th>To</th></tr></thead>
      <tbody>{proposal.correction.edits.map(e => <tr key={e.shift_id}><td>{friendly(e.operation)}</td><td><code>{e.shift_id}</code></td><td className="figure">{e.start || "—"}</td><td className="figure">{e.end || "—"}
        {e.breaks.length > 0 && <small>Unpaid breaks: {e.breaks.map(b => `${b.start} → ${b.end}`).join("; ")}</small>}</td></tr>)}</tbody></table>
    <div className="citation-row">{proposal.correction.clauses.map(c => <span className="citation" key={c}>{c}</span>)}<small className="muted">Evidence: {proposal.correction.evidence.join(", ")}</small></div>
    {!!proposal.attestations.length && <ul className="attestations">{proposal.attestations.map((a, i) => <li key={i}><strong>{friendly(a.kind)}</strong><span>{a.actor} · {a.reason}</span></li>)}</ul>}
    {!closed && <div className="attest-form"><label>Review / confirmation reason<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={8} placeholder={reviewer ? "What independent evidence did you check?" : "Confirm these times match the work you did."} /></label>
      {!reviewer && <label className="checkbox"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />I reviewed every proposed boundary and unpaid break above.</label>}
      <button className="button secondary" disabled={reason.length < 8 || busy || (!reviewer && !ack)} onClick={() => run(() => api(`/proposals/${proposal.id}/attest`, "POST", {
        kind: reviewer ? "manager_attestation" : "employee_confirmation", reason,
      }), "Attestation recorded against this exact proposal.")}>{reviewer ? "Record evidence attestation" : "Confirm my worked time"}</button></div>}
    {proposal.proof && <div className={`proof-panel ${proposal.proof.verified ? "passed" : "failed"}`}>
      <div className="proof-title"><div><strong>{proposal.proof.verified ? "Independently reproduced" : "Verification blocked"}</strong><small>Full-period deterministic recomputation</small></div>
        <span className="seal figure" title={proposal.proof.hash}>{proposal.proof.hash.slice(0, 10)}</span></div>
      {proposal.proof.failures.length > 0 && <ul className="failures">{proposal.proof.failures.map(f => <li key={f}>{f}</li>)}</ul>}
      <table className="proof-diff"><thead><tr><th>Timecard</th><th className="numeric">Before</th><th className="numeric">After</th><th className="numeric">Change</th></tr></thead>
        <tbody>{proposal.proof.periods.map(p => <tr key={p.card_id}><td><code>{p.card_id}</code></td><td className="numeric figure">{currency(p.before.total)}</td><td className="numeric figure">{currency(p.after.total)}</td>
          <td className={`numeric figure delta ${p.delta !== null && Number(p.delta) < 0 ? "negative" : ""}`}>Delta: {p.delta === null ? p.delta_reason : currency(p.delta)}</td></tr>)}</tbody></table>
      {proposal.proof.employee_confirmation_required && <p className="small-note">Employee confirmation is required for reduced or previously unknown paid time.</p>}
      <details className="hash-details"><summary>Proof and policy hashes</summary><code>Proof: {proposal.proof.hash}<br />Policy: {proposal.proof.policy_hash}</code></details>
      <button className="text-button" onClick={() => setShowTrace(!showTrace)}>{showTrace ? "Hide" : "Inspect"} candidate derivations</button>
      {showTrace && proposal.proof.periods.map(p => <TraceTable key={p.card_id} pay={p.after} />)}
    </div>}
    {reviewer && !closed && <div className="approval-actions">
      <button className="button secondary" disabled={busy} onClick={() => run(() => api(`/proposals/${proposal.id}/verify`, "POST"), "Verification completed. Inspect the result before approval.")}>Verify full period</button>
      <button className="button primary" title={proposal.author === user.id ? "Another reviewer must approve your proposal" : "Recomputes again inside the approval transaction"}
        disabled={busy || proposal.state !== "verified" || proposal.author === user.id} onClick={() => run(() => api(`/proposals/${proposal.id}/approve`, "POST", {
          proof_hash: proposal.proof?.hash,
        }), "Verified correction approved and atomically committed.")}>Approve & commit</button>
      <button className="text-button danger" disabled={reason.length < 8 || busy} onClick={() => run(() => api(`/proposals/${proposal.id}/reject`, "POST", { reason }), "Correction rejected. Original time records preserved.")}>Reject with reason</button>
      {proposal.author === user.id && <small className="muted">You authored this proposal. Taylor or another authorized reviewer must approve it.</small>}
    </div>}
    {proposal.approval && <div className="success-box">Committed by {proposal.approval.actor} · {new Date(proposal.approval.at).toLocaleString()}</div>}
  </section>;
}

function GateRail({ investigation }: { investigation?: Detail["investigations"][number]["result"] }) {
  const gates: [string, string, "pass" | "fail" | "wait"][] = [
    ["Critic", investigation ? (investigation.critic.safe ? "Note screened" : "Override flagged") : "Screens the employee note", investigation ? (investigation.critic.safe ? "pass" : "fail") : "wait"],
    ["Schema", investigation ? (investigation.correction ? "Draft validated" : "No draft returned") : "Validates strict JSON", investigation ? (investigation.correction ? "pass" : "wait") : "wait"],
    ["Engine", "Recomputes the full period", "wait"],
    ["Human", "Second reviewer approves", "wait"],
  ];
  return <ol className="gate-rail" aria-label="Checks between a suggestion and payroll">
    {gates.map(([name, text, state]) => <li key={name} className={state}><strong>{name}</strong><span>{text}</span></li>)}
  </ol>;
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
  const zone = card.employee.timezone;
  const proposal = detail.proposals.find(p => p.id === proposalId) || detail.proposals[0];
  const investigation = detail.investigations[0]?.result;
  const reviewer = user.role === "reviewer";
  const tabs: [string, string, number?][] = [
    ["evidence", "Evidence", pay.exceptions.length], ...(reviewer ? [["ai", "AI investigation"] as [string, string]] : []),
    ["correction", "Correction & proof", detail.proposals.length], ["pay", "Pay derivation"],
  ];
  return <section className="detail">
    <header className="person-header"><div className="person-heading"><span className={`avatar large hue-${card.employee.name.length % 4}`}>{initials(card.employee.name)}</span><div><h2>{card.employee.name}</h2><p>{card.employee.title} · {card.employee.department} · {friendly(card.employee.employment)}</p></div></div>
      <div className="person-meta"><span className="figure">{period(card.period_start)}</span><span className="figure">Revision {card.revision}</span><span className="badge neutral">{card.period_status}</span></div></header>
    <nav className="detail-tabs" aria-label="Timecard sections">{tabs.map(([key, title, count]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{title}{!!count && <span className="tab-count" aria-hidden="true">{count}</span>}</button>)}</nav>
    <div className="detail-body">
      {tab === "evidence" && <>
        <div className="section-heading"><h3>Exceptions</h3><span className="figure">{pay.exceptions.length} detected</span></div>
        {!pay.exceptions.length && <div className="success-box">No exceptions detected in this period.</div>}
        <ul className="exceptions">{pay.exceptions.map(e => <li className={`exception ${e.blocking ? "blocking" : ""}`} key={e.id}>
          <div className="exception-main"><strong>{e.title}</strong><p>{friendly(e.family)} · {e.blocking ? "Blocks final pay" : "Payable / review required"}</p><small className="figure">{e.reference}</small>
            {!!Object.keys(e.facts).length && <details><summary>Computed evidence</summary><pre>{JSON.stringify(e.facts, null, 2)}</pre></details>}</div>
          <button className="citation" title="Open in policy studio" onClick={onPolicy}>{e.clause}</button></li>)}</ul>
        <div className="section-heading spaced"><h3>Scheduled vs recorded</h3></div>
        <DayTimeline detail={detail} />
        <div className="time-evidence">{card.schedules.map(s => {
          const actual = card.shifts.find(w => w.id === s.id);
          const flagged = pay.exceptions.some(e => e.reference.includes(s.id));
          return <details key={s.id} className={flagged ? "flagged" : ""}><summary><span>{new Date(s.start).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zone })}</span>
            <span className={`figure ${!actual?.start || !actual?.end ? "missing" : ""}`}>{actual ? `${timeLabel(actual.start, zone)} → ${timeLabel(actual.end, zone)}` : s.absence_confirmed ? "Confirmed absence" : "No punches recorded"}</span></summary>
            <dl className="source-details"><div><dt>Scheduled</dt><dd className="figure">{timeLabel(s.start, zone)} → {timeLabel(s.end, zone)}</dd></div>
              <div><dt>Planned unpaid breaks</dt><dd className="figure">{s.planned_unpaid_break_minutes} min</dd></div>
              {actual?.breaks.map((b, i) => <div key={i}><dt>Actual unpaid break</dt><dd className="figure">{timeLabel(b.start, zone)} → {timeLabel(b.end, zone)}</dd></div>)}
              <div><dt>References</dt><dd><code>schedule:{s.id}</code>{actual && <code>shift:{actual.id}</code>}</dd></div></dl></details>;
        })}</div>
        {card.shifts.filter(w => !card.schedules.some(s => s.id === w.id)).map(w => <div className="info-box" key={w.id}>Unscheduled: {timeLabel(w.start, zone)} → {timeLabel(w.end, zone)} <code>{w.id}</code></div>)}
        <div className="employee-note"><span className="label">EMPLOYEE NOTE · UNTRUSTED INPUT</span><blockquote>{card.note}</blockquote><small>Context, not a command or proof of time worked.</small></div>
        <button className="button primary" onClick={() => { setTab(reviewer ? "ai" : "correction"); }}>{reviewer ? "Investigate this timecard" : "Review corrections"}<ArrowRight size={15} /></button>
      </>}
      {tab === "ai" && <>
        <div className="investigation-intro"><div><h3>Investigate</h3>
          <p>The investigator reads the source records and the cited clauses, then drafts a correction. It cannot calculate pay, approve, or write to payroll.</p></div>
          <button className="button primary" disabled={busy} onClick={() => run(() => api(`/cards/${card.id}/investigate`, "POST"), "Investigation recorded in the audit ledger.")}>{busy ? "Investigating…" : "Run investigation"}</button></div>
        <GateRail investigation={investigation} />
        {investigation && <div className="investigation-result"><div className="section-heading"><span className="badge neutral">{friendly(investigation.status)}</span><span className="mode">{investigation.mode === "off" ? "No-LLM fallback" : "Model-assisted"}</span></div>
          <h3>Investigation brief</h3><p className="brief">{investigation.summary}</p><div className="citation-row">{investigation.clauses.map(c => <button className="citation" key={c} onClick={onPolicy}>{c}</button>)}</div>
          <div className={`critic ${investigation.critic.safe ? "" : "flagged"}`}><strong>{investigation.critic.safe ? "Critic: no override detected" : "Critic: instruction override flagged"}</strong><p>{investigation.critic.reason}</p></div>
          <small className="muted">Pattern screening is not a security guarantee. The verifier and approval boundary remain mandatory.</small>
          {investigation.correction && <button className="button secondary" onClick={() => setDraft(investigation.correction)}>Inspect suggested correction</button>}</div>}
        <InjectionLab />
        <button className="text-button" onClick={() => { setDraft(null); setTab("correction"); }}>Continue with a manual proposal</button>
      </>}
      {tab === "correction" && <>
        <div className="section-heading"><h3>Proposals</h3><button className="button secondary small" onClick={() => setDraft(null)}><Plus size={14} />Draft correction</button></div>
        {!detail.policy_signed && <div className="info-box">Review and sign a ruleset in Policy studio before verifying or committing corrections.</div>}
        {detail.proposals.length > 0 ? <>
          <label className="proposal-picker">Correction history<select value={proposal?.id || ""} onChange={e => setProposalId(e.target.value)}>{detail.proposals.map(p => <option value={p.id} key={p.id}>{friendly(p.state)} · {p.author} · {new Date(p.created_at).toLocaleString()}</option>)}</select></label>
          {proposal && <ProposalReview key={proposal.id} proposal={proposal} user={user} run={run} busy={busy} />}
        </> : <div className="empty"><h3>No correction proposed yet</h3><p>Start from the source records. Drafting a proposal never changes the timecard.</p><button className="button primary" onClick={() => setDraft(null)}>Draft the first correction</button></div>}
      </>}
      {tab === "correction" && reviewer && <UnsafeFixDemo cardId={card.id} run={run} busy={busy} />}
      {tab === "pay" && <>
        <ExplainChat cardId={card.id} onCite={reviewer ? undefined : id => setDisputeLine(id)} />
        <TraceTable pay={pay} onDispute={!reviewer ? id => setDisputeLine(id) : undefined} />
        {!reviewer && <button className="button secondary" onClick={() => setDisputeLine(null)}>Ask about this timecard</button>}
        <section className="disputes"><div className="section-heading"><h3>Questions and disputes</h3><span className="figure">{detail.disputes.length} recorded</span></div>
          {!detail.disputes.length && <p className="muted">No disputes recorded. A dispute opens a review—it never changes pay automatically.</p>}
          {detail.disputes.map(d => <div key={d.id} className="dispute"><span className={`badge ${d.resolution ? "green" : "amber"}`}>{d.resolution ? "Resolved" : "Open review"}</span>
            <p>{d.reason}</p><small className="muted">{d.line_id || "Whole timecard"} · revision {d.revision}</small>
            {d.resolution ? <div className="resolution">{d.resolved_by}: {d.resolution}</div> : reviewer && <div className="resolution-form">
              <label>Resolution<textarea value={resolution[d.id] || ""} onChange={e => setResolution(old => ({ ...old, [d.id]: e.target.value }))} placeholder="Explain the outcome. A time change needs its own verified approval." /></label>
              <button className="button secondary small" disabled={(resolution[d.id] || "").length < 8 || busy} onClick={() => run(() => api(`/disputes/${d.id}/resolve`, "POST", { reason: resolution[d.id] }), "Dispute resolution recorded. Pay was not changed.")}>Record resolution</button></div>}</div>)}
        </section>
      </>}
    </div>
    {draft !== undefined && <CorrectionEditor detail={detail} initial={draft || undefined} onClose={() => setDraft(undefined)} run={run} busy={busy} />}
    {disputeLine !== undefined && <div className="modal-backdrop"><section ref={disputeRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="dispute-title"><header><h2 id="dispute-title">Ask for a pay review</h2><button className="icon-button" aria-label="Close dispute" onClick={() => setDisputeLine(undefined)}><X size={18} /></button></header>
      <p className="muted">Your question is linked to {disputeLine || "this timecard"} at revision {card.revision}. Your pay will not change automatically.</p>
      <form onSubmit={e => { e.preventDefault(); run(async () => {
        await api(`/cards/${card.id}/disputes`, "POST", { line_id: disputeLine, reason: disputeReason });
        setDisputeLine(undefined); setDisputeReason("");
      }, "Pay dispute opened and recorded for review."); }}><label>What would you like reviewed?<textarea value={disputeReason} onChange={e => setDisputeReason(e.target.value)} minLength={8} required autoFocus /></label>
        <button className="button primary wide" disabled={busy}>Submit for review</button></form></section></div>}
  </section>;
}

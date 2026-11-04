import { useEffect, useState } from "react";
import {
  ArrowRight, ArrowUpRight, Check, ChevronDown, Code2, FileCheck2, Fingerprint,
  FlaskConical, GitBranch, LockKeyhole, Search, ShieldCheck,
} from "lucide-react";
import {
  api, type AuditEvent, type PolicyDocument, type PolicyResponse, type Scorecard, type User,
} from "./api";
import { friendly, type Run } from "./App";

export function PolicyStudio({ data, user, run, busy }: {
  data: PolicyResponse | null; user: User; run: Run; busy: boolean;
}) {
  const [selected, setSelected] = useState("");
  const [clause, setClause] = useState("DF-004");
  const [reviewed, setReviewed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState("");
  const version = data?.versions.find(p => p.id === selected) ||
    data?.versions.find(p => p.id === data.active_id) || data?.versions[0];
  if (!version) return <div className="loading">Loading source and compiled rules…</div>;
  const active = version.id === data?.active_id;
  const activeVersion = data?.versions.find(p => p.id === data.active_id);
  return <section className="policy-studio">
    <header className="studio-toolbar"><div><GitBranch size={18} /><select aria-label="Policy version" value={version.id} onChange={e => { setSelected(e.target.value); setReviewed(false); }}>
      {data?.versions.map(v => <option key={v.id} value={v.id}>{v.version}{v.id === data.active_id ? " · active" : v.signer ? " · signed" : " · draft"}</option>)}</select>
      <span className={`badge ${active ? "green" : "amber"}`}>{active ? "Active & signed" : version.signer ? "Signed version" : "Awaiting sign-off"}</span></div>
      {user.role === "reviewer" && <button className="button secondary small" onClick={() => {
        setEditing(!editing); setSource(JSON.stringify({ ...version.document, version: `${version.version}-next` }, null, 2));
      }}><Code2 size={15} />{editing ? "Close source editor" : "Compile a new version"}</button>}
    </header>
    {editing && <form className="source-editor" onSubmit={e => { e.preventDefault(); run(async () => {
      const document = JSON.parse(source) as PolicyDocument;
      const result = await api<{ id: string }>("/policies/compile", "POST", document);
      setSelected(result.id); setEditing(false); setReviewed(false);
    }, "New immutable ruleset compiled. Review and sign it before activation."); }}>
      <div className="section-heading"><span className="eyebrow">BOUNDED POLICY SOURCE</span><span>Strict JSON · supported parameters only</span></div>
      <p className="muted">Edit the clause text and supported rule values together. The compiler checks the schema, ordering, and literal source support; a human must inspect semantic correctness. It does not translate arbitrary legal documents.</p>
      <label>Versioned source document<textarea spellCheck={false} value={source} onChange={e => setSource(e.target.value)} required /></label>
      <button className="button primary" disabled={busy}><Code2 size={16} />Validate & compile draft</button>
    </form>}
    <div className="policy-columns"><section className="rule-mappings"><div className="section-heading"><div><span className="eyebrow">EXECUTABLE RULESET</span><h2>Plain rules. Visible origins.</h2></div><FileCheck2 size={23} /></div>
      <p className="muted">Every parameter maps to a source clause. Fixed salary, rounding, leave, and approval semantics are visible in the source and implemented by the versioned engine—not generated code.</p>
      <table className="rules-table"><thead><tr><th>COMPILED PARAMETER</th><th>VALUE</th><th>SOURCE</th></tr></thead>
        <tbody>{version.mappings.map(m => {
          const previous = activeVersion?.document.rules[m.field];
          const changed = previous !== undefined && String(previous) !== m.value;
          return <tr key={m.field} className={clause === m.clause ? "selected" : ""}><td><strong>{friendly(m.field)}</strong>{changed && <small className="rule-diff">Active: {String(previous)} <ArrowRight size={10} /> draft: {m.value}</small>}</td>
            <td><code>{m.value}</code></td><td><button className="citation" onClick={() => setClause(m.clause)}>{m.clause}<ArrowUpRight size={11} /></button></td></tr>;
        })}</tbody></table>
      <details className="hash-details"><summary><Fingerprint size={14} />Immutable content fingerprints<ChevronDown size={13} /></summary><code>Ruleset: {version.content_hash}<br />Source: {version.source_hash}</code></details>
    </section>
      <aside className="policy-source"><div className="section-heading"><span className="eyebrow">SUPPORTING POLICY CLAUSE</span><select aria-label="Source clause" value={clause} onChange={e => setClause(e.target.value)}>
        {Object.keys(version.document.clauses).map(c => <option key={c}>{c}</option>)}</select></div>
        <div className="clause-document"><span className="document-label"><FileCheck2 size={14} />FICTIONAL POLICY · {clause}</span><pre>{version.document.clauses[clause]}</pre></div>
        <div className="sign-off"><ShieldCheck size={23} /><h3>A human puts the rules into effect.</h3>
          {version.signer && <p className="signed-by"><Check size={14} />Signed by {version.signer}<small>{new Date(version.signed_at!).toLocaleString()}</small></p>}
          {active ? <div className="success-box">This exact ruleset is active. New versions cannot modify it in place.</div> :
            user.role === "reviewer" ? <>
              <label className="checkbox"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I reviewed all source clauses, mappings, assumptions, and golden examples. I approve this fictional ruleset.</label>
              <button className="button primary wide" disabled={!reviewed || busy} onClick={() => run(() => api(`/policies/${version.id}/sign`, "POST", { hash: version.content_hash, reviewed }), "Ruleset signed and activated. Old pending proofs must be re-created.")}><ShieldCheck size={16} />Sign & activate ruleset</button>
            </> : <p className="muted">An authorized reviewer must sign and activate this ruleset.</p>}
          <small>simplified mock policy, not legal advice</small>
        </div>
      </aside></div>
  </section>;
}

export function AuditLedger({ refresh }: { refresh: number }) {
  const [data, setData] = useState<{ events: AuditEvent[]; integrity: boolean; unverified_commits: number } | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    let active = true;
    api<NonNullable<typeof data>>("/audit").then(result => { if (active) setData(result); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [refresh]);
  if (error) return <div role="alert" className="error-box">{error}</div>;
  if (!data) return <div className="loading">Checking the audit hash chain…</div>;
  const events = data.events.filter(e => `${e.action} ${e.actor} ${e.entity}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="ledger">
    <div className="ledger-header"><div className={`integrity ${data.integrity ? "" : "invalid"}`}><ShieldCheck size={27} /><div><h2>{data.integrity ? "The chain is intact." : "Integrity check failed."}</h2><p>{data.events.length} append-only events · {data.unverified_commits} unverified commits</p></div></div>
      <label className="search"><Search size={16} /><input placeholder="Find an actor, action, or reference…" aria-label="Search audit ledger" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
    <div className="ledger-table"><div className="ledger-labels"><span>SEQUENCE / WHEN</span><span>DECISION & EVIDENCE</span><span>ACTOR</span></div>
      {events.map(e => <details className="ledger-event" key={e.sequence}><summary><div className="ledger-time"><span className="sequence">{String(e.sequence).padStart(3, "0")}</span><time>{new Date(e.at).toLocaleString()}</time></div>
        <div className="ledger-action"><span className={`event-symbol ${e.action.includes("committed") ? "committed" : ""}`}>{e.action.includes("committed") ? <Check size={15} /> : <GitBranch size={15} />}</span>
          <div><strong>{friendly(e.action)}</strong><small>{e.entity}</small></div></div><span className="actor-label">{e.actor}<ChevronDown size={13} /></span></summary>
        <div className="ledger-evidence"><pre>{JSON.stringify(e.details, null, 2)}</pre><div><span className="eyebrow">CHAIN LINK</span><code>Previous: {e.previous_hash}<br />Event: {e.event_hash}</code></div></div>
      </details>)}</div>
    <div className="info-box"><LockKeyhole size={17} /><span>Database triggers enforce append-only audit events. Hashes expose altered history; SQLite is not tamper-proof against a database administrator.</span></div>
  </section>;
}

export function EvalScorecard({ refresh }: { refresh: number }) {
  const [data, setData] = useState<Scorecard | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<Scorecard>("/scorecard").then(result => { if (active) setData(result); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [refresh]);
  if (error) return <div className="error-box" role="alert">{error}</div>;
  if (!data) return <div className="loading"><FlaskConical />Evaluating independently labelled synthetic cases…</div>;
  return <section className="eval-page">
    <div className="scorecard-intro"><div><span className="eyebrow">PUBLIC, REPRODUCIBLE EVIDENCE</span><h2>Trust is a measured behavior.</h2><p>Deterministic detection against held-out synthetic labels. Model evaluations are separate, never implied by fixture results.</p></div>
      <div className="corpus-stamp"><FlaskConical size={25} /><strong>{data.labelled_exceptions}</strong><span>labelled exceptions</span><small>{data.employees} employees · {data.periods} periods · seed {data.held_out_seed}</small></div></div>
    <table className="score-table"><thead><tr><th>DETECTOR</th><th>PRECISION</th><th>RECALL</th><th className="numeric">TRUE POSITIVE</th><th className="numeric">FALSE POSITIVE</th><th className="numeric">MISSED</th></tr></thead>
      <tbody>{Object.entries(data.detection).map(([family, m]) => <tr key={family}><td><strong>{friendly(family)}</strong></td>
        <td><div className="metric-bar"><span style={{ width: `${m.precision * 100}%` }} /></div><strong>{(m.precision * 100).toFixed(1)}%</strong><small>TP / (TP + FP)</small></td>
        <td><div className="metric-bar"><span style={{ width: `${m.recall * 100}%` }} /></div><strong>{(m.recall * 100).toFixed(1)}%</strong><small>TP / (TP + FN)</small></td>
        <td className="numeric">{m.tp}</td><td className="numeric">{m.fp}</td><td className="numeric">{m.fn}</td></tr>)}</tbody></table>
    <div className="eval-details"><section><span className="eyebrow">INTEGRITY & CORRECTION GATES</span><h3>No verification, no commit.</h3>
      {data.release_gates ? <dl className="gate-list">{Object.entries(data.release_gates).map(([key, value]) => <div key={key}><dt>{friendly(key)}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl> :
        <div className="info-box"><FlaskConical size={18} /><span>No integration scorecard artifact is available. Run the documented evaluation command; unavailable tests are not reported as passes.</span></div>}
      <p className="muted">Fix acceptance is eligible labelled corrections accepted by the verifier, not assumed manager acceptance. Injection resistance includes benign controls, so rejecting everything cannot pass.</p></section>
      <section className="eval-provenance"><span className="eyebrow">PROVENANCE, NOT PROMISES</span><h3>Know what was exercised.</h3>
        <p>{data.provenance}</p><p><strong>Real-model evaluation:</strong> {data.model_evaluation}</p>
        <p>These synthetic cases do not establish legal compliance, general-model robustness, or production readiness.</p><code>python -m app.evals</code>
      </section></div>
  </section>;
}

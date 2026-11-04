import { useEffect, useState } from "react";
import { Search } from "lucide-react";
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
  const changes = version.mappings.filter(m => {
    const previous = activeVersion?.document.rules[m.field];
    return previous !== undefined && String(previous) !== m.value;
  }).length;
  return <section className="policy-studio">
    <header className="studio-toolbar">
      <label className="version-picker"><span className="sr-only">Policy version</span><select aria-label="Policy version" value={version.id} onChange={e => { setSelected(e.target.value); setReviewed(false); }}>
        {data?.versions.map(v => <option key={v.id} value={v.id}>{v.version}{v.id === data.active_id ? " · active" : v.signer ? " · signed" : " · draft"}</option>)}</select></label>
      <span className={`badge ${active ? "green" : "amber"}`}>{active ? "Active & signed" : version.signer ? "Signed version" : "Awaiting sign-off"}</span>
      {!active && changes > 0 && <span className="muted">{changes} {changes === 1 ? "value differs" : "values differ"} from the active ruleset</span>}
      <span className="toolbar-spacer" />
      {user.role === "reviewer" && <button className="button secondary small" onClick={() => {
        setEditing(!editing); setSource(JSON.stringify({ ...version.document, version: `${version.version}-next` }, null, 2));
      }}>{editing ? "Close source editor" : "Compile a new version"}</button>}
    </header>
    {editing && <form className="source-editor" onSubmit={e => { e.preventDefault(); run(async () => {
      const document = JSON.parse(source) as PolicyDocument;
      const result = await api<{ id: string }>("/policies/compile", "POST", document);
      setSelected(result.id); setEditing(false); setReviewed(false);
    }, "New immutable ruleset compiled. Review and sign it before activation."); }}>
      <p className="muted">Edit clause text and supported rule values together. The compiler checks the schema, ordering and that each value appears in its clause. Whether the rule is right is still a human decision.</p>
      <label>Versioned source document<textarea className="figure" spellCheck={false} value={source} onChange={e => setSource(e.target.value)} required /></label>
      <button className="button primary" disabled={busy}>Validate & compile draft</button>
    </form>}
    <div className="policy-columns">
      <section className="rule-mappings">
        <div className="section-heading"><h3>Parameters</h3><span className="figure">{version.mappings.length} values · {Object.keys(version.document.clauses).length} clauses</span></div>
        <table className="rules-table"><thead><tr><th>Parameter</th><th className="numeric">Value</th><th>Clause</th></tr></thead>
          <tbody>{version.mappings.map(m => {
            const previous = activeVersion?.document.rules[m.field];
            const changed = previous !== undefined && String(previous) !== m.value;
            return <tr key={m.field} className={`${clause === m.clause ? "selected" : ""} ${changed ? "changed" : ""}`}><td>{friendly(m.field)}{changed && <small className="rule-diff">Active: {String(previous)} → draft: {m.value}</small>}</td>
              <td className="numeric figure">{m.value}</td><td><button className="citation" onClick={() => setClause(m.clause)}>{m.clause}</button></td></tr>;
          })}</tbody></table>
        <details className="hash-details"><summary>Content fingerprints</summary><code>Ruleset: {version.content_hash}<br />Source: {version.source_hash}</code></details>
      </section>
      <aside className="policy-source">
        <div className="section-heading"><h3>Source clause</h3><select aria-label="Source clause" value={clause} onChange={e => setClause(e.target.value)}>
          {Object.keys(version.document.clauses).map(c => <option key={c}>{c}</option>)}</select></div>
        <div className="clause-document"><span className="label">{clause} · fictional policy {version.version}</span><pre>{reflow(version.document.clauses[clause])}</pre></div>
        <div className="sign-off"><h3>Sign-off</h3>
          {version.signer && <p className="signed-by">Signed by {version.signer}<small className="figure">{new Date(version.signed_at!).toLocaleString()}</small></p>}
          {active ? <div className="success-box">This exact ruleset is active. New versions cannot modify it in place.</div> :
            user.role === "reviewer" ? <>
              <label className="checkbox"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I reviewed all source clauses, mappings, assumptions, and golden examples. I approve this fictional ruleset.</label>
              <button className="button primary wide" disabled={!reviewed || busy} onClick={() => run(() => api(`/policies/${version.id}/sign`, "POST", { hash: version.content_hash, reviewed }), "Ruleset signed and activated. Old pending proofs must be re-created.")}>Sign & activate ruleset</button>
            </> : <p className="muted">An authorized reviewer must sign and activate this ruleset.</p>}
          <small className="disclaimer">simplified mock policy, not legal advice</small>
        </div>
      </aside>
    </div>
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
  const kind = (action: string) => action.includes("committed") || action.includes("approved") ? "commit" :
    action.includes("reject") || action.includes("blocked") || action.includes("failed") ? "stop" :
    action.includes("policy") ? "policy" : "";
  return <section className="ledger">
    <div className="ledger-header"><div className={`integrity ${data.integrity ? "" : "invalid"}`}><h2>{data.integrity ? "The chain is intact." : "Integrity check failed."}</h2><p className="figure">{data.events.length} append-only events · {data.unverified_commits} unverified commits</p></div>
      <label className="search"><Search size={15} aria-hidden="true" /><input placeholder="Actor, action or record" aria-label="Search audit ledger" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
    <ol className="chain">{events.map(e => <li key={e.sequence} className={kind(e.action)}><details><summary>
      <span className="sequence figure">{String(e.sequence).padStart(3, "0")}</span>
      <span className="chain-node" aria-hidden="true" />
      <span className="chain-what"><strong>{friendly(e.action)}</strong><small>{e.entity}</small></span>
      <span className="chain-who">{e.actor}</span>
      <time className="figure">{new Date(e.at).toLocaleString()}</time>
      <code className="chain-hash figure" title={e.event_hash}>{e.event_hash.slice(0, 8)}</code></summary>
      <div className="ledger-evidence"><pre>{JSON.stringify(e.details, null, 2)}</pre><code>Previous: {e.previous_hash}<br />Event: {e.event_hash}</code></div>
    </details></li>)}</ol>
    {!events.length && <p className="muted">No events match “{query}”.</p>}
    <div className="info-box">Database triggers block updates and deletes on audit rows. The hash chain exposes edited history; SQLite is not tamper-proof against a database administrator.</div>
  </section>;
}

function ratio(value: unknown): [number, number] | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d+)\/(\d+)$/);
  return match ? [Number(match[1]), Number(match[2])] : null;
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
  if (!data) return <div className="loading">Evaluating independently labelled synthetic cases…</div>;
  const gates = data.release_gates ? Object.entries(data.release_gates).filter(([key]) => key !== "scope") : [];
  const scope = data.release_gates?.scope;
  return <section className="eval-page">
    <div className="scorecard-intro"><div><h2>Trust is a measured behavior.</h2><p>Detectors run against a held-out synthetic set whose labels were written before the detectors. Model quality is reported separately.</p></div>
      <div className="corpus"><strong className="figure">{data.labelled_exceptions}</strong><span>labelled exceptions</span><small className="figure">{data.employees} employees · {data.periods} periods · seed {data.held_out_seed}</small></div></div>
    <table className="score-table"><thead><tr><th>Detector</th><th>Precision <small>TP / (TP + FP)</small></th><th>Recall <small>TP / (TP + FN)</small></th><th className="numeric">TP</th><th className="numeric">FP</th><th className="numeric">FN</th></tr></thead>
      <tbody>{Object.entries(data.detection).map(([family, m]) => <tr key={family}><td>{friendly(family)}</td>
        <td><div className="meter"><div className="metric-bar"><span style={{ width: `${m.precision * 100}%` }} /></div><b className="figure">{(m.precision * 100).toFixed(1)}%</b></div></td>
        <td><div className="meter"><div className="metric-bar"><span style={{ width: `${m.recall * 100}%` }} /></div><b className="figure">{(m.recall * 100).toFixed(1)}%</b></div></td>
        <td className="numeric figure">{m.tp}</td><td className="numeric figure">{m.fp}</td><td className="numeric figure">{m.fn}</td></tr>)}</tbody></table>
    <div className="eval-details">
      <section><div className="section-heading"><h3>Release gates</h3></div>
        {data.release_gates ? <ul className="gates">{gates.map(([key, value]) => {
          const r = ratio(value);
          const pass = r ? r[0] === r[1] : value === true || value === 0;
          return <li key={key} className={pass ? "pass" : "fail"}><span>{friendly(key)}</span>
            {r ? <span className="gate-ticks" aria-hidden="true">{Array.from({ length: r[1] }, (_, i) => <i key={i} className={i < r[0] ? "on" : ""} />)}</span> : <span />}
            <b className="figure">{typeof value === "object" ? JSON.stringify(value) : String(value)}</b></li>;
        })}</ul> :
          <div className="info-box">No integration scorecard artifact is available. Run the documented evaluation command; unavailable tests are not reported as passes.</div>}
        {typeof scope === "string" && <p className="muted">{scope}</p>}
        <p className="muted">Fix acceptance counts eligible labelled corrections the verifier accepted, not manager approvals. The injection set includes benign notes, so blocking everything fails.</p></section>
      <section className="eval-provenance"><div className="section-heading"><h3>Provenance</h3></div>
        <p>{data.provenance}</p><p><strong>Real-model evaluation.</strong> {data.model_evaluation}</p>
        <p className="muted">Synthetic cases do not establish legal compliance, general model robustness or production readiness. {data.disclaimer}</p><code className="figure">python -m app.evals</code>
      </section></div>
  </section>;
}

function reflow(text = "") {
  return text.split("\n").reduce<string[]>((out, line) => {
    const t = line.trim();
    if (!t) out.push("");
    else if (out.length && out[out.length - 1] && !/^[-*]\s/.test(t)) out[out.length - 1] += " " + t;
    else out.push(t);
    return out;
  }, []).join("\n");
}

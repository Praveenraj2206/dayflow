import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Activity, ArrowRight, BrainCircuit, CheckCheck, Cpu, FileSearch, ShieldCheck, Sparkles } from "lucide-react";
import { api, type AuditEvent, type CardRow, type PolicyResponse, type User } from "./api";
import { currency, friendly, type Run } from "./App";
import { CountUp, Rise, Stagger } from "./motion";

export type LlmStatus = {
  mode: string; model: string; licence: string; reachable: boolean | null; enabled: boolean;
  configured: boolean; models: { name: string; licence: string; size_gb: number }[];
};

/** AI engine card: runtime on/off, local open-weight model picker, licence notice. */
export function AiEngine({ run, busy, refresh }: { run: Run; busy: boolean; refresh: number }) {
  const [status, setStatus] = useState<LlmStatus | null>(null);
  useEffect(() => {
    let live = true;
    api<LlmStatus>("/llm/status").then(s => { if (live) setStatus(s); }).catch(() => undefined);
    return () => { live = false; };
  }, [refresh]);
  if (!status) return <div className="card ai-engine"><div className="skeleton"><i /><i /></div></div>;
  const on = status.configured && status.enabled;
  return <div className={`card ai-engine ${on ? "on" : ""}`}>
    <div className="card-head"><span className="chip-icon"><Cpu size={16} /></span><h3>AI engine</h3>
      <span className={`badge ${on ? "green" : "neutral"}`}>{!status.configured ? "Not configured" : on ? "Live" : "Paused"}</span></div>
    <p className="muted">{status.mode === "ollama" ? "Open-weight model running locally through Ollama. Prompts and data never leave this machine."
      : status.mode === "openai" ? "Hosted OpenAI-compatible model." : "No model configured. Detection and verification run without AI."}</p>
    {status.mode === "ollama" && <>
      <label className="field">Model
        <select value={status.model} disabled={busy} onChange={e => run(() => api("/llm", "POST", { enabled: status.enabled, model: e.target.value }), `Model set to ${e.target.value}. Every output is still validated.`)}>
          {!status.models.some(m => m.name === status.model) && <option value={status.model}>{status.model} (not installed)</option>}
          {status.models.map(m => <option key={m.name} value={m.name}>{m.name} · {m.size_gb} GB</option>)}</select></label>
      <div className="ai-status"><i className={`dot ${status.reachable ? "ok" : "bad"}`} />{status.reachable ? "Ollama reachable" : "Ollama not reachable. Start it with `ollama serve`."}</div>
    </>}
    <div className="licence"><strong>Licence</strong><span>{status.licence}</span><small>Verify the model's licence and acceptable-use terms before use.</small></div>
    {status.configured && <button className={`button ${on ? "secondary" : "primary"} wide`} disabled={busy}
      onClick={() => run(() => api("/llm", "POST", { enabled: !status.enabled }), on ? "AI paused. Everything routes to deterministic checks." : "AI on. Every output is still validated.")}>
      {on ? "Pause AI" : "Turn AI on"}</button>}
  </div>;
}

function Donut({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const R = 52, C = 2 * Math.PI * R;
  let offset = 0;
  return <div className="donut">
    <svg viewBox="0 0 140 140" role="img" aria-label="Exceptions by family">
      <circle cx="70" cy="70" r={R} className="donut-track" />
      {parts.map((p, i) => {
        const length = (p.value / total) * C; const start = offset; offset += length;
        return <motion.circle key={p.label} cx="70" cy="70" r={R} fill="none" stroke={p.color} strokeWidth="16" strokeLinecap="butt"
          strokeDasharray={`${Math.max(length - 2, 0)} ${C}`} transform={`rotate(-90 70 70)`} strokeDashoffset={-start}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 * i, duration: 0.6 }} />;
      })}
      <text x="70" y="68" textAnchor="middle" className="donut-n">{total === 1 && !parts.length ? 0 : parts.reduce((s, p) => s + p.value, 0)}</text>
      <text x="70" y="86" textAnchor="middle" className="donut-l">exceptions</text>
    </svg>
    <ul>{parts.map(p => <li key={p.label}><i style={{ background: p.color }} />{friendly(p.label)}<b className="figure">{p.value}</b></li>)}</ul>
  </div>;
}

const FAMILY_COLORS = ["#4f7cff", "#7c5cff", "#19b5c8", "#f59e0b", "#ef5b7a", "#34c38f"];
const eventIcon = (action: string) =>
  action.includes("investig") || action.includes("explain") || action.includes("draft") ? <BrainCircuit size={14} /> :
    action.includes("commit") || action.includes("approv") ? <CheckCheck size={14} /> :
      action.includes("verif") || action.includes("policy") ? <ShieldCheck size={14} /> : <Activity size={14} />;

export default function Overview({ cards, policies, signed, user, run, busy, refresh, go }: {
  cards: CardRow[]; policies: PolicyResponse | null; signed: boolean; user: User; run: Run; busy: boolean;
  refresh: number; go: (page: string, cardId?: string) => void;
}) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [integrity, setIntegrity] = useState<{ ok: boolean; unverified: number } | null>(null);
  useEffect(() => {
    let live = true;
    api<{ events: AuditEvent[]; integrity: boolean; unverified_commits: number }>("/audit").then(data => {
      if (!live) return; setEvents(data.events.slice(0, 7)); setIntegrity({ ok: data.integrity, unverified: data.unverified_commits });
    }).catch(() => undefined);
    return () => { live = false; };
  }, [refresh]);
  const exceptions = cards.flatMap(c => c.exceptions);
  const families = Object.entries(exceptions.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.family]: (acc[e.family] || 0) + 1 }), {}))
    .sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label, value, color: FAMILY_COLORS[i % FAMILY_COLORS.length] }));
  const stage = (names: string[]) => cards.filter(c => names.includes(c.workflow)).length;
  const funnel = [
    ["Detected", cards.filter(c => c.exceptions.length).length],
    ["Proposed", stage(["proposed", "manual_review", "verified", "committed"])],
    ["Verified", stage(["verified", "committed"])],
    ["Committed", stage(["committed"])],
  ] as [string, number][];
  const top = Math.max(1, ...funnel.map(f => f[1]));
  const gross = cards.reduce((s, c) => s + (c.total ? Number(c.total) : 0), 0);
  const maya = cards.find(c => c.exceptions.some(e => e.code === "missing_endpoint"));
  const hour = new Date().getHours();
  const kpis: [string, number, (n: number) => string, string][] = [
    ["Open exceptions", exceptions.length, n => String(Math.round(n)), "amber"],
    ["Timecards to review", cards.filter(c => c.exceptions.length).length, n => String(Math.round(n)), "blue"],
    ["Verified, awaiting approval", stage(["verified"]), n => String(Math.round(n)), "violet"],
    ["Committed fixes", stage(["committed"]), n => String(Math.round(n)), "green"],
    ["Calculable gross pay", gross, n => currency(String(n)).replace(/\.\d+$/, ""), "teal"],
  ];
  return <Stagger className="overview">
    <Rise className="hero">
      <div><span className="eyebrow"><Sparkles size={14} />{hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, {user.name.split(" ")[0]}</span>
        <h1>Every correction, <em>proven</em> before it counts.</h1>
        <p>AI drafts. A deterministic engine recomputes the pay. A second human approves. Nothing is committed without all three.</p></div>
      <div className="hero-actions">
        {maya && <button className="button primary" onClick={() => go("desk", maya.id)}>Open a missed punch <ArrowRight size={15} /></button>}
        <button className="button ghost" onClick={() => go("policy")}>{signed ? "Review ruleset" : "Sign the ruleset"}</button>
      </div>
    </Rise>
    <Rise className="kpis">{kpis.map(([label, value, format, tone]) => <div key={label} className={`kpi tone-${tone}`}>
      <span>{label}</span><strong><CountUp value={value} format={format} /></strong></div>)}</Rise>
    <Rise className="pipeline" >
      {[[<BrainCircuit size={18} key="a" />, "AI proposes", "Cited, schema-checked suggestions. Never touches pay or records.", "violet"],
        [<ShieldCheck size={18} key="b" />, "Engine verifies", "Recomputes the whole period and rejects anything unsafe.", "blue"],
        [<CheckCheck size={18} key="c" />, "Human approves", "A different reviewer commits. Everything is hash-chained.", "green"]].map(([icon, title, text, tone], i) =>
        <motion.div key={String(title)} className={`step tone-${tone}`} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + i * 0.15 }}>
          <span className="step-icon">{icon}</span><div><strong>{title}</strong><p>{text}</p></div>
          {i < 2 && <span className="flow" aria-hidden="true"><i /></span>}</motion.div>)}
    </Rise>
    <Rise className="grid-2">
      <div className="card"><div className="card-head"><span className="chip-icon"><FileSearch size={16} /></span><h3>Exception mix</h3></div>
        {families.length ? <Donut parts={families} /> : <p className="muted">No exceptions detected.</p>}</div>
      <div className="card"><div className="card-head"><span className="chip-icon"><Activity size={16} /></span><h3>Resolution funnel</h3></div>
        <div className="funnel">{funnel.map(([label, value], i) => <div key={label} className="funnel-row"><span>{label}</span>
          <div className="bar"><motion.i initial={{ width: 0 }} animate={{ width: `${(value / top) * 100}%` }} transition={{ delay: 0.25 + i * 0.1, duration: 0.7, ease: [0.22, 1, 0.36, 1] }} /></div>
          <b className="figure">{value}</b></div>)}</div>
        {integrity && <div className={`trust-note ${integrity.ok && !integrity.unverified ? "ok" : "bad"}`}><ShieldCheck size={15} />
          Audit chain {integrity.ok ? "intact" : "BROKEN"} · {integrity.unverified} unverified commits</div>}
      </div>
    </Rise>
    <Rise className="grid-2">
      <AiEngine run={run} busy={busy} refresh={refresh} />
      <div className="card"><div className="card-head"><span className="chip-icon"><Activity size={16} /></span><h3>Live activity</h3>
        <button className="text-button" onClick={() => go("audit")}>Open ledger</button></div>
        <ul className="feed">{events.length ? events.map((e, i) => <motion.li key={e.sequence} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.05 }}>
          <span className="feed-icon">{eventIcon(e.action)}</span><div><strong>{friendly(e.action)}</strong><small>{e.actor} · {new Date(e.at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</small></div></motion.li>)
          : <li className="muted">Activity appears here as work happens.</li>}</ul></div>
    </Rise>
  </Stagger>;
}

import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight, ChevronRight, Command, FileCheck2, FlaskConical, Layers3,
  LogOut, PanelLeftClose, Search, ShieldCheck, Sparkles, Wallet, X,
} from "lucide-react";
import { api, setSession, type CardRow, type Detail, type PolicyResponse, type User } from "./api";
import Workspace from "./Workspace";
import { AuditLedger, EvalScorecard, PolicyStudio } from "./Governance";

export type Run = (action: () => Promise<unknown>, message: string) => Promise<void>;
export const currency = (value: string | null) => value === null ? "Not yet calculable" :
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));
export const duration = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
export const period = (start: string) => {
  const date = new Date(`${start}T12:00:00Z`);
  const end = new Date(date); end.setUTCDate(date.getUTCDate() + 13);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(date)} – ${fmt(end)}`;
};
export const initials = (name: string) => name.split(" ").map(w => w[0]).slice(0, 2).join("");
export const friendly = (value: string) => value.replaceAll("_", " ");

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState("avery@dayflow.demo");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <main className="login">
    <section className="login-story">
      <div className="brand"><span className="brand-mark"><Layers3 size={25} /></span>dayflow<span className="brand-dot">.</span></div>
      <div className="login-copy"><span className="eyebrow light">WORKFORCE INTELLIGENCE, WITH RECEIPTS</span>
        <h1>Every hour matters.<br /><em>Make it make sense.</em></h1>
        <p>Turn timecard exceptions into clear, verified decisions.<br />A little less uncertainty. A lot more trust.</p>
        <div className="trust-path"><span>Evidence</span><ChevronRight size={16} /><span>Verification</span>
          <ChevronRight size={16} /><span>Human approval</span></div>
      </div>
      <div className="login-foot"><ShieldCheck size={18} /> Synthetic workforce. Real verification boundaries.</div>
      <div className="orb one" /><div className="orb two" />
    </section>
    <section className="login-form">
      <span className="eyebrow">YOUR WORKDAY, RECONCILED</span>
      <h2>Welcome to Dayflow</h2><p className="muted">Sign in to your workforce workspace.</p>
      <form onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError("");
        try { const user = await api<User>("/login", "POST", { email, password }); setSession(user); onLogin(user); }
        catch (err) { setError(err instanceof Error ? err.message : "Sign-in failed"); }
        finally { setBusy(false); }
      }}>
        <label>Work email<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        {error && <div role="alert" className="error-box">{error}</div>}
        <button className="button primary wide" disabled={busy}>{busy ? "Signing in…" : "Enter workspace"}<ArrowUpRight size={17} /></button>
      </form>
      <div className="demo-access"><span className="eyebrow">LOCAL DEMO IDENTITIES</span>
        <p>Separate authenticated accounts—not a role toggle.</p>
        <div className="demo-buttons">{[
          ["avery", "Avery · reviewer"], ["taylor", "Taylor · independent approver"], ["e001", "Maya · employee"],
        ].map(([id, label]) => <button key={id} onClick={() => {
          setEmail(`${id}@dayflow.demo`); setPassword("Dayflow-demo-2026!");
        }}>{label}<ChevronRight size={13} /></button>)}</div>
        <small>Demo password: <code>Dayflow-demo-2026!</code>. Local synthetic demonstration only; not production authentication.</small>
      </div>
      <footer>simplified mock policy, not legal advice</footer>
    </section>
  </main>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [page, setPage] = useState("desk");
  const [cards, setCards] = useState<CardRow[]>([]);
  const [policies, setPolicies] = useState<PolicyResponse | null>(null);
  const [signed, setSigned] = useState(false);
  const [mode, setMode] = useState("off");
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("attention");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => { window.scrollTo(0, 0); }, [page, user]);
  useEffect(() => {
    api<User>("/me").then(result => {
      setSession(result); setUser(result); setPage(result.role === "employee" ? "pay" : "desk");
    })
      .catch(err => {
        if (err.message !== "Sign in to continue") setNotice({ text: err.message, error: true });
      }).finally(() => setInitializing(false));
  }, []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    Promise.all([
      api<{ cards: CardRow[]; policy_signed: boolean }>("/cards"),
      api<PolicyResponse>("/policies"), api<{ llm_mode: string }>("/config"),
    ]).then(([data, policy, config]) => {
      if (!active) return;
      setCards(data.cards); setSigned(data.policy_signed); setPolicies(policy); setMode(config.llm_mode);
      setSelected(old => data.cards.some(c => c.id === old) ? old :
        (data.cards.find(c => c.exceptions.some(e => e.code === "missing_endpoint")) || data.cards[0])?.id || "");
    }).catch(err => { if (active) setNotice({ text: err.message, error: true }); });
    return () => { active = false; };
  }, [user, refresh]);
  useEffect(() => {
    if (!user || !selected) { setDetail(null); return; }
    let active = true; setDetail(old => old?.card.id === selected ? old : null);
    api<Detail>(`/cards/${selected}`).then(data => { if (active) setDetail(data); })
      .catch(err => { if (active) setNotice({ text: err.message, error: true }); });
    return () => { active = false; };
  }, [user, selected, refresh]);
  const run: Run = useCallback(async (action, message) => {
    setBusy(true); setNotice(null);
    try { await action(); setRefresh(value => value + 1); setNotice({ text: message, error: false }); }
    catch (err) { setNotice({ text: err instanceof Error ? err.message : "The operation failed", error: true }); }
    finally { setBusy(false); }
  }, []);
  if (initializing) return <div className="loading-screen"><Layers3 />Opening your workspace…</div>;
  if (!user) return <Login onLogin={result => {
    setUser(result); setPage(result.role === "employee" ? "pay" : "desk"); setSelected("");
  }} />;
  const attention = cards.filter(c => c.exceptions.length > 0).length;
  const exceptions = cards.reduce((sum, c) => sum + c.exceptions.length, 0);
  const complete = cards.filter(c => c.pay_status === "complete").length;
  const visible = cards.filter(c =>
    `${c.employee.name} ${c.employee.department} ${c.id}`.toLowerCase().includes(search.toLowerCase()) &&
    (page === "pay" || filter === "all" || (filter === "attention" && c.exceptions.length > 0) ||
      (filter === "blocked" && c.pay_status === "incomplete") ||
      (filter === "verified" && c.workflow === "verified") || (filter === "committed" && c.workflow === "committed")));
  const nav = [
    ...(user.role === "reviewer" ? [["desk", "Exception desk", FileCheck2]] as const : []),
    ["pay", "Pay explorer", Wallet], ["policy", "Policy studio", Layers3],
    ...(user.role === "reviewer" ? [["audit", "Audit ledger", ShieldCheck], ["evals", "Eval scorecard", FlaskConical]] as const : []),
  ] as const;
  const titles: Record<string, string> = {
    desk: "Exception desk", pay: "Pay explorer", policy: "Policy studio",
    audit: "Audit ledger", evals: "Eval scorecard",
  };
  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => e.preventDefault()} aria-label="Dayflow"><span className="brand-mark"><Layers3 size={22} /></span>dayflow<span className="brand-dot">.</span></a>
      <div className="workspace-label"><span className="workspace-icon">D</span><div>Dayflow Collective<small>Synthetic workspace</small></div><PanelLeftClose size={14} /></div>
      <span className="nav-heading">WORKSPACE</span>
      <nav>{nav.map(([key, title, Icon]) => <button key={key} aria-label={title} className={page === key ? "active" : ""} onClick={() => setPage(key)}>
        <Icon size={18} /><span>{title}</span>{key === "desk" && <span aria-hidden="true" className="nav-count">{attention}</span>}
      </button>)}</nav>
      <div className="sidebar-bottom">
        <div className="harness-label"><span className={`status-dot ${mode !== "off" ? "online" : ""}`} /><span>{mode === "off" ? "Deterministic mode" : "AI assistance enabled"}</span><ShieldCheck size={14} /></div>
        <div className="profile"><span className="avatar">{initials(user.name)}</span><div>{user.name}<small>{friendly(user.role)}</small></div>
          <button className="icon-button" aria-label="Sign out" onClick={() => run(async () => {
            await api("/logout", "POST"); setSession(null); setUser(null); setCards([]); setDetail(null);
          }, "Signed out")}><LogOut size={17} /></button></div>
      </div>
    </aside>
    <main className={`main ${busy ? "busy" : ""}`} aria-busy={busy}>
      <header className="topbar"><div>Workspace <ChevronRight size={13} /><strong>{titles[page]}</strong></div>
        <div><span className="environment-tag">DEMO ENVIRONMENT</span><span className="topbar-divider" /><Command size={15} /><span className="muted">Evidence over assumptions</span></div>
      </header>
      <div className="page-heading"><div><span className="eyebrow">CLARITY FROM CLOCK-IN TO PAYCHECK</span>
        <h1>{page === "desk" ? "A clearer path to payday." : titles[page]}</h1>
        <p>{page === "desk" ? "Investigate the exception. Verify the correction. Keep people in control." :
          page === "pay" ? "Every earnings line, its source, and the rule behind it. Nothing hidden in a total." :
          page === "policy" ? "Policy you can inspect, version, and put your name behind." :
          page === "audit" ? "A durable record of who decided what—and the evidence that made it possible." :
          "Measured behavior, transparent denominators, and no borrowed confidence."}</p></div>
        <div className="policy-indicator"><ShieldCheck size={19} /><div>{signed ? "Signed ruleset" : "Policy sign-off required"}<small>{policies?.versions.find(p => p.id === policies.active_id)?.version || "Unsigned baseline preview"}</small></div></div>
      </div>
      {!signed && page !== "policy" && <div className="policy-banner"><ShieldCheck size={17} /><span>Pay is a draft computation until the ruleset is reviewed and signed. Correction commits are blocked.</span>
        <button onClick={() => setPage("policy")}>Review policy <ArrowUpRight size={15} /></button></div>}
      {notice && <div role={notice.error ? "alert" : "status"} className={`notice ${notice.error ? "error" : ""}`}>
        {notice.error ? <X size={17} /> : <ShieldCheck size={17} />}<span>{notice.text}</span>
        <button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={16} /></button></div>}
      {(page === "desk" || page === "pay") ? <>
        <section className="signal-strip" aria-label="Workforce summary">
          <div><span className="signal-label">IN THIS WORKSPACE</span><strong>{cards.length}<small>timecards</small></strong></div>
          <div><span className="signal-label">NEEDS A CLOSER LOOK</span><strong>{attention}<small>with exceptions</small></strong></div>
          <div><span className="signal-label">EVIDENCE TO RESOLVE</span><strong>{exceptions}<small>detected exceptions</small></strong></div>
          <div className="signal-visual"><span className="signal-label">CALCULATION COMPLETENESS</span>
            <div className="segmented-bar">{cards.map(c => <i key={c.id} title={`${c.employee.name}: ${c.pay_status}`} className={c.pay_status === "complete" ? "filled" : ""} />)}</div>
            <span className="muted">{complete} complete · {cards.length - complete} awaiting valid records</span></div>
        </section>
        <div className="workbench">
          <section className="queue">
            <div className="queue-title"><div><span className="eyebrow">{page === "pay" ? "PEOPLE & PERIODS" : "EXCEPTION INBOX"}</span><h2>{page === "pay" ? "Pay periods" : "Resolution queue"}<span>{visible.length}</span></h2></div><span className="live-label"><span className="status-dot online" />Engine computed</span></div>
            <div className="queue-tools"><label className="search"><Search size={16} /><input aria-label="Search workforce" placeholder="Find a person or team…" value={search} onChange={e => setSearch(e.target.value)} /></label>
              {page === "desk" && <select aria-label="Filter timecards" value={filter} onChange={e => setFilter(e.target.value)}>
                <option value="attention">Needs attention</option><option value="blocked">Incomplete records</option>
                <option value="verified">Verified</option><option value="committed">Committed</option><option value="all">All timecards</option>
              </select>}</div>
            <div className="queue-table-wrap"><table className="queue-table"><thead><tr><th>EMPLOYEE / PERIOD</th><th>STATUS</th><th className="numeric">GROSS PAY</th></tr></thead>
              <tbody>{visible.map(c => <tr key={c.id} className={selected === c.id ? "selected" : ""}>
                <td><button className="person-cell" onClick={() => setSelected(c.id)} aria-label={`Open ${c.employee.name} ${c.period_start}`}>
                  <span className={`avatar hue-${Number(c.employee.id.slice(1)) % 4}`}>{initials(c.employee.name)}</span>
                  <span><strong>{c.employee.name}</strong><small>{period(c.period_start)}</small><span className="row-team">{c.employee.department}</span></span></button></td>
                <td><span className={`badge ${c.workflow === "committed" ? "green" : c.pay_status === "incomplete" ? "red" : c.exceptions.length ? "amber" : "neutral"}`}>
                  {c.workflow === "committed" ? "Committed" : c.pay_status === "incomplete" ? "Incomplete" : c.exceptions.length ? `${c.exceptions.length} exceptions` : "Clear"}</span>
                  {c.workflow === "verified" && <small className="verified-note">Verified · approval pending</small>}</td>
                <td className="numeric">{c.total === null ? <span className="unknown">Awaiting records</span> : <strong>{currency(c.total)}</strong>}<small>{duration(c.work_minutes)} recorded</small></td>
              </tr>)}</tbody></table>
              {!visible.length && <div className="empty"><FileCheck2 /><h3>No matching timecards</h3><p>Change the filter or search to explore the workspace.</p></div>}
            </div><div className="queue-footer"><ShieldCheck size={13} /> No model-generated pay. No automatic commits.</div>
          </section>
          {detail ? <Workspace key={`${detail.card.id}-${page}`} detail={detail} user={user} run={run}
            page={page} busy={busy} onPolicy={() => setPage("policy")} /> :
            <section className="detail loading"><Sparkles size={22} /><p>{selected ? "Loading evidence and derivations…" : "Choose a timecard to explore."}</p></section>}
        </div>
      </> : page === "policy" ? <PolicyStudio data={policies} user={user} run={run} busy={busy} /> :
        page === "audit" ? <AuditLedger refresh={refresh} /> : <EvalScorecard refresh={refresh} />}
      <footer className="app-footer"><span>dayflow <span className="footer-dot">/</span> Workforce intelligence, verified.</span><span>simplified mock policy, not legal advice</span></footer>
    </main>
  </div>;
}

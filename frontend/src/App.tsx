import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, BookCheck, Gauge, LayoutDashboard, ListChecks, LogOut, ScrollText, Search, Wallet, X } from "lucide-react";
import { api, setSession, type CardRow, type Detail, type PolicyResponse, type User } from "./api";
import Workspace from "./Workspace";
import { AuditLedger, EvalScorecard, PolicyStudio } from "./Governance";
import Overview from "./Overview";
import { Skeleton } from "./motion";

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

export function Mark({ size = 22 }: { size?: number }) {
  return <svg className="mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <rect x="2" y="4" width="20" height="3" rx="1" fill="currentColor" opacity=".35" />
    <rect x="2" y="10.5" width="14" height="3" rx="1" fill="currentColor" opacity=".65" />
    <rect x="2" y="17" width="8" height="3" rx="1" fill="currentColor" />
    <circle cx="19" cy="18.5" r="2.5" fill="#6fb1f0" />
  </svg>;
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState("avery@dayflow.demo");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <main className="login">
    <section className="login-panel">
      <div className="wordmark light"><Mark size={26} />Dayflow</div>
      <div className="login-intro">
        <h1>Timecard exceptions, resolved with a proof attached.</h1>
        <ol className="login-steps">
          <li><b>01</b><div><strong>Detect</strong><span>Deterministic rules flag missed punches, overtime risk, schedule conflicts and policy breaches.</span></div></li>
          <li><b>02</b><div><strong>Verify</strong><span>The pay engine recomputes every proposed correction across the full period.</span></div></li>
          <li><b>03</b><div><strong>Approve</strong><span>A second reviewer commits. Each step lands in a hash-chained ledger.</span></div></li>
        </ol>
      </div>
      <p className="login-fine">Synthetic workforce of 30 people across two pay periods. The model never calculates pay or writes records.</p>
    </section>
    <section className="login-form">
      <h2>Welcome to Dayflow</h2>
      <p className="muted">Sign in with a demo account.</p>
      <form onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError("");
        try { const user = await api<User>("/login", "POST", { email, password }); setSession(user); onLogin(user); }
        catch (err) { setError(err instanceof Error ? err.message : "Sign-in failed"); }
        finally { setBusy(false); }
      }}>
        <label>Work email<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        {error && <div role="alert" className="error-box">{error}</div>}
        <button className="button primary wide" disabled={busy}>{busy ? "Signing in…" : "Enter workspace"}</button>
      </form>
      <div className="demo-access">
        <span className="label">Demo accounts</span>
        <div className="demo-buttons">{[
          ["avery", "Avery · reviewer"], ["taylor", "Taylor · independent approver"], ["e001", "Maya · employee"],
        ].map(([id, label]) => <button type="button" key={id} onClick={() => {
          setEmail(`${id}@dayflow.demo`); setPassword("Dayflow-demo-2026!");
        }}>{label}</button>)}</div>
        <small>Each is a separate account. Password <code>Dayflow-demo-2026!</code> · local demo only.</small>
      </div>
      <footer>simplified mock policy, not legal advice</footer>
    </section>
  </main>;
}

const titles: Record<string, string> = {
  overview: "Overview", desk: "Exception desk", pay: "Pay explorer", policy: "Policy studio",
  audit: "Audit ledger", evals: "Eval scorecard",
};
const subtitles: Record<string, string> = {
  overview: "",
  desk: "Timecards with detected exceptions, ordered for review. Corrections are proposed, recomputed and approved here.",
  pay: "Gross pay per period, line by line, with the clause and source record behind each amount.",
  policy: "The signed ruleset the engine runs on. Each parameter links back to its source clause.",
  audit: "Append-only record of sign-offs, proposals, verifications and commits.",
  evals: "Detection accuracy and release gates measured against independently labelled synthetic data.",
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [page, setPage] = useState("desk");
  const [cards, setCards] = useState<CardRow[]>([]);
  const [policies, setPolicies] = useState<PolicyResponse | null>(null);
  const [signed, setSigned] = useState(false);
  const [mode, setMode] = useState("off");
  const [llm, setLlm] = useState({ enabled: true, configured: false });
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
      setSession(result); setUser(result); setPage(result.role === "employee" ? "pay" : "overview");
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
      api<PolicyResponse>("/policies"), api<{ llm_mode: string; llm_enabled: boolean; llm_configured: boolean }>("/config"),
    ]).then(([data, policy, config]) => {
      if (!active) return;
      setCards(data.cards); setSigned(data.policy_signed); setPolicies(policy); setMode(config.llm_mode); setLlm({ enabled: config.llm_enabled, configured: config.llm_configured });
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
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const run: Run = useCallback(async (action, message) => {
    setBusy(true); setNotice(null);
    try { await action(); setRefresh(value => value + 1); setNotice({ text: message, error: false }); }
    catch (err) { setNotice({ text: err instanceof Error ? err.message : "The operation failed", error: true }); }
    finally { setBusy(false); }
  }, []);
  if (initializing) return <div className="loading-screen"><Mark />Opening your workspace…</div>;
  if (!user) return <Login onLogin={result => {
    setUser(result); setPage(result.role === "employee" ? "pay" : "overview"); setSelected("");
  }} />;
  const attention = cards.filter(c => c.exceptions.length > 0).length;
  const exceptions = cards.reduce((sum, c) => sum + c.exceptions.length, 0);
  const complete = cards.filter(c => c.pay_status === "complete").length;
  const committed = cards.filter(c => c.workflow === "committed").length;
  const visible = cards.filter(c =>
    `${c.employee.name} ${c.employee.department} ${c.id}`.toLowerCase().includes(search.toLowerCase()) &&
    (page === "pay" || filter === "all" || (filter === "attention" && c.exceptions.length > 0) ||
      (filter === "blocked" && c.pay_status === "incomplete") ||
      (filter === "verified" && c.workflow === "verified") || (filter === "committed" && c.workflow === "committed")));
  const icons: Record<string, React.ReactNode> = {
    overview: <LayoutDashboard size={16} />, desk: <ListChecks size={16} />, pay: <Wallet size={16} />,
    policy: <BookCheck size={16} />, audit: <ScrollText size={16} />, evals: <Gauge size={16} />,
  };
  const go = (target: string, cardId?: string) => { setPage(target); if (cardId) setSelected(cardId); };
  const nav: [string, string][] = [
    ...(user.role === "reviewer" ? [["overview", "Overview"], ["desk", "Exception desk"]] as [string, string][] : []),
    ["pay", "Pay explorer"], ["policy", "Policy studio"],
    ...(user.role === "reviewer" ? [["audit", "Audit ledger"], ["evals", "Eval scorecard"]] as [string, string][] : []),
  ];
  const activeVersion = policies?.versions.find(p => p.id === policies.active_id)?.version;
  return <div className="shell">
    <aside className="sidebar">
      <div className="wordmark"><Mark />Dayflow</div>
      <div className="org">Dayflow Collective<small>Synthetic data · 2 pay periods</small></div>
      <nav aria-label="Primary">{nav.map(([key, title]) => <button key={key} aria-label={title} className={page === key ? "active" : ""} onClick={() => setPage(key)}>
        {page === key && <motion.i layoutId="nav-pill" className="nav-pill" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
        <span className="nav-icon">{icons[key]}</span><span>{title}</span>{key === "desk" && <span aria-hidden="true" className="nav-count">{attention}</span>}
      </button>)}</nav>
      <div className="sidebar-bottom">
        <dl className="system-facts">
          <div><dt>Engine</dt><dd>{mode === "off" ? "Deterministic mode" : "AI assistance enabled"}</dd></div>
          {user.role === "reviewer" && <div><dt>AI assistant</dt><dd><label className="checkbox"><input type="checkbox" role="switch" aria-label="AI assistance" checked={llm.enabled && llm.configured}
            disabled={!llm.configured || busy} onChange={e => run(() => api("/llm", "POST", { enabled: e.target.checked }), e.target.checked ? "AI assistance on. Every output is still validated." : "AI off. Detection, derivations and verification continue without a model.")} />
            {llm.configured ? (llm.enabled ? "On" : "Off") : "Not configured"}</label></dd></div>}
          <div><dt>Ruleset</dt><dd className={signed ? "" : "warn"}>{activeVersion || "unsigned"}</dd></div>
        </dl>
        <div className="profile"><span className="avatar">{initials(user.name)}</span><div>{user.name}<small>{friendly(user.role)}</small></div>
          <button className="icon-button" aria-label="Sign out" onClick={() => run(async () => {
            await api("/logout", "POST"); setSession(null); setUser(null); setCards([]); setDetail(null);
          }, "Signed out")}><LogOut size={16} /></button></div>
      </div>
    </aside>
    <main className={`main ${busy ? "busy" : ""}`} aria-busy={busy}>
      {page !== "overview" && <section className="band">
        <div className="band-head">
          <div><h1>{titles[page]}</h1><p>{subtitles[page]}</p></div>
          <div className={`ruleset-chip ${signed ? "ok" : "warn"}`}><span>{signed ? "Signed ruleset" : "Policy sign-off required"}</span>
            <small>{activeVersion || "Unsigned baseline preview"}</small></div>
        </div>
        {(page === "desk" || page === "pay") && <div className="band-metrics" aria-label="Workforce summary">
          <div><span>Timecards</span><strong>{cards.length}</strong></div>
          <div><span>With exceptions</span><strong>{attention}</strong></div>
          <div><span>Open exceptions</span><strong>{exceptions}</strong></div>
          <div><span>Committed</span><strong>{committed}</strong></div>
          <div className="band-coverage"><span>Calculable gross pay</span>
            <div className="segmented-bar">{cards.map(c => <i key={c.id} title={`${c.employee.name}: ${c.pay_status}`} className={c.pay_status === "complete" ? "filled" : ""} />)}</div>
            <small>{complete} complete · {cards.length - complete} awaiting valid records</small></div>
        </div>}
      </section>}
      {!signed && page !== "policy" && <div className="policy-banner"><span>Pay is a draft computation until the ruleset is reviewed and signed. Correction commits are blocked.</span>
        <button onClick={() => setPage("policy")}>Review policy <ArrowRight size={14} /></button></div>}
      {notice && <div role={notice.error ? "alert" : "status"} className={`notice ${notice.error ? "error" : ""}`}>
        <span>{notice.text}</span>
        <button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={15} /></button></div>}
      <AnimatePresence mode="wait"><motion.div key={page} className="page-frame" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
      {page === "overview" ? <Overview cards={cards} policies={policies} signed={signed} user={user} run={run} busy={busy} refresh={refresh} go={go} />
      : (page === "desk" || page === "pay") ? <div className="workbench">
        <section className="queue">
          <div className="queue-title"><h2>{page === "pay" ? "Pay periods" : "Resolution queue"}<span className="count">{visible.length}</span></h2></div>
          <div className="queue-tools"><label className="search"><Search size={15} /><input aria-label="Search workforce" placeholder="Name, team or card ID" value={search} onChange={e => setSearch(e.target.value)} /></label>
            {page === "desk" && <select aria-label="Filter timecards" value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="attention">Needs attention</option><option value="blocked">Incomplete records</option>
              <option value="verified">Verified</option><option value="committed">Committed</option><option value="all">All timecards</option>
            </select>}</div>
          <div className="queue-table-wrap"><table className="queue-table"><thead><tr><th>Employee</th><th>Status</th><th className="numeric">Gross</th></tr></thead>
            <tbody>{visible.map(c => <tr key={c.id} className={selected === c.id ? "selected" : ""}>
              <td><button className="person-cell" onClick={() => setSelected(c.id)} aria-label={`Open ${c.employee.name} ${c.period_start}`}>
                <span className={`avatar hue-${Number(c.employee.id.slice(1)) % 4}`}>{initials(c.employee.name)}</span>
                <span><strong>{c.employee.name}</strong><small>{period(c.period_start)} · {c.employee.department}</small></span></button></td>
              <td><span className={`badge ${c.workflow === "committed" ? "green" : c.pay_status === "incomplete" ? "red" : c.exceptions.length ? "amber" : "neutral"}`}>
                {c.workflow === "committed" ? "Committed" : c.pay_status === "incomplete" ? "Incomplete" : c.exceptions.length ? `${c.exceptions.length} exceptions` : "Clear"}</span>
                {c.workflow === "verified" && <small className="verified-note">Verified · approval pending</small>}</td>
              <td className="numeric">{c.total === null ? <span className="unknown">Awaiting records</span> : <strong className="figure">{currency(c.total)}</strong>}<small>{duration(c.work_minutes)} recorded</small></td>
            </tr>)}</tbody></table>
            {!visible.length && <div className="empty"><h3>No matching timecards</h3><p>Change the filter or search term.</p></div>}
          </div>
        </section>
        {detail ? <Workspace key={`${detail.card.id}-${page}`} detail={detail} user={user} run={run}
          page={page} busy={busy} onPolicy={() => setPage("policy")} /> :
          <section className="detail loading">{selected ? <Skeleton lines={6} /> : <p>Choose a timecard to explore.</p>}</section>}
      </div> : page === "policy" ? <PolicyStudio data={policies} user={user} run={run} busy={busy} /> :
        page === "audit" ? <AuditLedger refresh={refresh} /> : <EvalScorecard refresh={refresh} />}
      </motion.div></AnimatePresence>
      <footer className="app-footer"><span>Dayflow · demo build</span><span>simplified mock policy, not legal advice</span></footer>
    </main>
  </div>;
}

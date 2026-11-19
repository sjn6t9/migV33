// Payments & receipts › Statements: find any account (agent, customer, staff, the office) by mobile, name or email,
// then print, download or email its statement. Each issued statement has a number and a QR code to check it.
import React from "react";
import { LuSearch, LuPrinter, LuFileText, LuFileSpreadsheet, LuMail, LuX, LuLandmark, LuUserRound, LuBriefcase, LuBadgeCheck, LuBan } from "react-icons/lu";
import { store, user, balanceOf } from "../store.js";
import { act, toast } from "../actions.js";
import { Empty, RoleBadges } from "../ui.jsx";
import { Statement } from "./Statement.jsx";
import { agentRows, accountRows, statementPdf, statementPdfBlob, statementPrint, statementXlsx, sdate, amt, balWord } from "../statement.js";
import { monthName } from "../receipt.js";

const way = (m, c) => { const x = String(c || "").replace(/\s*\(.*\)\s*$/, "") || String(m || "").split("·").pop().trim().replace(/\s*\(.*\)\s*$/, ""); return (x || "Cash").toUpperCase(); };
const KIND = { agent: ["Agent", LuBriefcase], payer: ["Customer", LuUserRound], staff: ["Staff", LuBadgeCheck], office: ["Office", LuLandmark] };

/** every account this person may see, with what it can be found by */
function accounts(can) {
  const S = store.S, out = [];
  if (can("office")) out.push({ kind: "office", ref: "office", name: "Main account", sub: "Office cash book", hay: "main account office cash book" });
  if (can("ledger")) for (const a of S.users.filter(x => x.role === "agent")) out.push({ kind: "agent", ref: a.id, name: a.agent?.business || a.name, sub: [a.name, a.agent?.phone, a.email].filter(Boolean).join(" · "), email: a.email, hay: [a.agent?.business, a.name, a.agent?.phone, a.phone, a.email].join(" ") });
  if (can("receipts")) for (const a of S.mr?.accounts || []) out.push({ kind: "payer", ref: a.id, name: a.name || a.passport || a.mobile || a.email, sub: [a.passport, a.mobile, a.email, a.agent].filter(Boolean).join(" · "), email: a.email, hay: [a.name, a.passport, a.mobile, a.email, a.agent].join(" ") });
  if (can("salary")) for (const x of S.users.filter(y => (y.role === "admin" || y.role === "staff"))) out.push({ kind: "staff", ref: x.id, role: x.role, name: x.name, sub: [x.role === "admin" ? "Admin" : "Staff", x.email].join(" · "), email: x.email, hay: [x.name, x.email, x.phone, "staff", x.role].join(" ") });
  return out;
}
function rowsOf(a) {
  const S = store.S;
  if (a.kind === "agent") return agentRows(S.ledger, a.ref).filter(r => !r.pending);
  if (a.kind === "payer") { const acc = S.mr.accounts.find(x => x.id === a.ref); return acc ? accountRows(acc, S.mr.charges || [], S.mr.receipts) : []; }
  if (a.kind === "staff") return (S.salary?.pays || []).filter(p => p.uid === a.ref && !p.void).map(p => ({ id: p.id, date: p.date, details: `Salary ${monthName(p.month)} (${p.no})`, rate: way(p.method, p.channel), debit: p.net, credit: p.paid }));
  const O = S.office || { entries: [], auto: [] };
  const who = m => { const l = (O.leaders || []).find(x => `Person · ${x.uid}` === m); return l ? l.name.toUpperCase() : way(m); };
  return [...O.entries.filter(e => (e.status || "accepted") === "accepted" && e.type !== "transfer"), ...O.auto].map(e => ({ id: e.id, date: e.date, details: e.desc, rate: who(e.method), debit: e.type === "in" ? e.amount : 0, credit: e.type === "out" ? e.amount : 0 }));
}
const VIEW = { office: { cash: true, heads: ["Money in", "Money out"] }, staff: { heads: ["Salary (net)", "Paid"], balText: b => (b > 0 ? "Still to pay" : b < 0 ? "Paid in advance" : "All paid") } };

export function StatementsAdmin({ can }) {
  const [q, setQ] = React.useState(""); const [sel, setSel] = React.useState(null);
  const all = accounts(can), s = q.trim().toLowerCase(), d = s.replace(/\D/g, "");
  const found = s ? all.filter(a => a.hay.toLowerCase().includes(s) || (d.length >= 4 && a.hay.replace(/\D/g, " ").includes(d))) : all.filter(a => a.kind === "office" || a.kind === "agent").slice(0, 8);
  const a = sel && all.find(x => x.kind === sel.kind && x.ref === sel.ref);
  return <>
    <div className="ec-head"><div><h2>Statements</h2><p className="muted small">Find an account by mobile number, name, email or staff name. Print it, download it or email it. Each statement gets a number and a QR code to check it.</p></div></div>
    <label className="ec-search st-find"><input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Mobile number, name, email or staff" aria-label="Find an account" autoFocus /><LuSearch /></label>
    <div className="st-results">{found.length ? found.slice(0, 30).map(x => { const [lab, I] = KIND[x.kind]; return <button key={x.kind + x.ref} className={`tc-row${a && a.kind === x.kind && a.ref === x.ref ? " on" : ""}`} onClick={() => setSel({ kind: x.kind, ref: x.ref })}>
      <span className="st-kind"><I /></span><span className="tc-main"><b data-notr>{x.name}{x.role && <RoleBadges role={x.role} size={14} />}</b><small data-notr>{x.sub}</small></span><span className="ec-badge">{lab}</span></button>; })
      : <p className="muted small tc-none">{`No account matches “${q}”.`}</p>}</div>
    {a && <div className="card stack mt14" id="stmt-view">
      <div className="row between"><h3 className="row6">{(() => { const I = KIND[a.kind][1]; return <I />; })()}<span data-notr>{a.name}</span>{a.role && <RoleBadges role={a.role} size={15} />}</h3><button className="btn sm" onClick={() => setSel(null)}><LuX /> Close</button></div>
      <Statement key={a.kind + a.ref} title={a.name} sub={a.sub} rows={rowsOf(a)} {...(VIEW[a.kind] || {})} tools={st => <IssueTools a={a} st={st} />} />
    </div>}
  </>;
}

/* issue the statement on the server (number + QR), then print / PDF / email it */
function IssueTools({ a, st }) {
  const [to, setTo] = React.useState(a.email || ""); const [busy, setBusy] = React.useState("");
  const issue = async () => {
    const r = await act("admin.statement", { op: "issue", kind: a.kind, ref: a.ref, from: st.from, to: st.to }, { quiet: true });
    if (!r?.statement) return null; const x = r.statement;
    return { id: x.id, no: x.no, at: x.at, title: x.title, sub: x.sub, kind: x.label, cash: x.cash, heads: x.heads, from: x.from, to: x.to,
      qrUrl: `${(window.__SITE__?.main || location.origin).replace(/\/$/, "")}/st/${x.token}`, calc: { rows: x.rows, debit: x.debit, credit: x.credit, balance: x.balance } };
  };
  const run = (k, f) => async () => { setBusy(k); try { const x = await issue(); if (x) await f(x); } catch (e) { toast(e.message || "Something went wrong."); } setBusy(""); };
  const mail = run("mail", async x => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) { toast("Enter the email address."); return; }
    const blob = await statementPdfBlob(x); const pdf = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
    await act("admin.statement", { op: "mail", id: x.id, pdf, to: to.trim() });
  });
  const none = !st.calc.rows.length;
  return <div className="st-issue">
    <button className="btn sm pri" disabled={none || !!busy} onClick={run("print", statementPrint)}><LuPrinter /> {busy === "print" ? "…" : "Print"}</button>
    <button className="btn sm pri" disabled={none || !!busy} onClick={run("pdf", statementPdf)}><LuFileText /> {busy === "pdf" ? "…" : "PDF"}</button>
    <button className="btn sm" disabled={none || !!busy} onClick={() => statementXlsx(st)}><LuFileSpreadsheet /> Excel</button>
    {a.kind !== "office" && <span className="st-mail"><input type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="Email address" aria-label="Send to email" /><button className="btn sm" disabled={none || !!busy} onClick={mail}><LuMail /> {busy === "mail" ? "Sending…" : "Send"}</button></span>}
  </div>;
}

/* public page: the QR code on a statement opens /st/<code> */
export function VerifyStatement({ token }) {
  const [st, setSt] = React.useState({ loading: true });
  React.useEffect(() => { let on = true; fetch(`/api/statement/${encodeURIComponent(token)}`).then(x => (x.ok ? x.json() : null)).then(j => on && setSt({ x: j?.statement || null })).catch(() => on && setSt({ error: true })); return () => { on = false; }; }, [token]);
  const x = st.x, b = x?.balance;
  const end = !x ? "" : x.cash ? "Balance" : x.kind === "staff" ? (b > 0 ? "Still to pay" : b < 0 ? "Paid in advance" : "All paid") : balWord(b);
  return <div className="verify-page mr-vpage">
    <div className="verify-top"><a className="verify-brand" href="/#home"><img src="/brand/logo-w160.webp?v=2" width="64" height="40" alt="" /> <span className="vb-name">MAM &amp; MAM OVERSEAS LTD.</span></a></div>
    <div className="card mr-vcard">
      {st.loading ? <p className="muted">Checking the statement…</p> : st.error ? <p>No connection to the server. Check your internet and try again.</p>
        : !x ? <><div className="verify-bad"><LuBan /> <span>Statement not found</span></div><p className="verify-note">This QR code does not match a statement of Mam &amp; Mam Overseas Ltd.</p></>
        : <>
          <div className="mr-valid"><LuBadgeCheck /> <span>{`Valid statement ${x.no}`}</span></div>
          <dl className="mr-vlist">
            <dt>Account</dt><dd data-notr>{x.title}</dd>
            <dt>Period</dt><dd>{`${x.from ? sdate(x.from) : "Start"} – ${sdate(x.to || x.at)}`}</dd>
            <dt>{x.heads?.[0] || (x.cash ? "Money in" : "Total debit")}</dt><dd>{`BDT ${amt(x.debit)}`}</dd>
            <dt>{x.heads?.[1] || (x.cash ? "Money out" : "Total credit")}</dt><dd>{`BDT ${amt(x.credit)}`}</dd>
            <dt>{end}</dt><dd><b>{`BDT ${amt(x.cash ? b : Math.abs(b))}`}</b></dd>
            <dt>Issued</dt><dd data-notr>{`${new Date(x.at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} by ${x.issuedBy}`}</dd>
          </dl>
          <div className="tbl st-tbl mt14"><table><thead><tr><th>DATE</th><th>Details</th><th>RATE</th><th className="r">{x.heads?.[0] || "Debit"}</th><th className="r">{x.heads?.[1] || "Credit"}</th><th className="r">Balance</th></tr></thead><tbody>
            {x.rows.map((r, i) => <tr key={i} className={r.opening ? "st-open" : ""}><td className="num nowrap">{sdate(r.date)}</td><td className="b">{r.details}</td><td className="st-rate">{r.rate}</td><td className="num r">{r.debit ? amt(r.debit) : ""}</td><td className="num r">{r.credit ? amt(r.credit) : ""}</td><td className="num r b">{amt(r.balance)}</td></tr>)}
          </tbody></table></div>
          <div className="mr-actions"><span className="grow" /><a className="btn" href="/#home">Visit Website</a></div>
        </>}
    </div>
    <p className="verify-foot">Recruiting Licence RL 1217 · {location.host}</p>
  </div>;
}

// Team chat: admin and staff IDs talk one-to-one or in groups (text, photo, voice). Online = active in the last minute.
import React, { useState, useEffect, useRef, useCallback } from "react";
import { LuX, LuArrowLeft, LuUsers, LuPlus, LuSearch, LuReply, LuTrash2, LuSettings2, LuLogOut, LuMessagesSquare, LuCheckCheck, LuCheck, LuMessageCircle, LuMaximize2, LuMinimize2 } from "react-icons/lu";
import { Composer, Thread as LiveThread, chatGet, chatPost } from "./LiveChat.jsx";
import { RoleBadges, IdName } from "./ui.jsx";
import { toast, confirmBox } from "./actions.js";
import { store } from "./store.js";
import { t } from "./i18n.js";

async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Something went wrong. Please try again."); return j;
}
const ago = iso => {
  if (!iso) return "Offline"; const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return `Last seen ${Math.max(1, Math.round(s / 60))} min ago`; if (s < 86400) return `Last seen ${Math.round(s / 3600)} h ago`;
  return `Last seen ${new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;
};
const hhmm = iso => new Date(iso).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const initials = n => String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
function Av({ p, size = 38, group }) {
  return <span className="tc-av" style={{ width: size, height: size }}>
    {group ? <LuUsers /> : p?.photo ? <img src={p.photo} alt="" /> : <b>{initials(p?.name)}</b>}
    {!group && <i className={`tc-dot${p?.online ? " on" : ""}`} aria-label={p?.online ? "Online" : "Offline"} />}
  </span>;
}

const canCustomers = me => me.role === "admin" || me.perms?.includes("chat");

/* Messages: a round button like WhatsApp's; opens a small window, or Full View (list + conversation side by side) */
export function TeamChatWidget({ me }) {
  const [open, setOpen] = useState(false); const [full, setFull] = useState(false);
  const [tab, setTab] = useState("team"); const [d, setD] = useState({ members: [], chats: [], unread: 0 });
  const [view, setView] = useState("list"); const [cur, setCur] = useState(null); const [q, setQ] = useState("");
  const [cust, setCust] = useState(null); const [csel, setCsel] = useState(null);
  const cus = canCustomers(me);
  // on the Live chat and Messages pages the round button would sit on the message box's send/mic button, so it steps aside there
  const onChatPage = /^#dashboard/.test(location.hash || "") && ["chat", "messages"].includes(store.ui.tab?.[me.role]);
  const [wide, setWide] = useState(() => window.innerWidth > 760);
  useEffect(() => { const f = () => setWide(window.innerWidth > 760); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  const two = full && wide; // list and conversation side by side
  const load = useCallback(() => api("/api/team").then(setD).catch(() => {}), []);
  const loadCust = useCallback(() => cus ? chatGet("/api/chat/inbox").then(j => setCust(j.chats)).catch(() => {}) : null, [cus]);
  useEffect(() => { load(); loadCust(); const iv = setInterval(() => { load(); loadCust(); }, open ? 5000 : 10000); return () => clearInterval(iv); }, [open, load, loadCust]);
  useEffect(() => { document.body.classList.toggle("tc-full-on", open && full); return () => document.body.classList.remove("tc-full-on"); }, [open, full]);
  const custUnread = (cust || []).reduce((t, c) => t + (c.unread || 0), 0), total = d.unread + custUnread;
  const people = d.members.filter(m => m.id !== me.id).sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
  const person = id => d.members.find(m => m.id === id);
  const dmWith = id => d.chats.find(c => c.kind === "dm" && c.other === id);
  const openDm = async id => { try { const r = await api("/api/team", { op: "dm", uid: id }); setCur(r.chat.id); setView("chat"); load(); } catch (e) { toast(e.message); } };
  const s = q.trim().toLowerCase(); const match = x => !s || String(x || "").toLowerCase().includes(s);
  const groups = d.chats.filter(c => c.kind === "group" && match(c.name));
  const close = () => { setOpen(false); setFull(false); };

  const teamList = <div className="chat-b tc-list">
    <div className="tc-sec"><span>Groups</span><button className="btn sm" onClick={() => setView("group")}><LuPlus /> New group</button></div>
    {groups.length ? groups.map(c => <button key={c.id} className={`tc-row${cur === c.id && view === "chat" ? " on" : ""}`} onClick={() => { setCur(c.id); setView("chat"); }}>
      <Av group /><span className="tc-main"><b>{c.name}</b><small>{c.lastText || `${c.members.length} members`}</small></span>{c.unread > 0 && <span className="count">{c.unread}</span>}</button>)
      : <p className="muted small tc-none">No groups yet.</p>}
    <div className="tc-sec"><span>Admin & staff</span></div>
    {people.filter(p => match(p.name) || match(p.title)).map(p => { const c = dmWith(p.id); return <button key={p.id} className={`tc-row${c && cur === c.id && view === "chat" ? " on" : ""}`} onClick={() => openDm(p.id)}>
      <Av p={p} /><span className="tc-main"><span className="tc-idn"><IdName name={p.name} idc={p.idc} compact title={false} />{!p.idc && <RoleBadges role={p.role} size={15} />}</span>
        <small className={p.online ? "tc-on" : ""}>{c?.lastText ? `${c.lastFrom === me.id ? "You: " : ""}${c.lastText}` : p.online ? "Online" : ago(p.seen)}</small></span>
      {c?.unread > 0 && <span className="count">{c.unread}</span>}</button>; })}
    {!people.length && <p className="muted small tc-none">No other admin or staff IDs yet. Create them in Staff &amp; permissions.</p>}
  </div>;
  const custList = <div className="chat-b tc-list">
    {cust === null ? <p className="muted small tc-none">Loading…</p> : cust.filter(c => match(c.name) || match(c.sub) || match(c.contact)).map(c => <button key={c.id} className={`tc-row${csel === c.id ? " on" : ""}`} onClick={() => setCsel(c.id)}>
      <span className={`inbox-av r-${c.role || "guest"}`}>{(c.name || "?").trim().charAt(0).toUpperCase()}</span>
      <span className="tc-main"><b>{c.name}</b><small>{c.last ? `${c.last.from === "agency" ? "You: " : ""}${c.last.text}` : c.sub}</small></span>
      {c.unread > 0 && <span className="count">{c.unread}</span>}</button>)}
    {cust && !cust.length && <p className="muted small tc-none">No chats yet. Agents, job seekers, employers and visitors write from the website.</p>}
  </div>;
  const teamRight = view === "chat" && cur ? <Thread key={cur} id={cur} me={me} person={person} members={d.members} full={two} onBack={() => { setView("list"); load(); }} onGone={() => { setView("list"); setCur(null); load(); }} />
    : view === "group" ? <GroupForm me={me} people={people} onBack={() => setView("list")} onDone={id => { setCur(id); setView("chat"); load(); }} /> : null;
  const custRight = csel ? <CustomerThread key={csel} id={csel} full={two} onBack={() => { setCsel(null); loadCust(); }} onGone={() => { setCsel(null); loadCust(); }} /> : null;
  const right = tab === "team" ? teamRight : custRight;

  return <>
    <button className={`fab team-fab${!open && onChatPage ? " tc-away" : ""}`} onClick={() => (open ? close() : setOpen(true))} aria-label={open ? "Close messages" : "Open messages"} aria-expanded={open} title="Messages">
      {open ? <LuX /> : <LuMessageCircle />}{!open && total > 0 && <span className="fab-badge">{total > 99 ? "99+" : total}</span>}
    </button>
    {open && <div className={`chat live team-chat${full ? " full" : ""}${right ? " has-right" : ""}`} role="dialog" aria-label="Messages">
      <div className="tc-top">
        <div className="chat-ht"><b>Messages</b><span className="small">{`${people.filter(p => p.online).length} online`}</span></div>
        <button className="chat-x" onClick={() => setFull(!full)} aria-label={full ? "Small window" : "Full view"} title={full ? "Small window" : "Full view"}>{full ? <LuMinimize2 /> : <LuMaximize2 />}</button>
        <button className="chat-x" onClick={close} aria-label="Close"><LuX /></button>
      </div>
      <div className="tc-body">
        <div className="tc-left">
          <div className="tc-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "team"} className={tab === "team" ? "on" : ""} onClick={() => setTab("team")}><LuUsers /> Team{d.unread > 0 && <span className="count">{d.unread}</span>}</button>
            {cus && <button role="tab" aria-selected={tab === "cust"} className={tab === "cust" ? "on" : ""} onClick={() => setTab("cust")}><LuMessagesSquare /> Customers{custUnread > 0 && <span className="count">{custUnread}</span>}</button>}
          </div>
          <div className="tc-search"><LuSearch /><input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder={tab === "team" ? "Search people and groups" : "Search name or mobile"} aria-label="Search" /></div>
          {tab === "team" ? teamList : custList}
        </div>
        <div className="tc-right">{right || <div className="chat-b center tc-empty"><LuMessageCircle /><p className="muted">{tab === "team" ? "Choose a person or a group." : "Choose a conversation."}</p></div>}</div>
      </div>
    </div>}
  </>;
}

/* a conversation with an agent, job seeker, employer or visitor (the website's live chat) */
function CustomerThread({ id, full, onBack, onGone }) {
  const [c, setC] = useState(null);
  const load = useCallback(() => chatGet(`/api/chat/thread?id=${encodeURIComponent(id)}`).then(j => setC(j.chat)).catch(e => { toast(e.message); onGone(); }), [id]);
  useEffect(() => { load(); const iv = setInterval(load, 4000); return () => clearInterval(iv); }, [load]);
  if (!c) return <div className="chat-b center"><p className="muted small">Loading…</p></div>;
  const send = async body => { const j = await chatPost({ op: "send", chatId: id, ...body }); setC(j.chat); };
  const del = mid => confirmBox("Delete this message for everyone?", async () => { try { const j = await chatPost({ op: "delete", chatId: id, mid }); setC(j.chat); } catch (e) { toast(e.message); } }, "Delete");
  return <>
    <div className="chat-h">
      {!full && <button className="chat-x tc-back" onClick={onBack} aria-label="Back"><LuArrowLeft /></button>}
      <span className={`inbox-av r-${c.role || "guest"}`}>{(c.name || "?").trim().charAt(0).toUpperCase()}</span>
      <div className="chat-ht"><b>{c.name}</b><span className="small">{c.sub}{c.contact ? ` · ${c.contact}` : ""}</span></div>
    </div>
    <LiveThread chat={c} side="agency" onSend={send} onDelete={del} canDelete={() => true} />
  </>;
}

function Thread({ id, me, person, members, full, onBack, onGone }) {
  const [c, setC] = useState(null); const [reply, setReply] = useState(null); const [info, setInfo] = useState(false);
  const box = useRef(null); const end = useRef(null); const count = useRef(0);
  const load = useCallback(() => api(`/api/team/thread?id=${encodeURIComponent(id)}`).then(r => setC(r.chat)).catch(e => { toast(e.message); onGone(); }), [id]);
  useEffect(() => { load(); const iv = setInterval(load, 3000); return () => clearInterval(iv); }, [load]);
  useEffect(() => { const b = box.current; if (!b || !c) return; const near = b.scrollHeight - b.scrollTop - b.clientHeight < 140; if (c.msgs.length !== count.current && (near || !count.current)) end.current?.scrollIntoView({ block: "end" }); count.current = c.msgs.length; }, [c?.msgs.length]);
  if (!c) return <div className="chat-b center"><p className="muted small">Loading…</p></div>;
  const other = c.kind === "dm" ? person(c.other) : null;
  const send = async b => { const r = await api("/api/team", { op: "send", chatId: c.id, ...b, replyTo: reply?.id }); setC(r.chat); setReply(null); end.current?.scrollIntoView({ block: "end" }); };
  const del = mid => confirmBox("Delete this message?", async () => { try { const r = await api("/api/team", { op: "delete", chatId: c.id, mid }); setC(r.chat); } catch (e) { toast(e.message); } }, "Delete");
  const preview = m => (m.deleted ? "Message deleted" : m.kind === "image" ? "📷 Photo" : m.kind === "voice" ? "🎤 Voice message" : m.text);
  const lastMine = [...c.msgs].reverse().find(m => m.from === me.id && m.kind !== "event");
  const seenBy = lastMine ? Object.entries(c.reads).filter(([u, at]) => u !== me.id && at >= lastMine.at).map(([u]) => u) : [];
  if (info) return <GroupInfo c={c} me={me} members={members} onBack={() => { setInfo(false); load(); }} onGone={onGone} />;
  return <>
    <div className="chat-h">
      {!full && <button className="chat-x tc-back" onClick={onBack} aria-label="Back"><LuArrowLeft /></button>}
      {c.kind === "dm" ? <Av p={other} size={34} /> : <Av group size={34} />}
      <div className="chat-ht"><b>{c.name}{other && <RoleBadges role={other.role} size={15} />}</b>
        <span className="small">{c.kind === "group" ? `${c.members.length} members` : other?.online ? "Online" : ago(other?.seen)}</span></div>
      {c.kind === "group" && <button className="chat-x" onClick={() => setInfo(true)} aria-label="Group settings" title="Group settings"><LuSettings2 /></button>}
    </div>
    <div className="chat-b" ref={box}>
      {!c.msgs.length && <p className="muted small center pad">No messages yet. Say hello!</p>}
      {c.msgs.map(m => {
        if (m.kind === "event") return <p key={m.id} className="tc-event">{m.text}</p>;
        const mine = m.from === me.id, who = person(m.from);
        return <div key={m.id} className={`msg ${mine ? "me" : "them"}`} id={`tm-${m.id}`}>
          {!mine && c.kind === "group" && <Av p={who || { name: m.name }} size={26} />}
          <div className="msg-col">
            {!mine && c.kind === "group" && <span className="msg-name">{m.name}<RoleBadges role={who?.role} size={12} /></span>}
            <div className={`bubble${m.deleted ? " deleted" : ""}`}>
              {m.reply && <button type="button" className="msg-quote" onClick={() => document.getElementById(`tm-${m.reply.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" })}><b>{m.reply.from === me.id ? "You" : m.reply.name}</b><span>{preview(m.reply)}</span></button>}
              {m.deleted ? <i>Message deleted</i> : <>
                {m.kind === "image" && m.file && <a href={m.file.url} target="_blank" rel="noopener noreferrer"><img className="msg-img" src={m.file.url} alt="Photo" loading="lazy" /></a>}
                {m.kind === "voice" && m.file && <audio className="msg-audio" controls preload="metadata" src={m.file.url} />}
                {m.text && <span className="msg-text">{m.text}</span>}</>}
            </div>
            <div className="msg-meta"><span>{hhmm(m.at)}</span>
              {m === lastMine && seenBy.length > 0 && <span className="tc-seen" title={`Seen by ${seenBy.map(u => person(u)?.name).join(", ")}`}><LuCheckCheck /> {c.kind === "dm" ? "Seen" : `Seen by ${seenBy.length}`}</span>}
              {m === lastMine && !seenBy.length && <span className="tc-seen sent"><LuCheck /> Sent</span>}
              {!m.deleted && <button type="button" onClick={() => setReply(m)} aria-label="Reply" title="Reply"><LuReply /></button>}
              {!m.deleted && (mine || me.role === "admin") && <button type="button" onClick={() => del(m.id)} aria-label="Delete" title="Delete"><LuTrash2 /></button>}</div>
          </div>
        </div>;
      })}
      <div ref={end} />
    </div>
    <Composer onSend={send} reply={reply ? { who: reply.from === me.id ? "You" : reply.name, text: preview(reply) } : null} onCancelReply={() => setReply(null)} />
  </>;
}

function Pick({ people, sel, setSel }) {
  return <div className="tc-pick">{people.map(p => <label key={p.id} className="tc-row tc-check">
    <input type="checkbox" checked={sel.includes(p.id)} onChange={() => setSel(sel.includes(p.id) ? sel.filter(x => x !== p.id) : [...sel, p.id])} />
    <Av p={p} size={32} /><span className="tc-main"><span className="tc-idn"><IdName name={p.name} idc={p.idc} compact title={false} />{!p.idc && <RoleBadges role={p.role} size={14} />}</span><small>{p.title || (p.role === "admin" ? "Admin" : "Staff")}</small></span></label>)}</div>;
}
function GroupForm({ me, people, onBack, onDone }) {
  const [name, setName] = useState(""); const [sel, setSel] = useState([]); const [busy, setBusy] = useState(false);
  const make = async e => { e.preventDefault(); setBusy(true); try { const r = await api("/api/team", { op: "group", name, members: sel }); toast(r.msg); onDone(r.chat.id); } catch (er) { toast(er.message); } setBusy(false); };
  return <>
    <div className="chat-h"><button className="chat-x tc-back" onClick={onBack} aria-label="Back"><LuArrowLeft /></button><div className="chat-ht"><b>New group</b><span className="small">{`${sel.length} selected`}</span></div></div>
    <form className="chat-b tc-form" onSubmit={make}>
      <label className="f">Group name<input type="text" value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="e.g. Visa processing team" required /></label>
      <b className="small">Members</b><Pick people={people} sel={sel} setSel={setSel} />
      <button className="btn pri" disabled={busy || name.trim().length < 2 || !sel.length}><LuUsers /> Create group</button>
    </form>
  </>;
}
function GroupInfo({ c, me, members, onBack, onGone }) {
  const boss = c.by === me.id || me.role === "admin";
  const [name, setName] = useState(c.name); const [sel, setSel] = useState(c.members.filter(i => i !== c.by));
  const others = members.filter(m => m.id !== c.by).sort((a, b) => a.name.localeCompare(b.name));
  const run = async (body, after) => { try { const r = await api("/api/team", { chatId: c.id, ...body }); if (r.msg) toast(r.msg); after ? after() : onBack(); } catch (e) { toast(e.message); } };
  return <>
    <div className="chat-h"><button className="chat-x tc-back" onClick={onBack} aria-label="Back"><LuArrowLeft /></button><div className="chat-ht"><b>{c.name}</b><span className="small">{`${c.members.length} members`}</span></div></div>
    <div className="chat-b tc-form">
      {boss ? <>
        <label className="f">Group name<input type="text" value={name} onChange={e => setName(e.target.value)} maxLength={60} /></label>
        {name.trim() !== c.name && <button className="btn sm" onClick={() => run({ op: "rename", name })}>Save name</button>}
        <b className="small">{`Members (made by ${members.find(m => m.id === c.by)?.name || "—"})`}</b>
        <Pick people={others} sel={sel} setSel={setSel} />
        <button className="btn pri" onClick={() => run({ op: "members", members: sel })}>Save members</button>
      </> : <><b className="small">Members</b><div className="tc-pick">{c.members.map(i => { const p = members.find(m => m.id === i); return <div key={i} className="tc-row"><Av p={p} size={32} /><span className="tc-main"><b>{p?.name || "—"}<RoleBadges role={p?.role} size={14} /></b><small>{p?.online ? "Online" : ago(p?.seen)}</small></span></div>; })}</div></>}
      <div className="row6 mt14">
        <button className="btn" onClick={() => confirmBox(`Leave "${c.name}"?`, () => run({ op: "leave" }, onGone), "Leave")}><LuLogOut /> Leave group</button>
        {boss && <button className="btn danger" onClick={() => confirmBox(`Delete the group "${c.name}" and all its messages?`, () => run({ op: "deleteGroup" }, onGone), "Delete group")}><LuTrash2 /> Delete group</button>}
      </div>
    </div>
  </>;
}

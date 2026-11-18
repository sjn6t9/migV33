// Live chat between the agency and job seekers, employers, agents and visitors.
// Visitors join with name + mobile; the secret chat key stays in this browser (localStorage).
// The agency always appears as "Mam & Mam Overseas Ltd." with the M&M logo.
import React, { useState, useEffect, useRef, useCallback } from "react";
import { LuX, LuSendHorizontal, LuImage, LuMic, LuSquare, LuReply, LuTrash2, LuCornerUpLeft, LuLoader, LuSearch, LuArrowLeft } from "react-icons/lu";
import { Logo } from "./ui.jsx";
import { store, me } from "./store.js";
import { toast, readUpload, confirmBox } from "./actions.js";
import { t } from "./i18n.js";

const KEY = "mam_chat_k";
const getKey = () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
const setKey = k => { try { k ? localStorage.setItem(KEY, k) : localStorage.removeItem(KEY); } catch { /* private mode */ } };

async function chatGet(path) {
  const r = await fetch(path, { credentials: "same-origin" }); const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "The chat could not be loaded.");
  return j;
}
async function chatPost(body) {
  const r = await fetch("/api/chat", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: "The server did not answer correctly. Try again." }));
  if (!r.ok || j.error) throw new Error(j.error || "Something went wrong.");
  return j;
}
const readAsDataUrl = blob => new Promise((ok, bad) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = () => bad(new Error("The recording could not be read.")); f.readAsDataURL(blob); });
const hhmm = iso => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); };

/* ---------- visitor / account side ---------- */
export function useChatUnread(active) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = async () => { try { const j = await chatGet(`/api/chat?k=${encodeURIComponent(getKey())}`); if (!stop) setN(j.chat?.unread || 0); } catch { /* offline */ } };
    tick(); const iv = setInterval(tick, 30000);
    return () => { stop = true; clearInterval(iv); };
  }, [active, store.S.session]);
  return [n, setN];
}

export function LiveChatPanel({ onClose, onRead }) {
  const u = me(); const account = u && !["admin", "staff"].includes(u.role);
  const [chat, setChat] = useState(undefined); // undefined = loading, null = not joined yet
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    try { const j = await chatGet(`/api/chat?k=${encodeURIComponent(getKey())}&seen=1`); setChat(j.chat); setErr(""); onRead?.(); }
    catch (e) { setErr(e.message); setChat(c => (c === undefined ? null : c)); }
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 4000); return () => clearInterval(iv); }, [load]);
  const send = async body => { const j = await chatPost({ op: "send", k: getKey(), ...body }); setChat(j.chat); };
  const del = mid => confirmBox("Delete this message?", async () => { try { const j = await chatPost({ op: "delete", k: getKey(), mid }); setChat(j.chat); } catch (e) { toast(e.message); } }, "Delete");
  return (
    <div className="chat live" role="dialog" aria-label="Chat with Mam & Mam Overseas Ltd.">
      <div className="chat-h"><Logo size={30} square /><div className="chat-ht"><b>Mam &amp; Mam Overseas Ltd.</b><span className="small">We reply as soon as we can</span></div>
        <button className="chat-x" onClick={onClose} aria-label="Close chat"><LuX /></button></div>
      {chat === undefined ? <div className="chat-b center"><LuLoader className="spin" /></div>
        : chat === null && !account ? <JoinForm onJoined={c => setChat(c)} err={err} />
          : <Thread chat={chat || { msgs: [] }} side="user" onSend={send} onDelete={del} empty={account ? t(`Assalamu Alaikum ${u.name}! Write to us here.`) : ""} />}
    </div>
  );
}

function JoinForm({ onJoined }) {
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    try { const j = await chatPost({ op: "join", name: d.name, phone: d.phone }); if (j.key) setKey(j.key); onJoined(j.chat); }
    catch (er) { toast(er.message); } finally { setBusy(false); }
  };
  return (
    <form className="chat-join" onSubmit={submit}>
      <Logo size={56} />
      <h4>Chat with us</h4>
      <p className="muted small">Write your name and mobile number to start the chat. Our team answers here.</p>
      <label className="f">Your name<input type="text" name="name" required maxLength={80} autoComplete="name" /></label>
      <label className="f">Mobile number<input type="tel" name="phone" required maxLength={30} placeholder="01XXXXXXXXX" autoComplete="tel" /></label>
      <button className="btn pri" type="submit" disabled={busy}>{busy ? "Starting…" : "Start chat"}</button>
    </form>
  );
}

/* ---------- conversation (shared by visitor and agency) ---------- */
function Thread({ chat, side, onSend, onDelete, empty, canDelete = m => m.from === side }) {
  const [reply, setReply] = useState(null);
  const end = useRef(null); const box = useRef(null); const count = useRef(0);
  useEffect(() => { // stay at the bottom when new messages arrive (unless the reader scrolled up)
    const b = box.current; if (!b) return;
    const near = b.scrollHeight - b.scrollTop - b.clientHeight < 140;
    if (chat.msgs.length !== count.current && (near || count.current === 0)) end.current?.scrollIntoView({ block: "end" });
    count.current = chat.msgs.length;
  }, [chat.msgs.length]);
  const byId = id => chat.msgs.find(m => m.id === id);
  const label = m => (m.from === "agency" ? "Mam & Mam Overseas Ltd." : side === "agency" ? chat.name || "Visitor" : "You");
  const preview = m => (m.deleted ? t("This message was deleted") : m.kind === "image" ? `📷 ${t("Photo")}` : m.kind === "voice" ? `🎤 ${t("Voice message")}` : m.text);
  return (
    <>
      <div className="chat-b" ref={box}>
        {!chat.msgs.length && <p className="muted small center pad">{empty || "No messages yet. Say hello!"}</p>}
        {chat.msgs.map(m => {
          const mine = m.from === side;
          return (
            <div key={m.id} className={`msg ${mine ? "me" : "them"}${m.from === "agency" ? " agency" : ""}`} id={`cm-${m.id}`}>
              {m.from === "agency" && !mine && <Logo size={26} square className="msg-av" />}
              <div className="msg-col">
                {!mine && <span className="msg-name">{label(m)}</span>}
                <div className={`bubble${m.deleted ? " deleted" : ""}`}>
                  {m.reply && <button type="button" className="msg-quote" onClick={() => document.getElementById(`cm-${m.reply.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" })}>
                    <b>{label(m.reply)}</b><span>{m.reply.deleted ? t("This message was deleted") : m.reply.kind === "image" ? `📷 ${t("Photo")}` : m.reply.kind === "voice" ? `🎤 ${t("Voice message")}` : m.reply.text}</span></button>}
                  {m.deleted ? <i>{t("This message was deleted")}</i> : <>
                    {m.kind === "image" && m.file && <a href={m.file.url} target="_blank" rel="noopener noreferrer"><img className="msg-img" src={m.file.url} alt={t("Photo")} loading="lazy" /></a>}
                    {m.kind === "voice" && m.file && <audio className="msg-audio" controls preload="metadata" src={m.file.url} />}
                    {m.text && <span className="msg-text">{m.text}</span>}
                  </>}
                </div>
                <div className="msg-meta">
                  <span>{hhmm(m.at)}{m.by ? ` · ${m.by}` : ""}</span>
                  {!m.deleted && <button type="button" onClick={() => setReply(m)} aria-label="Reply" title="Reply"><LuReply /></button>}
                  {!m.deleted && canDelete(m) && <button type="button" onClick={() => onDelete(m.id)} aria-label="Delete" title="Delete"><LuTrash2 /></button>}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <Composer onSend={async b => { await onSend({ ...b, replyTo: reply?.id }); setReply(null); end.current?.scrollIntoView({ block: "end" }); }}
        reply={reply && byId(reply.id) ? { who: label(reply), text: preview(reply) } : null} onCancelReply={() => setReply(null)} />
    </>
  );
}

function Composer({ onSend, reply, onCancelReply }) {
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState(null); const [secs, setSecs] = useState(0);
  const fileIn = useRef(null); const taRef = useRef(null);
  const go = async body => { setBusy(true); try { await onSend(body); return true; } catch (e) { toast(e.message); return false; } finally { setBusy(false); } };
  const submit = async e => { e?.preventDefault(); const v = text.trim(); if (!v || busy) return; if (await go({ text: v })) setText(""); taRef.current?.focus(); };
  const photo = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { const file = await readUpload(f, { imageMax: 1600, photo: true }); await go({ file, kind: "image", text: text.trim() }); setText(""); } catch (er) { toast(er.message); }
  };
  const startRec = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return toast("Voice messages are not supported in this browser.");
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast("Allow the microphone to record a voice message."); }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find(x => MediaRecorder.isTypeSupported?.(x)) || "";
    const mr = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined); const parts = [];
    mr.ondataavailable = ev => ev.data.size && parts.push(ev.data);
    mr.onstop = async () => {
      stream.getTracks().forEach(tr => tr.stop()); clearInterval(mr._iv);
      if (mr._cancel) return setRec(null);
      setRec(null);
      const blob = new Blob(parts, { type: mr.mimeType || type || "audio/webm" });
      if (blob.size < 1200) return toast("The recording is too short.");
      const ext = /mp4/.test(blob.type) ? "m4a" : /ogg/.test(blob.type) ? "ogg" : "webm";
      try { await go({ file: { name: `voice.${ext}`, type: blob.type, data: await readAsDataUrl(blob) }, kind: "voice" }); } catch (er) { toast(er.message); }
    };
    mr.start(); setSecs(0);
    mr._iv = setInterval(() => setSecs(s => { if (s + 1 >= 120) mr.state === "recording" && mr.stop(); return s + 1; }), 1000);
    setRec(mr);
  };
  const stopRec = cancel => { if (!rec) return; rec._cancel = cancel; if (rec.state === "recording") rec.stop(); };
  return (
    <div className="chat-compose">
      {reply && <div className="chat-replybar"><LuCornerUpLeft /><div><b>{reply.who}</b><span>{reply.text}</span></div><button type="button" onClick={onCancelReply} aria-label="Cancel reply"><LuX /></button></div>}
      {rec ? (
        <div className="chat-rec"><span className="rec-dot" /> {t("Recording…")} <b className="num">{String(Math.floor(secs / 60))}:{String(secs % 60).padStart(2, "0")}</b>
          <span className="grow" />
          <button type="button" className="btn sm" onClick={() => stopRec(true)}>{t("Cancel")}</button>
          <button type="button" className="btn sm pri" onClick={() => stopRec(false)}><LuSquare /> {t("Send")}</button></div>
      ) : (
        <form className="chat-f" onSubmit={submit}>
          <button type="button" className="chat-ic" onClick={() => fileIn.current.click()} disabled={busy} aria-label="Send a photo" title="Send a photo"><LuImage /></button>
          <input ref={fileIn} type="file" accept="image/*" hidden onChange={photo} />
          <textarea ref={taRef} rows={1} value={text} maxLength={2000} onChange={e => setText(e.target.value)} placeholder={t("Write a message…")} aria-label="Message"
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
          {text.trim()
            ? <button className="btn pri sm chat-send" type="submit" disabled={busy} aria-label="Send"><LuSendHorizontal /></button>
            : <button type="button" className="chat-ic mic" onClick={startRec} disabled={busy} aria-label="Record a voice message" title="Record a voice message"><LuMic /></button>}
        </form>
      )}
    </div>
  );
}

/* ---------- agency inbox (admin panel) ---------- */
export function useInboxUnread(active) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = async () => { try { const j = await chatGet("/api/chat/inbox"); if (!stop) setN(j.unread || 0); } catch { /* ignore */ } };
    tick(); const iv = setInterval(tick, 20000);
    return () => { stop = true; clearInterval(iv); };
  }, [active]);
  return n;
}

export function ChatInbox() {
  const [list, setList] = useState(null); const [sel, setSel] = useState(null); const [chat, setChat] = useState(null); const [q, setQ] = useState("");
  const loadList = useCallback(async () => { try { setList((await chatGet("/api/chat/inbox")).chats); } catch (e) { toast(e.message); } }, []);
  const loadThread = useCallback(async id => { try { setChat((await chatGet(`/api/chat/thread?id=${id}`)).chat); } catch (e) { toast(e.message); setSel(null); } }, []);
  useEffect(() => { loadList(); const iv = setInterval(loadList, 5000); return () => clearInterval(iv); }, [loadList]);
  useEffect(() => { if (!sel) { setChat(null); return; } loadThread(sel); const iv = setInterval(() => loadThread(sel), 4000); return () => clearInterval(iv); }, [sel, loadThread]);
  const send = async body => { const j = await chatPost({ op: "send", chatId: sel, ...body }); setChat(j.chat); loadList(); };
  const del = mid => confirmBox("Delete this message for everyone?", async () => { try { const j = await chatPost({ op: "delete", chatId: sel, mid }); setChat(j.chat); } catch (e) { toast(e.message); } }, "Delete");
  const delChat = () => confirmBox("Delete this whole conversation? Photos and voice messages in it are removed too.", async () => { try { await chatPost({ op: "deleteChat", chatId: sel }); setSel(null); loadList(); toast("Chat deleted."); } catch (e) { toast(e.message); } }, "Delete");
  const L = (list || []).filter(c => { const k = q.trim().toLowerCase(); return !k || [c.name, c.sub, c.contact].some(v => String(v || "").toLowerCase().includes(k)); });
  return <>
    <h2>Live chat</h2>
    <p className="muted small">Job seekers, employers, agents and website visitors write here. Your replies appear as “Mam & Mam Overseas Ltd.” with the M&amp;M logo.</p>
    <div className={`inbox card${sel ? " has-sel" : ""}`}>
      <div className="inbox-list">
        <label className="ec-search"><input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or mobile" /><LuSearch /></label>
        {list === null ? <p className="muted small pad">Loading…</p> : L.length ? L.map(c => (
          <button key={c.id} className={`inbox-row${sel === c.id ? " on" : ""}`} onClick={() => setSel(c.id)}>
            <span className={`inbox-av r-${c.role || "guest"}`}>{(c.name || "?").trim().charAt(0).toUpperCase()}</span>
            <span className="inbox-main"><b>{c.name}</b><span className="small muted">{c.sub}</span>
              {c.last && <span className="small inbox-last">{c.last.from === "agency" ? `${t("You")}: ` : ""}{c.last.text}</span>}</span>
            <span className="inbox-side"><span className="small muted">{c.at ? hhmm(c.at) : ""}</span>{c.unread > 0 && <span className="count">{c.unread}</span>}</span>
          </button>)) : <p className="muted small pad">No chats yet.</p>}
      </div>
      <div className="inbox-thread">
        {chat ? <>
          <div className="inbox-th"><button className="btn sm inbox-back" onClick={() => setSel(null)} aria-label="Back"><LuArrowLeft /></button>
            <div><b>{chat.name}</b><div className="small muted">{chat.sub}{chat.contact ? ` · ${chat.contact}` : ""}</div></div>
            <button className="btn sm danger" onClick={delChat} title="Delete conversation" aria-label="Delete conversation"><LuTrash2 /></button></div>
          <Thread chat={chat} side="agency" onSend={send} onDelete={del} canDelete={() => true} />
        </> : <div className="inbox-empty muted"><Logo size={56} /><p>Choose a conversation.</p></div>}
      </div>
    </div>
  </>;
}

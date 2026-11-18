import React, { useState, useRef, useEffect } from "react";
import { LuMessageCircle, LuX, LuSendHorizontal } from "react-icons/lu";
import { Logo } from "./ui.jsx";
import { FaWhatsapp } from "react-icons/fa6";
import { store, live, money, num, company, COUNTRIES , HOURLY } from "./store.js";
import { waLink } from "./pages/Public.jsx";

/* Rule-based help assistant. It answers from the site's own live data (jobs, salaries, countries, contact settings);
   no external AI service is used. Understands English and common Bangla keywords. */
const TOPICS = [
  ["jobs", "Open jobs", /job|vacan|circular|kaj|চাকরি|কাজ|জব/i],
  ["salary", "Salary", /salar|pay|wage|beton|বেতন|টাকা/i],
  ["countries", "Countries", /countr|desh|দেশ|saudi|malaysia|fiji|সৌদি|মালয়েশিয়া|ফিজি/i],
  ["process", "Process", /process|step|how|kivabe|প্রসেস|কিভাবে|ধাপ/i],
  ["clearance", "BMET clearance", /bmet|clearance|smart ?card|ক্লিয়ারেন্স|স্মার্ট/i],
  ["track", "Track my file", /track|status|ট্র্যাক|স্ট্যাটাস|অবস্থা/i],
  ["agent", "Become an agent", /agent|এজেন্ট/i],
  ["contact", "Contact", /contact|phone|address|office|যোগাযোগ|ফোন|ঠিকানা|অফিস/i]
];

function answer(topic) {
  const S = store.S; const L = live(); const s = S.settings;
  switch (topic) {
    case "jobs":
      if (!L.length) return { text: "There are no open job circulars right now. Please check again soon." };
      return { text: `We have ${L.length} open job circular${L.length > 1 ? "s" : ""}. Some of them:`, links: L.slice(0, 4).map(j => [`${j.title}, ${j.city} (${money(j.salaryMin, j.currency)}+)`, `#job-${j.id}`]).concat([["See all jobs", "#jobs"]]) };
    case "salary": {
      const by = {}; L.forEach(j => { (by[j.country] = by[j.country] || []).push(j); });
      const lines = Object.entries(by).map(([c, js]) => `${c}: ${money(Math.min(...js.map(j => j.salaryMin)), COUNTRIES[c])} – ${num(Math.max(...js.map(j => j.salaryMax)))} ${HOURLY.includes(c) ? "per hour" : "per month"}`);
      return { text: lines.length ? `Monthly salary ranges in our current circulars:\n${lines.join("\n")}\nEach job page also shows the approximate amount in BDT.` : "No open circulars right now, so there are no salary figures to show." };
    }
    case "countries": {
      const c = [...new Set(L.map(j => j.country))];
      return { text: c.length ? `We currently have jobs in: ${c.join(", ")}.` : "No open circulars right now.", links: [["Browse by country", "#jobs"]] };
    }
    case "process":
      return { text: "Our 8 steps: 1) Application 2) CV screening 3) Interview & trade test 4) GAMCA medical 5) Visa 6) BMET clearance & smart card 7) Flight booking 8) Departure. You get the salary, contract terms and total cost in writing before you sign.", links: [["Our services", "#services"]] };
    case "clearance":
      return { text: "We handle BMET registration, fingerprint and emigration clearance (smart card) before departure. Agents can file clearance applications online from the agent panel and follow every stage." };
    case "track":
      return { text: "Enter your passport number and mobile number on the Track Status page to see your application, clearance and ticket status.", links: [["Track my file", "#track"]] };
    case "agent":
      return { text: "Agents get an online panel to add workers, file BMET clearance, apply workers to jobs, request tickets and see their account statement. Registration is approved by our office.", action: "agent" };
    case "contact":
      return { text: [s.phone && `Phone: ${s.phone}`, s.email && `Email: ${s.email}`, s.address && `Office: ${s.address}`, `Hours: ${s.hours}`].filter(Boolean).join("\n") || "Contact details will be added soon.", links: [["Send us a message", "#contact"]], wa: !!s.whatsapp };
    default:
      return { text: "Sorry, I didn't understand that. Choose a topic below, or message our office.", wa: !!s.whatsapp, links: [["Contact page", "#contact"]] };
  }
}

export function ChatWidget({ onAgent }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([{ from: "bot", text: "Assalamu Alaikum! I'm the MAM & MAM help assistant. Ask about jobs, salary, countries, process or your file status. (বাংলায়ও লিখতে পারেন)" }]);
  const [q, setQ] = useState("");
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, open]);
  const s = store.S.settings;
  const ask = (label, topic) => setMsgs(m => [...m, { from: "me", text: label }, { from: "bot", ...answer(topic) }]);
  const send = e => {
    e.preventDefault(); const text = q.trim(); if (!text) return;
    const hit = TOPICS.find(([, , re]) => re.test(text));
    setMsgs(m => [...m, { from: "me", text }, { from: "bot", ...answer(hit ? hit[0] : "") }]); setQ("");
  };
  return (
    <>
      <div className="floaters">
        {s.whatsapp && <a className="fab wa" href={waLink(s.whatsapp, "Hello MAM & MAM Overseas, I have a question.")} target="_blank" rel="noopener noreferrer" aria-label="Chat on WhatsApp"><FaWhatsapp /></a>}
        <button className="fab" onClick={() => setOpen(o => !o)} aria-label={open ? "Close help assistant" : "Open help assistant"} aria-expanded={open}>{open ? <LuX /> : <LuMessageCircle />}</button>
      </div>
      {open && (
        <div className={`chat${s.whatsapp ? " withwa" : ""}`} role="dialog" aria-label="Help assistant">
          <div className="chat-h"><Logo size={30} square /> <b>MAM Assistant</b><span className="muted small">Automatic answers</span></div>
          <div className="chat-b">
            {msgs.map((m, i) => (
              <div key={i} className={`msg ${m.from}`}>
                <div className="bubble">{m.text}
                  {m.links && <div className="msg-links">{m.links.map(([t, h]) => <a key={h + t} href={h} onClick={() => setOpen(false)}>{t}</a>)}</div>}
                  {m.action === "agent" && <button className="btn sm pri mt8" onClick={() => { setOpen(false); onAgent(); }}>Register as an agent</button>}
                  {m.wa && <a className="btn sm wa mt8" href={waLink(s.whatsapp)} target="_blank" rel="noopener noreferrer"><FaWhatsapp /> WhatsApp the office</a>}
                </div>
              </div>
            ))}
            <div ref={end} />
          </div>
          <div className="chat-chips">{TOPICS.map(([k, label]) => <button key={k} className="chip-btn" onClick={() => ask(label, k)}>{label}</button>)}</div>
          <form className="chat-f" onSubmit={send}>
            <input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Type your question…" aria-label="Your question" />
            <button className="btn pri sm" type="submit" aria-label="Send"><LuSendHorizontal /></button>
          </form>
        </div>
      )}
    </>
  );
}

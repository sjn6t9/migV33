// Air tickets: search live fares (the agency's WFTT BD account, through our server) and send a request to the agency.
import React from "react";
import { LuPlaneTakeoff, LuPlaneLanding, LuSearch, LuArrowLeftRight, LuLuggage, LuClock, LuSend, LuX, LuRefreshCw, LuChevronDown, LuChevronUp } from "react-icons/lu";
import { store, fdate, bdtFmt } from "../store.js";
import { act, toast } from "../actions.js";
import { Field } from "./shared.jsx";

const hm = m => m ? `${Math.floor(m / 60)}h ${m % 60}m` : "";
const tm = s => String(s || "").split(" ")[1] || "";
const dy = s => { const d = String(s || "").split(" ")[0]; try { return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); } catch { return d; } };
const today = () => new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);

/* an airport box: type a city or code, pick from the list (DAC, JED, KUL …) */
function AirportInput({ label, value, onChange, id }) {
  const [opts, setOpts] = React.useState([]);
  React.useEffect(() => { const q = value.trim(); if (q.length < 2 || /\([A-Z]{3}\)$/.test(q)) return; const t = setTimeout(async () => { const r = await act("flight.airports", { q }, { quiet: true }); if (r?.list) setOpts(r.list); }, 300); return () => clearTimeout(t); }, [value]);
  return <Field label={label}><input type="text" list={id} value={value} placeholder="City or airport code" autoComplete="off" onChange={e => onChange(e.target.value)} />
    <datalist id={id}>{opts.map(a => <option key={a.code} value={`${a.city || a.name} (${a.code})`}>{a.name} · {a.country}</option>)}</datalist></Field>;
}

const longDay = s => { const d = String(s || "").split(" ")[0]; try { return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }); } catch { return d; } };
const PAX = { ADT: "Adult", CHD: "Child", INF: "Infant" };
const paxName = t => PAX[t] || (/^C\d/.test(t) ? "Child" : t);

/* View Detail: Flight Itinerary · Baggage · Fare Summary · Policy (the airline's refund / re-issue rules, from WFTT) */
function FlightDetail({ f, staff }) {
  const [tab, setTab] = React.useState("it"), [rules, setRules] = React.useState(null);
  React.useEffect(() => { if (tab !== "pol" || rules) return; if (!f.searchId) { setRules({ text: "" }); return; } act("flight.rules", { flightId: f.id, searchId: f.searchId }, { quiet: true }).then(r => setRules(r || { text: "" })); }, [tab]);
  const F = f.fare || {};
  return <div className="fl-det">
    <div className="fl-tabs" role="tablist">{[["it", "Flight Itinerary"], ["bag", "Baggage"], ["fare", "Fare Summary"], ["pol", "Policy"]].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === "it" && (f.legs || []).map((l, li) => <div key={li} className="fl-it">
      <div className="fl-it-h">{l.segs[0]?.from} → {l.segs[l.segs.length - 1]?.to}</div>
      {l.segs.map((g, i) => <React.Fragment key={i}>
        <div className="fl-seg">
          <div className="fl-seg-air">{f.logo && <img src={f.logo} alt="" width="30" height="30" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.visibility = "hidden"; }} />}<div><b data-notr>{g.flightNo || g.flight}</b><span>{g.airline}</span>{g.aircraft && <span className="muted">{g.aircraft}</span>}{g.operator && <span className="muted small">Operated by {g.operator}</span>}</div></div>
          <div className="fl-seg-pt"><b>{tm(g.dep)}</b><span>{longDay(g.dep)}</span><b className="fl-city">{g.fromCity}</b><span className="muted small">{g.fromAirport}{g.fromTerm ? ` · T${g.fromTerm}` : ""}</span></div>
          <div className="fl-seg-mid"><span className="fl-ns">Non-Stop</span><i /><span className="small">{hm(g.minutes)}</span></div>
          <div className="fl-seg-pt end"><b>{tm(g.arr)}</b><span>{longDay(g.arr)}</span><b className="fl-city">{g.toCity}</b><span className="muted small">{g.toAirport}{g.toTerm ? ` · T${g.toTerm}` : ""}</span></div>
          <div className="fl-seg-tags">{g.cabin && <span className="fl-tag">{g.cabin}</span>}{g.bag && <span className="fl-tag">{g.bag}</span>}<span className="small">{f.refundable ? "Refundable" : "Non-Refundable"}</span></div>
        </div>
        {i < l.segs.length - 1 && <div className="fl-lay">Change of plane at {g.toCity || g.to}: layover {hm(l.layovers?.[i] || 0) || "—"}</div>}
      </React.Fragment>)}
    </div>)}
    {tab === "bag" && <div className="tbl"><table><thead><tr><th>Flight</th><th>Route</th><th>Cabin</th><th>Check-in baggage</th><th>Cabin baggage</th></tr></thead><tbody>
      {(f.legs || []).flatMap(l => l.segs).map((g, i) => <tr key={i}><td data-notr>{g.flightNo || g.flight}</td><td>{g.from} → {g.to}</td><td>{g.cabin || f.cabin || "—"}</td><td><b>{g.bag || f.baggage || "As per airline"}</b></td><td className="muted">7 KG (usual; as per airline)</td></tr>)}
    </tbody></table></div>}
    {tab === "fare" && <div className="tbl"><table><thead><tr><th>Traveller</th><th className="num">Base fare</th><th className="num">Taxes</th><th className="num">Per person</th><th className="num">Total</th></tr></thead><tbody>
      {(F.perPax || []).map((p, i) => <tr key={i}><td>{paxName(p.type)} × {p.n}</td><td className="num">{bdtFmt(p.base)}</td><td className="num">{bdtFmt(p.tax)}</td><td className="num">{bdtFmt(p.total)}</td><td className="num">{bdtFmt(p.total * p.n)}</td></tr>)}
      {F.service > 0 && <tr><td colSpan={4}>Service charge</td><td className="num">{bdtFmt(F.service)}</td></tr>}
      <tr className="b"><td colSpan={4}>Total</td><td className="num">{bdtFmt(F.total || f.price)}</td></tr>
      {staff && f.net != null && <tr className="muted"><td colSpan={4}>Agency net (WFTT payable){f.discount ? ` · discount ${bdtFmt(f.discount)}` : ""}{f.ait ? ` · AIT ${bdtFmt(f.ait)}` : ""}</td><td className="num">{bdtFmt(f.net)}</td></tr>}
    </tbody></table></div>}
    {tab === "pol" && (!rules ? <p className="muted small">Loading the airline's rules…</p> : rules.text ? <div className="fl-pol">{rules.text}</div> : <p className="muted small">The airline's refund and re-issue rules are not available for this flight. Ask the agency before booking.</p>)}
  </div>;
}

export function FlightCard({ f, staff, onPick, picked, compact }) {
  const [open, setOpen] = React.useState(false);
  const rbd = f.rbd || f.legs?.[0]?.segs?.[0]?.rbd;
  return <div className={`fl-card${picked ? " on" : ""}${open ? " open" : ""}`}>
    <div className="fl-air">{f.logo ? <img src={f.logo} alt="" width="38" height="38" loading="lazy" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.visibility = "hidden"; }} /> : <LuPlaneTakeoff />}<div><b data-notr>{f.airline}</b>
      <span className="muted small">{f.seats ? `${f.seats} seat${f.seats > 1 ? "s" : ""} available` : f.cabin}</span><span className={`fl-ref${f.refundable ? " ok" : ""}`}>{f.refundable ? "Refundable" : "Non-Refundable"}</span></div></div>
    <div className="fl-legs">{(f.legs || []).map((l, i) => { const a = l.segs[0] || {}, b = l.segs[l.segs.length - 1] || {}; return <div key={i} className="fl-leg">
      <div className="fl-pt"><b>{tm(a.dep)}</b><span>{a.from}</span><em>{dy(a.dep)}</em></div>
      <div className="fl-mid"><span className="muted small"><LuClock /> {hm(l.minutes)}</span><i /><span className="small">{l.stops ? `${l.stops} stop${l.stops > 1 ? "s" : ""}${l.segs.length > 1 ? ` · ${l.segs.slice(0, -1).map(s => s.to).join(", ")}` : ""}` : "Non-stop"}</span></div>
      <div className="fl-pt"><b>{tm(b.arr)}</b><span>{b.to}</span><em>{dy(b.arr)}</em></div>
      {!compact && <div className="fl-nos muted small" data-notr>{l.segs.map(s => s.flightNo || s.flight).join(" · ")}</div>}</div>; })}
      {!compact && <div className="fl-chips">{rbd && <span className="fl-tag">RBD: {rbd}</span>}{f.baggage && <span className="fl-tag"><LuLuggage /> {f.baggage}</span>}
        <button type="button" className="btn sm link fl-more" aria-expanded={open} onClick={() => setOpen(x => !x)}>View Detail {open ? <LuChevronUp /> : <LuChevronDown />}</button></div>}
    </div>
    <div className="fl-buy">
      <b className="fl-price">{bdtFmt(f.price)}</b>
      <span className="muted small">Price for {f.pax || 1} traveller{(f.pax || 1) > 1 ? "s" : ""}</span>
      {staff && f.net != null && <span className="muted small" data-notr>Net ৳ {Number(f.net).toLocaleString("en-IN")} · Gross ৳ {Number(f.gross).toLocaleString("en-IN")}</span>}
      {onPick && <button type="button" className="btn pri sm" onClick={() => onPick(f)}><LuSend /> {picked ? "Selected" : "Request"}</button>}
    </div>
    {open && <FlightDetail f={f} staff={staff} />}
  </div>;
}

/* search form + results; onPick(flight, query) for the request */
export function FlightSearch({ staff, onPick, pickedId }) {
  const [q, setQ] = React.useState({ from: "Dhaka (DAC)", to: "", date: "", returnDate: "", round: false, adults: 1, children: 0, infants: 0, cabin: "economy" });
  const [busy, setBusy] = React.useState(false), [res, setRes] = React.useState(null), [sort, setSort] = React.useState("price"), [air, setAir] = React.useState("");
  const ready = store.S.flightsReady;
  const go = async e => {
    e?.preventDefault(); if (!q.to) return toast("Choose where to fly."); if (!q.date) return toast("Choose the travel date.");
    setBusy(true); setRes(null); const r = await act("flight.search", { ...q, returnDate: q.round ? q.returnDate : "" }, { quiet: true }); setBusy(false); if (r) setRes(r);
  };
  const list = (res?.list || []).filter(f => !air || f.airline === air).sort((a, b) => sort === "time" ? (a.legs[0]?.minutes || 0) - (b.legs[0]?.minutes || 0) : sort === "stops" ? (a.legs[0]?.stops || 0) - (b.legs[0]?.stops || 0) || a.price - b.price : a.price - b.price);
  const airlines = [...new Set((res?.list || []).map(f => f.airline))];
  if (!ready) return <div className="notice">Flight search opens when the agency connects its ticketing account. You can still send a request below.</div>;
  return <div className="card fl-search">
    <h3 className="bulk-h"><LuSearch /> Search flights</h3>
    <form className="fl-form" onSubmit={go} noValidate>
      <div className="fl-trip" role="radiogroup" aria-label="Trip type">{[[false, "One way"], [true, "Round trip"]].map(([v, l]) => <button key={l} type="button" role="radio" aria-checked={q.round === v} className={`btn sm ${q.round === v ? "dark" : "soft"}`} onClick={() => setQ({ ...q, round: v })}>{l}</button>)}</div>
      <div className="fl-route">
        <AirportInput id="fl-from" label="From" value={q.from} onChange={v => setQ({ ...q, from: v })} />
        <button type="button" className="btn sm soft fl-swap" aria-label="Swap" onClick={() => setQ({ ...q, from: q.to, to: q.from })}><LuArrowLeftRight /></button>
        <AirportInput id="fl-to" label="To" value={q.to} onChange={v => setQ({ ...q, to: v })} />
      </div>
      <div className="fgrid">
        <Field label="Travel date"><input type="date" min={today()} value={q.date} onChange={e => setQ({ ...q, date: e.target.value })} /></Field>
        {q.round && <Field label="Return date"><input type="date" min={q.date || today()} value={q.returnDate} onChange={e => setQ({ ...q, returnDate: e.target.value })} /></Field>}
        <Field label="Adults"><input type="number" min="1" max="9" value={q.adults} onChange={e => setQ({ ...q, adults: e.target.value })} /></Field>
        <Field label="Children (2–11)"><input type="number" min="0" max="8" value={q.children} onChange={e => setQ({ ...q, children: e.target.value })} /></Field>
        <Field label="Infants"><input type="number" min="0" max="4" value={q.infants} onChange={e => setQ({ ...q, infants: e.target.value })} /></Field>
        <Field label="Class"><select value={q.cabin} onChange={e => setQ({ ...q, cabin: e.target.value })}><option value="economy">Economy</option><option value="premium">Premium economy</option><option value="business">Business</option><option value="first">First</option></select></Field>
      </div>
      <button className="btn pri" disabled={busy}>{busy ? <><LuRefreshCw className="spin" /> Searching airlines…</> : <><LuSearch /> Search</>}</button>
    </form>
    {res && <div className="fl-res">
      <div className="row between wrap mt14"><b>{list.length} flight{list.length === 1 ? "" : "s"} · {res.q.from} → {res.q.to} · {fdate(res.q.date)}{res.q.returnDate ? ` – ${fdate(res.q.returnDate)}` : ""}</b>
        <div className="row tight wrap"><select className="auto slim" value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort"><option value="price">Cheapest</option><option value="time">Fastest</option><option value="stops">Fewest stops</option></select>
          {airlines.length > 1 && <select className="auto slim" value={air} onChange={e => setAir(e.target.value)} aria-label="Airline"><option value="">All airlines</option>{airlines.map(a => <option key={a}>{a}</option>)}</select>}</div></div>
      <p className="muted small">Fares for {res.q.adults} adult{res.q.adults > 1 ? "s" : ""}{res.q.children ? `, ${res.q.children} child` : ""}{res.q.infants ? `, ${res.q.infants} infant` : ""}, in BDT. Seats and fares change; the agency confirms the final fare when it books.</p>
      {list.length ? list.slice(0, 40).map(f => <FlightCard key={f.id} f={{ ...f, searchId: res.searchId }} staff={staff} picked={pickedId === f.id} onPick={onPick ? x => onPick({ ...x, searchId: res.searchId }, res.q) : null} />) : <p className="muted">No flights found for this date. Try another date or airport.</p>}
    </div>}
  </div>;
}

/* the request form after a flight is picked (agent: which worker; job seeker: name and passport) */
export function FlightRequest({ pick, q, onClose, onSend, children }) {
  const pax = [q.adults && `${q.adults} adult${q.adults > 1 ? "s" : ""}`, q.children && `${q.children} child`, q.infants && `${q.infants} infant`].filter(Boolean).join(", ");
  return <div className="card fl-req">
    <div className="row between"><h3 className="bulk-h"><LuPlaneLanding /> Request this flight</h3><button type="button" className="btn sm link" onClick={onClose} aria-label="Close"><LuX /></button></div>
    <FlightCard f={pick} compact />
    <form className="fgrid mt10" onSubmit={e => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.currentTarget)); onSend({ ...fd, from: q.from, to: q.to, prefDate: q.date, returnDate: q.returnDate || "", pax, flight: pick }); }}>
      {children}
      <Field label="Notes" full><input type="text" name="notes" maxLength={500} placeholder="Baggage, meal, seat or anything else" /></Field>
      <div className="full"><button className="btn pri" type="submit"><LuSend /> Send request</button> <span className="muted small">{pax} · {bdtFmt(pick.price)}</span></div>
    </form>
  </div>;
}

export const TicketFlight = ({ x }) => x.flight ? <div className="small"><b data-notr>{x.flight.airline}</b> · {(x.flight.legs || []).map(l => l.segs.map(s => s.flight).join("/")).join(" · ")}<div className="muted">{(x.flight.legs || []).map(l => `${l.segs[0]?.dep || ""} → ${l.segs[l.segs.length - 1]?.arr || ""}`).join(" | ")} · {bdtFmt(x.flight.price)}{x.pax ? ` · ${x.pax}` : ""}</div></div> : null;

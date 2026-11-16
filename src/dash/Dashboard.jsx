import React from "react";
import { LuLogIn } from "react-icons/lu";
import { me } from "../store.js";
import { openModal } from "../actions.js";
import { Empty } from "../ui.jsx";
import { Candidate } from "./Candidate.jsx";
import { Employer } from "./Employer.jsx";
import { Agent } from "./Agent.jsx";
import { Admin } from "./Admin.jsx";

export function Dashboard() {
  const u = me();
  if (!u) return <section className="sec"><div className="wrap"><Empty><p className="mb12">Sign in to open your dashboard.</p><button className="btn pri" onClick={() => openModal("auth", { mode: "login" })}><LuLogIn /> Sign in</button></Empty></div></section>;
  if (u.role === "candidate") return <Candidate u={u} />;
  if (u.role === "employer") return <Employer u={u} />;
  if (u.role === "agent") return <Agent u={u} />;
  return <Admin u={u} />; // admin and staff (staff see only permitted sections)
}

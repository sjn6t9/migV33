// Job post templates by profession: fills "Job description" and "Requirements" in the admin job form.
import { HOURS_PER_DAY } from "./constants.js";

export const PASSPORT_LINE = "Valid Passport with at least 3 years of validity.";

// country terms shown under "Benefits & Facilities"; {years} = contract length
const TERMS = {
  Fiji: [
    "Free accommodation provided by the company.",
    "Food expense: Self (to be managed by the candidate).",
    "Return air ticket will be provided by the company after completion of {years} years.",
    "Other terms and benefits as per Fiji Labor Law.",
  ],
};
// benefit checkboxes that match the terms above
export const TERM_BENEFITS = { Fiji: ["Accommodation", "Air ticket"] };

const B = "• ";
const lines = t => String(t || "").split(/\r?\n/).map(s => s.replace(/^\s*(?:[•\-*]|Bullet)\s*/i, "").trim()).filter(Boolean);
export const toLines = lines;

export function descriptionFor(tpl, country, years) {
  const y = Number(years) > 0 ? Number(years) : 3;
  const terms = (TERMS[country] || [`Other terms and benefits as per ${country} Labor Law.`]).map(s => s.replace("{years}", y));
  return [
    B + "Job Role & Responsibilities:",
    ...lines((tpl.duties || []).join("\n")).map(s => B + s),
    "",
    B + `Working Hours: ${HOURS_PER_DAY} Hours per day.`,
    "",
    B + "Benefits & Facilities:",
    ...terms.map(s => B + s),
  ].join("\n");
}

export function requirementsFor(tpl) {
  return lines((tpl.requirements || []).join("\n")).map(s => B + s).join("\n");
}

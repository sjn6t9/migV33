// Visiting card words in each language: company name, licence, digits, and Bangladeshi name parts.
// A name is written in the card's language only when every part of it is known here; otherwise the
// name the admin typed for that language (team member › Name in …) is used, or else the English name.
export const COMPANY = {
  en: ["MAM & MAM", "OVERSEAS LTD.", "MAM & MAM OVERSEAS LTD."],
  bn: ["মাম অ্যান্ড মাম", "ওভারসিজ লিমিটেড", "মাম অ্যান্ড মাম ওভারসিজ লিমিটেড"],
  ar: ["مام آند مام", "أوفرسيز المحدودة", "مام آند مام أوفرسيز المحدودة"],
  hi: ["मैम एंड मैम", "ओवरसीज़ लिमिटेड", "मैम एंड मैम ओवरसीज़ लिमिटेड"],
  fj: ["MAM & MAM", "OVERSEAS LTD.", "MAM & MAM OVERSEAS LTD."]
};
const DIGITS = { bn: "০১২৩৪৫৬৭৮৯", ar: "٠١٢٣٤٥٦٧٨٩", hi: "०१२३४५६७८९" };
const RL = { bn: "আরএল", ar: "آر إل", hi: "आरएल" };
const WORDS = { bn: { WhatsApp: "হোয়াটসঅ্যাপ", ID: "আইডি" }, ar: { WhatsApp: "واتساب", ID: "الرقم" }, hi: { WhatsApp: "व्हाट्सऐप", ID: "आईडी" } };
export const num = (s, lang) => (DIGITS[lang] ? String(s).replace(/\d/g, d => DIGITS[lang][d]) : String(s));
export const rl = (s, lang) => num(RL[lang] ? String(s).replace(/\bRL\b/g, RL[lang]) : s, lang);
export const word = (w, lang) => WORDS[lang]?.[w] || w;

// common name parts: [bn, hi, ar]
const P = {
  md: ["মোঃ", "मो.", "محمد"], mohammad: ["মোহাম্মদ", "मोहम्मद", "محمد"], muhammad: ["মুহাম্মদ", "मुहम्मद", "محمد"], mohammed: ["মোহাম্মদ", "मोहम्मद", "محمد"],
  al: ["আল", "अल", "ال"], abdul: ["আব্দুল", "अब्दुल", "عبد"], abdur: ["আব্দুর", "अब्दुर", "عبد"], abu: ["আবু", "अबू", "أبو"],
  mamun: ["মামুন", "मामून", "مأمون"], khan: ["খান", "ख़ान", "خان"], sujon: ["সুজন", "सुजन", "سوجون"], islam: ["ইসলাম", "इस्लाम", "إسلام"],
  masud: ["মাসুদ", "मसूद", "مسعود"], rana: ["রানা", "राना", "رانا"], rahman: ["রহমান", "रहमान", "رحمن"], rahim: ["রহিম", "रहीम", "رحيم"],
  karim: ["করিম", "करीम", "كريم"], hossain: ["হোসেন", "हुसैन", "حسين"], hussain: ["হুসাইন", "हुसैन", "حسين"], hasan: ["হাসান", "हसन", "حسن"], hassan: ["হাসান", "हसन", "حسن"],
  ahmed: ["আহমেদ", "अहमद", "أحمد"], ahmad: ["আহমদ", "अहमद", "أحمد"], ali: ["আলী", "अली", "علي"], uddin: ["উদ্দিন", "उद्दीन", "الدين"], miah: ["মিয়া", "मियाँ", "ميا"], mia: ["মিয়া", "मियाँ", "ميا"],
  alam: ["আলম", "आलम", "عالم"], kabir: ["কবির", "कबीर", "كبير"], kamal: ["কামাল", "कमाल", "كمال"], jamal: ["জামাল", "जमाल", "جمال"], sharif: ["শরীফ", "शरीफ़", "شريف"],
  shah: ["শাহ", "शाह", "شاه"], sheikh: ["শেখ", "शेख़", "شيخ"], sk: ["শেখ", "शेख़", "شيخ"], chowdhury: ["চৌধুরী", "चौधरी", "شودري"], sarkar: ["সরকার", "सरकार", "سركار"],
  akter: ["আক্তার", "अख़्तर", "أختر"], akhter: ["আখতার", "अख़्तर", "أختر"], begum: ["বেগম", "बेगम", "بيجوم"], khatun: ["খাতুন", "ख़ातून", "خاتون"], nur: ["নূর", "नूर", "نور"],
  amin: ["আমিন", "अमीन", "أمين"], aminul: ["আমিনুল", "अमीनुल", "أمين"], rafiq: ["রফিক", "रफ़ीक़", "رفيق"], rafiqul: ["রফিকুল", "रफ़ीक़ुल", "رفيق"], shafiqul: ["শফিকুল", "शफ़ीक़ुल", "شفيق"],
  saiful: ["সাইফুল", "सैफ़ुल", "سيف"], monir: ["মনির", "मुनीर", "منير"], monirul: ["মনিরুল", "मुनीरुल", "منير"], mostafa: ["মোস্তফা", "मुस्तफ़ा", "مصطفى"], mustafizur: ["মুস্তাফিজুর", "मुस्तफ़िज़ुर", "مستفيض"],
  jahid: ["জাহিদ", "ज़ाहिद", "زاهد"], zahid: ["জাহিদ", "ज़ाहिद", "زاهد"], habib: ["হাবিব", "हबीब", "حبيب"], imran: ["ইমরান", "इमरान", "عمران"], arif: ["আরিফ", "आरिफ़", "عارف"],
  faruk: ["ফারুক", "फ़ारूक़", "فاروق"], faruque: ["ফারুক", "फ़ारूक़", "فاروق"], salam: ["সালাম", "सलाम", "سلام"], helal: ["হেলাল", "हेलाल", "هلال"], billal: ["বিল্লাল", "बिलाल", "بلال"],
  sohel: ["সোহেল", "सोहेल", "سهيل"], shohel: ["সোহেল", "सोहेल", "سهيل"], rubel: ["রুবেল", "रुबेल", "روبل"], liton: ["লিটন", "लिटन", "ليتون"], shakil: ["শাকিল", "शकील", "شكيل"],
  milon: ["মিলন", "मिलन", "ميلون"], rasel: ["রাসেল", "रसेल", "راسل"], russel: ["রাসেল", "रसेल", "راسل"], nazmul: ["নাজমুল", "नज़्मुल", "نجم"], tanvir: ["তানভীর", "तनवीर", "تنوير"],
  mehedi: ["মেহেদী", "मेहदी", "مهدي"], munna: ["মুন্না", "मुन्ना", "منا"], rony: ["রনি", "रोनी", "روني"], shuvo: ["শুভ", "शुभो", "شوبو"], babu: ["বাবু", "बाबू", "بابو"],
  bhuiyan: ["ভূঁইয়া", "भुइयाँ", "بهويان"], bhuyan: ["ভূঁইয়া", "भुइयाँ", "بهويان"], talukder: ["তালুকদার", "तालुकदार", "تالوكدار"], mollah: ["মোল্লা", "मुल्ला", "ملا"], molla: ["মোল্লা", "मुल्ला", "ملا"]
};
const COL = { bn: 0, hi: 1, ar: 2 };
export function nameIn(m, lang) {
  if (lang === "en" || lang === "fj") return m.name || "";
  if (m.names?.[lang]) return m.names[lang];
  const parts = String(m.name || "").split(/\s+/).filter(Boolean).map(p => p.toLowerCase().replace(/[.,]/g, ""));
  if (!parts.length || COL[lang] == null || !parts.every(p => P[p])) return m.name || "";
  return parts.map(p => P[p][COL[lang]]).join(" ").replace(/ ال /g, " ال").replace(/^ال /, "ال");
}

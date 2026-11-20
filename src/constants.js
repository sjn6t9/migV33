// Shared by the browser app and the server: lists, labels and the content a new site starts with.
export const COUNTRIES = { "Saudi Arabia": "SAR", "Malaysia": "MYR", "Fiji": "FJD" };
/* countries where wages are quoted per hour (the rest per month) */
export const HOURLY = ["Fiji"];
/* hourly jobs: 8 working hours a day, one weekly day off (6 days a week ≈ 26 working days a month) */
export const HOURS_PER_DAY = 8, WORK_DAYS_PER_MONTH = 26;
export const HOURS_PER_MONTH = HOURS_PER_DAY * WORK_DAYS_PER_MONTH;
export const CATS = ["Construction", "Hospitality", "Driving & Transport", "Manufacturing", "Healthcare", "Security", "Cleaning & Facility", "Agriculture", "Retail & Sales", "IT & Office"];
export const TYPES = ["Contract", "Full-time", "Part-time"];
export const BENEFITS = ["Food", "Accommodation", "Transport", "Medical insurance", "Air ticket", "Overtime"];
export const STAGES = ["applied", "shortlisted", "interview", "medical", "visa", "clearance", "flight", "hired"];
export const CL_STAGES = ["pending", "received", "sent_bmet", "section", "ad", "dd", "director", "adg", "final", "approved"];
export const CARD_TYPES = ".pdf,.jpg,.jpeg,.png,.webp";
export const CL_DOCS = ["Passport copy", "Visa copy", "Medical report", "Employment contract", "Training certificate", "Photo"];
export const PAY_METHODS = ["bKash", "Nagad", "Rocket", "Bank transfer", "Cash at office"];
export const PAGES = ["home", "jobs", "services", "track", "about", "team", "blog", "contact"];
export const TEAM_DEPTS = ["Management", "Recruitment", "Visa & BMET processing", "Accounts", "Agent relations", "Customer support"];
export const STAFF_PERMS = [["users", "Accounts"], ["jobs", "Job moderation"], ["apps", "Applications"], ["clearance", "BMET clearance"], ["visa", "Visa applications"], ["tickets", "Air tickets"], ["ledger", "Agent accounts"], ["packages", "Employer packages"], ["receipts", "Money receipts"], ["office", "Main account"], ["salary", "Salary accounts"], ["content", "Website content"], ["blog", "Blog"], ["seo", "SEO"], ["settings", "Site settings"], ["messages", "Messages"], ["chat", "Live chat"]];
export const LABEL = {
  applied: "Applied", shortlisted: "Shortlisted", interview: "Interview", medical: "Medical", visa: "Visa processing", clearance: "BMET clearance", flight: "Flight booked", hired: "Hired", rejected: "Rejected",
  requested: "Requested", booked: "Booked", cancelled: "Cancelled",
  unverified: "Email not verified",
  received: "Received", sent_bmet: "Send to BMET", section: "Section", ad: "AD", dd: "DD", director: "Director", adg: "ADG", final: "Final Approval", approved: "Approved",
  submitted: "Submitted", docs: "Documents verified", finger: "Fingerprint done", processing: "Processing at BMET", issued: "Clearance issued", confirmed: "Confirmed",
  active: "Active", pending: "Pending", paused: "Paused", closed: "Closed", suspended: "Suspended", verified: "Verified", paid: "Paid"
};


/* Content a brand-new site starts with (no sample users or jobs) */
export const INITIAL = {
    settings: {
      phone: "", email: "", address: "", hours: "Saturday – Thursday, 10:00 AM – 6:00 PM",
      moderation: true, paidPosting: false, clearanceFee: 0, whatsapp: "", social: { facebook: "", youtube: "", linkedin: "", tiktok: "" },
      rates: { SAR: 32, MYR: 27, FJD: 54 }
    },
    seo: {
      home: { title: "Mam & Mam Overseas Ltd. | Licensed Recruiting Agency RL 1217", desc: "Find verified overseas jobs in Saudi Arabia, Malaysia and Fiji through Mam & Mam Overseas Ltd., licensed recruiting agency RL 1217." },
      jobs: { title: "Overseas Jobs | Mam & Mam Overseas Ltd.", desc: "Search overseas job circulars by country, salary, trade and experience." },
      services: { title: "Services | Mam & Mam Overseas Ltd.", desc: "Recruitment, document processing, medical and visa support for workers and employers." },
      about: { title: "About Us | Mam & Mam Overseas Ltd.", desc: "About Mam & Mam Overseas Ltd., recruiting licence RL 1217." },
      blog: { title: "Blog | Mam & Mam Overseas Ltd.", desc: "Guides for workers going abroad and employers hiring from Bangladesh." },
      contact: { title: "Contact | Mam & Mam Overseas Ltd.", desc: "Contact Mam & Mam Overseas Ltd." },
      track: { title: "Track Your File | Mam & Mam Overseas Ltd.", desc: "Check your application, BMET clearance and air ticket status with your passport and mobile number." },
      team: { title: "Expert Team | Mam & Mam Overseas Ltd.", desc: "Meet the Mam & Mam Overseas Ltd. team handling recruitment, visa and BMET clearance for workers and employers." }
    },
    packages: [
      { id: "pk1", name: "Basic", price: 0, posts: 1, featured: 0 },
      { id: "pk2", name: "Standard", price: 5000, posts: 5, featured: 1 },
      { id: "pk3", name: "Premium", price: 12000, posts: 15, featured: 5 }
    ],
    posts: [
      { id: "p1", title: "Before you fly: a document checklist for overseas workers", date: "2026-11-04T09:00:00.000Z", excerpt: "Passport validity, medical report, visa, emigration clearance and your employment contract: what to collect and check before departure.",
        body: "Going abroad for work starts with paperwork. Getting it right early saves weeks later.\n### Passport\nMake sure your passport is valid well beyond the length of your contract. Many employers ask for at least two years of remaining validity.\n### Medical check\nMost Gulf countries require a medical test at an approved centre. Your recruiting agency will tell you which centre to use and when.\n### Visa and contract\nRead your employment contract before you sign it. Check the salary, working hours, food and accommodation terms, and the contract length. Keep a copy.\n### Emigration clearance\nYou need government emigration clearance before departure. Your agency helps with registration and the required documents.\n### Keep copies\nScan every document and keep copies with your family in Bangladesh." },
      { id: "p2", title: "How to check that a job offer is genuine", date: "2026-10-22T09:00:00.000Z", excerpt: "Fake offers usually ask for money before any interview. Here is how to protect yourself.",
        body: "Every year workers lose money to fake job offers. A few checks protect you.\n### Check the licence\nA recruiting agency in Bangladesh must hold a government recruiting licence (RL number). Ask for it and verify it. Mam & Mam Overseas Ltd. holds licence RL 1217.\n### Never pay a stranger\nDo not send money to individuals or personal accounts for a visa. Pay only at the agency office and always take a receipt.\n### Ask for the employer details\nA real offer names the employer, the job, the salary in local currency and the contract length.\n### Visit the office\nCome to our office with your documents. We explain every step before you commit." },
      { id: "p3", title: "For employers: hiring skilled workers from Bangladesh", date: "2026-10-07T09:00:00.000Z", excerpt: "From demand letter to deployment: how we source, test and process candidates for your company.",
        body: "We handle recruitment end to end so your HR team only interviews shortlisted people.\n### 1. Demand and job order\nShare the trades, numbers, salary and benefits. We prepare the job circular and start sourcing.\n### 2. Screening and trade test\nCandidates are screened on experience and documents. Trade tests can be arranged for skilled roles.\n### 3. Interview\nInterview online or in person in Dhaka. Your selections move straight to medical and visa processing.\n### 4. Deployment\nWe complete visa, clearance and travel, and stay in touch after arrival." }
    ]
};

/* KSA visa › HR files: every field of a client file (Create Client File), in form order */
export const VISA_FIELDS = ["agentId", "remark", "gccSlipNo", "medicalCenter", "medicalSlipDate", "medicalResult", "mofaStatus", "visaStatus",
  "name", "fatherName", "motherName", "dob", "birthPlace", "prevNationality", "nationality", "sex", "marital", "sect", "religion", "address", "mofaId", "oldMofaId",
  "passport", "issuePlace", "issueDate", "expiryDate", "validity",
  "visaNo", "visaDate", "sponsorName", "sponsorId", "issuePlaceEn", "issuePlaceAr", "qualificationEn", "qualificationAr", "professionEn", "professionAr", "travelPurpose", "musaned", "wakala", "mofaProfession", "enjazProfessionAr", "enjazProfessionEn",
  "pcUrl", "pcRef", "licenseNo", "licenseType", "pcIssueDate", "pcOffice",
  "stayEn", "stayAr", "arrivalEn", "arrivalAr", "departureEn", "departureAr", "finger", "salary", "food", "experience", "note"];
export const VISA_DATES = ["medicalSlipDate", "dob", "issueDate", "expiryDate", "pcIssueDate"]; // the visa date is Hijri (e.g. 1446/06/30), so it stays text
/* the same check links the office uses every day */
export const VISA_LINKS = [["Visa Check", "https://visa.mofa.gov.sa/Enjaz/GetVisaInformation/Person"], ["Medical Check", "https://wafid.com/en/medical-status-search/"],
  ["Mofa Check", "https://visa.mofa.gov.sa/VisaPerson/GetApplicantData"], ["Medical Update", "https://visa.mofa.gov.sa/VisaPerson/CheckMedicalResult"],
  ["Tasheer Finger", "https://vc.tasheer.com"], ["Takamul", "https://svp-international.qiwa.sa"],
  ["Apostille Check", "https://mofa-servicedirectory.apostille.mygov.bd"], ["PDO/LMS Check", "https://training.oep.gov.bd/pdo-certificate"]];

// Banks and mobile banking (MFS) services in Bangladesh, for payment entries.
// Bank names follow Bangladesh Bank's scheduled-bank list (2026): state-owned, specialised, private (conventional
// and Islami) and foreign banks, then the main non-scheduled banks. "Other" lets staff type a name not in the list.
export const BANKS = [
  // state-owned commercial banks
  "Sonali Bank PLC", "Janata Bank PLC", "Agrani Bank PLC", "Rupali Bank PLC", "BASIC Bank Limited", "Bangladesh Development Bank PLC", "Sammilito Islami Bank PLC",
  // specialised banks
  "Bangladesh Krishi Bank", "Rajshahi Krishi Unnayan Bank", "Probashi Kallyan Bank",
  // private commercial banks
  "AB Bank PLC", "Bangladesh Commerce Bank Limited", "Bank Asia PLC", "Bengal Commercial Bank PLC", "BRAC Bank PLC", "Citizens Bank PLC", "City Bank PLC",
  "Community Bank Bangladesh PLC", "Dhaka Bank PLC", "Dutch-Bangla Bank PLC", "Eastern Bank PLC", "IFIC Bank PLC", "Jamuna Bank PLC", "Meghna Bank PLC",
  "Mercantile Bank PLC", "Midland Bank PLC", "Modhumoti Bank PLC", "Mutual Trust Bank PLC", "National Bank PLC", "National Credit & Commerce Bank PLC",
  "NRB Bank PLC", "NRBC Bank PLC", "ONE Bank PLC", "Padma Bank PLC", "Prime Bank PLC", "Pubali Bank PLC", "SBAC Bank PLC", "Shimanto Bank PLC",
  "Southeast Bank PLC", "The Premier Bank PLC", "Trust Bank PLC", "United Commercial Bank PLC", "Uttara Bank PLC",
  // Islami Shariah-based private banks
  "Islami Bank Bangladesh PLC", "Al-Arafah Islami Bank PLC", "Shahjalal Islami Bank PLC", "Standard Islami Bank PLC", "ICB Islamic Bank Limited",
  // foreign banks
  "Standard Chartered Bank", "HSBC", "Citibank, N.A.", "Commercial Bank of Ceylon PLC", "Habib Bank Limited", "National Bank of Pakistan", "State Bank of India", "Woori Bank",
  // non-scheduled banks
  "Ansar-VDP Unnayan Bank", "Karmasangsthan Bank", "Palli Sanchay Bank", "Grameen Bank",
];
export const MFS = ["bKash", "Nagad", "Rocket (Dutch-Bangla)", "Upay (UCB)", "Tap (Trust Axiata Pay)", "mCash (Islami Bank)", "SureCash", "OK Wallet (ONE Bank)", "MYCash (Mercantile Bank)", "Meghna Pay", "Islamic Wallet (Al-Arafah)"];
export const METHODS = ["Cash", "Bank transfer", "Mobile banking", "Cheque", "Card"];
export const channelsFor = m => (m === "Mobile banking" ? MFS : m === "Bank transfer" || m === "Cheque" ? BANKS : null);

const CFG = {
  MIN_AGE_DAYS:      +process.env.FB_MIN_AGE_DAYS || 7,    // jobsheet potu ethana naal aprom
   MAX_AGE_DAYS:      +process.env.FB_MAX_AGE_DAYS || 0,    // 0 = no limit (all jobs older than MIN_AGE_DAYS)
  COOLDOWN_DAYS:     +process.env.FB_COOLDOWN_DAYS || 30,  // same customer ku thirumba call gap
  MAX_ATTEMPTS:      3,
  DELIVERY_GAP_DAYS: 1,  
};
const DAY = 24 * 60 * 60 * 1000;

// last 10 digits mattum
const normalizePhone = (p = "") => String(p).replace(/\D/g, "").slice(-10);

// "98765 43210", "+91-98765-43210" ellam match aagum
const phoneRegex = (digits) =>
  digits && digits.length === 10
    ? new RegExp(digits.split("").join("\\D*") + "\\D*$")
    : null;

// Job status → feedback scenario
const getScenario = (job) => {
  const st = job.device?.mobileStatus || "";
  if (job.isCancelled || st === "Cancelled") return "cancelled";
  if (st === "Delivered")        return "delivered";
  if (st === "Delivered NR/NA")  return "delivered_nrna";
  if (st === "Repaired")         return "repaired";
  return "pending";   // Received / Pending / vera edhuvaa irundhaalum
};

module.exports = { CFG, DAY, normalizePhone, phoneRegex, getScenario };  
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");

/* =====================================================================
   ROLES
   admin        → Super Admin (owner): all stores, everything
   gm           → all stores, VIEW-ONLY (flip GM_READ_ONLY below to give write access)
   storeManager → own store only, incl. Admin Operation (users / engineers)
   user         → own store only, job sheets + data operation
   engineer     → own store only, engineer dashboard
===================================================================== */
const GLOBAL_ROLES = ["admin", "gm"];
const GM_READ_ONLY = true;

// The user is re-checked against the DB on every request (so a deleted employee or a
// changed role takes effect immediately, not when the 1-day token expires), but cached
// for 60s so 100 users don't mean 100 extra DB reads per second.
const CACHE_TTL_MS = 60 * 1000;
const userCache = new Map();

const invalidateUser = (id) => { if (id) userCache.delete(String(id)); };

async function loadUser(userId) {
  const key = String(userId);
  const hit = userCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.user;
  const user = await User.findById(key).select("name username role storeId").lean();
  userCache.set(key, { at: Date.now(), user: user || null });
  return user || null;
}

/* ---------- 1. Must be logged in. Sets req.user and req.storeId ---------- */
const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token, access denied" });
  }

  let decoded;
  try {
    decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }

  try {
    const user = await loadUser(decoded.userId);
    if (!user) return res.status(401).json({ message: "User no longer exists" });

    req.user = {
      userId: String(user._id),
      name: user.name,
      username: user.username,
      role: user.role,
      storeId: user.storeId ? String(user.storeId) : null,
    };

    if (GLOBAL_ROLES.includes(user.role)) {
      // admin / gm pick which store they're looking at via the X-Store-Id header
      // (sent by the frontend store switcher). No header / "all" = all stores.
      const h = req.headers["x-store-id"];
      req.storeId = h && h !== "all" && mongoose.isValidObjectId(h) ? String(h) : null;
    } else {
      // Everyone else is locked to their own store — the header is ignored.
      if (!req.user.storeId) {
        return res.status(403).json({ message: "Your account is not assigned to a store. Please contact admin." });
      }
      req.storeId = req.user.storeId;
    }
    next();
  } catch (err) {
    console.error("AUTH ERROR:", err.message);
    res.status(401).json({ message: "Invalid token" });
  }
};

/* ---------- 2. Role gate:  authorize("admin", "storeManager") ---------- */
const authorize = (...roles) => (req, res, next) => {
  if (roles.includes(req.user?.role)) return next();
  res.status(403).json({ message: "You do not have permission for this action" });
};

/* ---------- 3. GM is view-only ---------- */
const blockGmWrites = (req, res, next) => {
  if (GM_READ_ONLY && req.user?.role === "gm" && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return res.status(403).json({ message: "GM account is view-only" });
  }
  next();
};

/* ---------- 4. Query helpers ---------- */
// Spread into any find / countDocuments / aggregate $match:  { ...scope(req) }
// Returns {} for admin/gm in "all stores" view, otherwise { storeId: <ObjectId> }.
// (ObjectId — not a string — because aggregate pipelines do NOT auto-cast.)
const scope = (req) =>
  req.storeId ? { storeId: new mongoose.Types.ObjectId(req.storeId) } : {};

// For create operations: admin/gm must have picked one store.
const requireStore = (req, res) => {
  if (req.storeId) return true;
  res.status(400).json({ message: "Select a store first (store switcher) before doing this." });
  return false;
};

module.exports = protect; // keeps `require("./authMiddleware")` working as before
Object.assign(module.exports, {
  protect, authorize, blockGmWrites, scope, requireStore, invalidateUser, GLOBAL_ROLES, GM_READ_ONLY,
});
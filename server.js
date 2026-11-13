const dns = require("dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]);
const express = require("express");
const bcrypt = require("bcrypt");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const sendEmail = require("./utils/sendEmail");

const connectDB = require("./config/db");
const { protect, authorize, blockGmWrites, GLOBAL_ROLES } = require("./middleware/authMiddleware");
const { getStoreById, getDefaultStore } = require("./utils/storeHelpers");
const makeRoutes = require("./routes/makeRoutes");
const districtRoutes = require("./routes/districtRoutes");
const talukRoutes = require("./routes/talukRoutes");


if (!process.env.JWT_SECRET) {
  console.error("❌ JWT_SECRET is not set — refusing to start");
  process.exit(1);
}

const app = express();

// Render sits behind a proxy — needed so req.ip is the real client (login rate-limit uses it)
app.set("trust proxy", 1);

// ✅ NEW — stops Express's default ETag-based conditional caching. Without this, browsers
// were getting 304 "Not Modified" responses for /api/faults, /api/makes, /api/models,
// /api/drawers, etc. and reusing a STALE cached list — so newly added Make/Model/Fault/Drawer
// (from the sidebar popups OR the Job Sheet inline "Add New") never showed up until a hard
// refresh. Disabling etag globally forces every GET to always return fresh data.
app.disable("etag");

// ================= MIDDLEWARE =================
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://billingsoftware-frontend.vercel.app",
    "https://radnus-billingsoftware-frontend.vercel.app",
    "https://service.radnus.in",
    "https://radnus-billingsoftware-backend.onrender.com"
  ],
  credentials: true
}));

app.use(express.json());

// ================= DB CONNECT =================
connectDB();

app.get("/", (req, res) => {
  res.send("Backend API running 🚀");
});

// ================= LOGIN API =================
const User = require("./models/User");

// Simple brute-force guard: max 10 failed attempts per IP+username per 15 minutes.
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const loginFails = new Map(); // key -> { count, resetAt }
const failKey = (req, username) => `${req.ip}|${username.toLowerCase()}`;
const isLocked = (key) => {
  const f = loginFails.get(key);
  if (!f) return false;
  if (Date.now() > f.resetAt) { loginFails.delete(key); return false; }
  return f.count >= MAX_FAILS;
};
const noteFail = (key) => {
  const f = loginFails.get(key);
  if (!f || Date.now() > f.resetAt) loginFails.set(key, { count: 1, resetAt: Date.now() + FAIL_WINDOW_MS });
  else f.count += 1;
};
// used so "unknown user" takes as long as "wrong password" (no username enumeration by timing)
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

app.post("/api/login", async (req, res) => {
  try {
    // cast to string so {"username": {"$ne": null}} style payloads can't reach the query
    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");
    if (!username || !password) return res.status(400).json({ message: "Username and password are required" });

    const key = failKey(req, username);
    if (isLocked(key)) {
      return res.status(429).json({ message: "Too many failed attempts. Try again in 15 minutes." });
    }

    const user = await User.findOne({ username });
    const isMatch = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
    if (!user || !isMatch) {
      noteFail(key);
      return res.status(401).json({ message: "Invalid username or password" });
    }
    loginFails.delete(key);

    const isGlobal = GLOBAL_ROLES.includes(user.role);
    let store = null;
    if (!isGlobal) {
      store = await getStoreById(user.storeId);
      if (!store) return res.status(403).json({ message: "Your account is not assigned to a store. Please contact admin." });
      if (!store.isActive) return res.status(403).json({ message: "Your store is currently inactive. Please contact admin." });
    }
    const defaultStore = isGlobal ? await getDefaultStore() : null;

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      token,
      user: {
             userId: user._id,
        name: user.name,
        username: user.username,
        role: user.role,
        storeId: store ? store._id : null,
        storeName: store ? store.name : null,
        storeCode: store ? store.code : null,
        // admin / gm start in the original store; they can switch (or pick "All stores") in the UI
        defaultStoreId: defaultStore ? defaultStore._id : null,
      }
    });
  } catch (err) {
    console.log("LOGIN ERROR:", err);
    res.status(500).json({ message: "Login failed" });
  }
});

// ================= ROUTES =================
// Everything below requires a valid login. protect → req.user + req.storeId;
// blockGmWrites → GM accounts are view-only.
const secured = [protect, blockGmWrites];

app.use("/api/stores",     ...secured, require("./routes/storeRoutes"));
app.use("/api/jobsheets",  ...secured, require("./routes/jobSheetRoutes"));
app.use("/api/models",     ...secured, require("./routes/modelRoutes"));
app.use("/api/faults",     ...secured, require("./routes/faultRoutes"));
app.use("/api/drawers",    ...secured, require("./routes/drawerRoutes"));
app.use("/api/engineers",  ...secured, require("./routes/engineerRoutes"));
app.use("/api/salesreps",  ...secured, require("./routes/salesRepRoutes"));
app.use("/api/users",      ...secured, require("./routes/userRoutes"));
app.use("/api/dashboard",  ...secured, require("./routes/dashboardRoutes"));
app.use("/api/makes",      ...secured, makeRoutes);
app.use("/api/physical-conditions", ...secured, require("./routes/physicalConditionRoutes"));
app.use("/api/accessories",         ...secured, require("./routes/accessoryRoutes"));
app.use("/api/districts",  ...secured, districtRoutes);
app.use("/api/taluks",     ...secured, talukRoutes);
app.use("/api/spares",     ...secured, require("./routes/Spareroutes"));
// aiRoutes already does its own JWT + admin-only check
app.use("/api/ai", require("./routes/aiRoutes"));

// ================= TEST EMAIL (was public — now admin only) =================
app.get("/test-email", protect, authorize("admin"), async (req, res) => {
  try {
    await sendEmail(
      "sarathadeviiayyappan@gmail.com",
      "Radnus Email Test",
      "Test email from Radnus Billing Software",
      null
    );
    res.send("✅ Email sent successfully");
  } catch (err) {
    console.error(err);
    res.send("❌ Email failed");
  }
});

// ================= SERVER =================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
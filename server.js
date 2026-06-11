const dns = require("dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]);
const express = require("express");
const bcrypt = require("bcrypt");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const sendEmail = require("./utils/sendEmail");

const connectDB = require("./config/db");
const makeRoutes = require("./routes/makeRoutes");

const app = express();

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

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Wrong password" });

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
        role: user.role
      }
    });
  } catch (err) {
    console.log("LOGIN ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

// ================= ROUTES =================
app.use("/api/jobsheets",  require("./routes/jobSheetRoutes"));
app.use("/api/models",     require("./routes/modelRoutes"));
app.use("/api/faults",     require("./routes/faultRoutes"));
app.use("/api/drawers",    require("./routes/drawerRoutes"));
app.use("/api/engineers",  require("./routes/engineerRoutes"));
app.use("/api/salesreps",  require("./routes/salesRepRoutes")); // ✅ ONE TIME ONLY
app.use("/api/users",      require("./routes/userRoutes"));
app.use("/api/dashboard",  require("./routes/dashboardRoutes"));
app.use("/api/makes",      makeRoutes);

// ================= TEST EMAIL =================
app.get("/test-email", async (req, res) => {
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
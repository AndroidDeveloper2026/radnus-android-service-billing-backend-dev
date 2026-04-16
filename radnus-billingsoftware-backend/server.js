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
    "https://service.radnus.in"
  ],
  credentials: true
}));

app.use(express.json());


// const fs = require("fs");
// const path = require("path");

// const uploadDir = path.join(__dirname, "uploads");

// // Create uploads folder if it doesn't exist
// if (!fs.existsSync(uploadDir)) {
//   fs.mkdirSync(uploadDir, { recursive: true });
// }

// ================= DB CONNECT =================
connectDB();

// ================= ADMIN USER =================
// const ADMIN_USER = {
//   username: "admin",
//   passwordHash: "$2b$10$OMQCuC9lptEFQQebGAzgY.H9FlqkxqIQ7XK/E5j1SBlD8RMOdozty"
// };

// ================= TEST ROUTE =================
app.get("/", (req, res) => {
  res.send("Backend API running 🚀");
});

// ================= LOGIN API =================
const User = require("./models/User");

// app.post("/api/login", async (req, res) => {


//   try {
//     const { username, password } = req.body;

//     // 🔥 ADMIN LOGIN (keep same)
//     if (username === ADMIN_USER.username) {
//       const isMatch = await bcrypt.compare(password, ADMIN_USER.passwordHash);

//       if (!isMatch) {
//         return res.status(401).json({ message: "Invalid credentials" });
//       }

//       const token = jwt.sign(
//         { username, role: "admin" },
//         process.env.JWT_SECRET,
//         { expiresIn: "1d" }
//       );

//       return res.json({
//         token,
//         user: {
//           username,
//           role: "admin"
//         }
//       });
//     }

//     // 🔥 USER LOGIN (NEW)
//     const user = await User.findOne({ username });

//     if (!user) {
//       return res.status(401).json({ message: "User not found" });
//     }

//     const isMatch = await bcrypt.compare(password, user.password);

//     if (!isMatch) {
//       return res.status(401).json({ message: "Wrong password" });
//     }

//     const token = jwt.sign(
//       { userId: user._id, role: user.role },
//       process.env.JWT_SECRET,
//       { expiresIn: "1d" }
//     );

//     res.json({
//       token,
//       user: {
//         userId: user._id,
//         name: user.name,
//         username: user.username,
//         role: user.role
//       }
//     });

//   } catch (err) {
//   console.log("LOGIN ERROR:", err);
//   res.status(500).json({ message: err.message });
// }
// });


app.post("/api/login", async (req, res) => {
  try {

    const { username, password } = req.body;

    // DB ல user find பண்ணும்
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    // password compare
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Wrong password" });
    }

    // JWT token create
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

// ================= JOB SHEET ROUTES =================
// ✅ CORRECT
app.use("/api/jobsheets", require("./routes/jobSheetRoutes"));
// app.use("/uploads", express.static("uploads"));
app.use("/api/models", require("./routes/modelRoutes"));
app.use("/api/faults", require("./routes/faultRoutes"));
app.use("/api/drawers", require("./routes/drawerRoutes"));
app.use("/api/engineers", require("./routes/engineerRoutes"));
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/dashboard", require("./routes/dashboardRoutes"));

// ✅ MAKE ROUTE (only once)
app.use("/api/makes", makeRoutes);



app.get("/test-email", async (req, res) => {

  try {

    await sendEmail(
      "sarathadeviiayyappan@gmail.com",   // ← உங்கள் email இங்கு போடுங்கள்
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


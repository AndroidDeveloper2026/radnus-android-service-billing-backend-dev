const User = require("../models/User");

// Admin mattum
exports.adminOnly = (req, res, next) => {
  if (req.user?.role === "admin") return next();
  res.status(403).json({ message: "Admin only" });
};

// Feedback access: admin (or) user role + feedbackAccess != none
// DB la irundhu paakkurom, so admin toggle maathina udane velai seiyum (re-login venaam)
exports.feedbackAccess = async (req, res, next) => {
  try {
    if (req.user?.role === "admin") return next();
    const u = await User.findById(req.user.userId)
      .select("role feedbackAccess linkedRep name username");
    if (!u || u.role !== "user" || !u.feedbackAccess || u.feedbackAccess === "none") {
      return res.status(403).json({ message: "No feedback access" });
    }
    req.dbUser = u;
    next();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
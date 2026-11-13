const mongoose = require("mongoose");

// admin        = Super Admin (owner). All stores. Role name kept as "admin" so every
//                existing check (sidebar, AI page, reports) keeps working unchanged.
// gm           = oversight across stores. View-only by default (see GM_READ_ONLY in authMiddleware).
// storeManager = full "Admin Operation" access, but only inside their own store.
// user         = reception / day-to-day job sheets, own store only.
// engineer     = engineer dashboard, own store only.
const ROLES = ["admin", "gm", "storeManager", "user", "engineer"];

const userSchema = new mongoose.Schema(
  {
    name: String,
    username: { type: String, unique: true, trim: true },
    password: String,
    role: { type: String, default: "user", enum: ROLES },
    // null for admin / gm (they are not tied to one store)
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store", default: null },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
User.ROLES = ROLES;
module.exports = User;
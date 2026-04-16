const mongoose = require("mongoose");

const makeSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
});

module.exports = mongoose.model("Make", makeSchema);

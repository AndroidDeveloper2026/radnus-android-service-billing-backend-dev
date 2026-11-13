/**
 * One-time (idempotent) migration: single-store data  →  multi-store data.
 *
 *   node scripts/migrateToMultiStore.js --dry-run
 *   node scripts/migrateToMultiStore.js --name "Puducherry Main" --code PDY --city Puducherry
 *
 * What it does
 *  1. Creates the ORIGINAL store (job prefix stays "JS" so JS-810 etc. never change).
 *  2. Stamps storeId on every existing JobSheet, Engineer, Drawer, SalesRep and on
 *     every non-admin/gm User that doesn't have one yet.
 *  3. Drops the old unique indexes on engineers.name / salesreps.name (they would block
 *     two stores from having an engineer / rep with the same name) and builds the new ones.
 *  4. Seeds the job-number counter so the next job continues from the highest existing number.
 *
 * Safe to run more than once. TAKE AN ATLAS BACKUP / SNAPSHOT FIRST.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const Store = require("../models/Store");
const JobSheet = require("../models/JobSheet");
const User = require("../models/User");
const Engineer = require("../models/Engineer");
const Drawer = require("../models/Drawer");
const SalesRep = require("../models/SalesRep");
const Counter = require("../models/Counter");
const { maxExisting } = require("../utils/jobNumber");

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};
const DRY = process.argv.includes("--dry-run");

const NAME = arg("--name", "Main Store");
const CODE = arg("--code", "MAIN").toUpperCase();
const CITY = arg("--city", "");
const PREFIX = arg("--prefix", "JS").toUpperCase(); // keep "JS" for the original store

const missingStore = { $or: [{ storeId: { $exists: false } }, { storeId: null }] };

async function dropOldNameIndex(Model, label) {
  try {
    const idx = await Model.collection.indexes();
    const old = idx.find((i) => i.name === "name_1" && i.unique);
    if (!old) return console.log(`  ${label}: old unique name_1 index not present (ok)`);
    if (DRY) return console.log(`  ${label}: would drop old unique index name_1`);
    await Model.collection.dropIndex("name_1");
    console.log(`  ${label}: dropped old unique index name_1`);
  } catch (e) {
    if (e.codeName === "NamespaceNotFound" || e.code === 26) return console.log(`  ${label}: collection not created yet (ok)`);
    throw e;
  }
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected. ${DRY ? "DRY RUN — nothing will be written.\n" : "\n"}`);

  // 1. original store
  let store = await Store.findOne({ code: CODE });
  if (store) {
    console.log(`Store "${store.name}" (${store.code}) already exists — reusing it.`);
  } else if (DRY) {
    console.log(`Would create store "${NAME}" code=${CODE} prefix=${PREFIX} city=${CITY || "-"}`);
    store = { _id: new mongoose.Types.ObjectId(), name: NAME, code: CODE, jobPrefix: PREFIX };
  } else {
    store = await Store.create({ name: NAME, code: CODE, jobPrefix: PREFIX, city: CITY });
    console.log(`Created store "${store.name}" (${store.code}), job prefix ${store.jobPrefix}`);
  }

  // 2. stamp storeId
  const targets = [
    ["JobSheet", JobSheet, missingStore],
    ["Engineer", Engineer, missingStore],
    ["Drawer", Drawer, missingStore],
    ["SalesRep", SalesRep, missingStore],
    ["User (non admin/gm)", User, { $and: [missingStore, { role: { $nin: ["admin", "gm"] } }] }],
  ];
  console.log("\nStamping storeId:");
  for (const [label, Model, filter] of targets) {
    const n = await Model.countDocuments(filter);
    if (DRY || n === 0) { console.log(`  ${label}: ${n} document(s) ${DRY ? "would be updated" : "need updating"}`); continue; }
    const r = await Model.collection.updateMany(filter, { $set: { storeId: store._id } });
    console.log(`  ${label}: updated ${r.modifiedCount}`);
  }

  // 3. indexes
  console.log("\nIndexes:");
  await dropOldNameIndex(Engineer, "engineers");
  await dropOldNameIndex(SalesRep, "salesreps");
  if (!DRY) {
    for (const M of [Engineer, SalesRep, JobSheet, Drawer, Store, Counter]) await M.createIndexes();
    console.log("  new indexes created");
  }

  // 4. counter seed
  console.log("\nJob number counter:");
  const max = await maxExisting(store.jobPrefix);
  if (DRY) console.log(`  highest existing ${store.jobPrefix}-number is ${max}; counter would be seeded at ${max}`);
  else {
    await Counter.updateOne({ _id: `jobsheet:${store._id}` }, { $max: { seq: max } }, { upsert: true });
    console.log(`  seeded at ${max} → next job will be ${store.jobPrefix}-${String(max + 1).padStart(3, "0")}`);
  }

  console.log("\nDone ✅");
  await mongoose.disconnect();
})().catch((e) => { console.error("MIGRATION FAILED:", e); process.exit(1); });
// utils/storeHelpers.js
const Store = require("../models/Store");

const TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, stores: [] };

// Stores change rarely, so keep them in memory for 5 min instead of hitting Mongo on every request.
async function getStores(force = false) {
  if (!force && cache.stores.length && Date.now() - cache.at < TTL_MS) return cache.stores;
  const stores = await Store.find().sort({ createdAt: 1 }).lean();
  cache = { at: Date.now(), stores };
  return stores;
}

const clearStoreCache = () => { cache = { at: 0, stores: [] }; };

async function getStoreById(id) {
  if (!id) return null;
  const stores = await getStores();
  return stores.find((s) => String(s._id) === String(id)) || null;
}

// First-created store = the original store. Used as the default store for admin/gm after login.
async function getDefaultStore() {
  const stores = await getStores();
  return stores.find((s) => s.isActive) || stores[0] || null;
}

// User-typed text must never be dropped into a RegExp raw (typing "(" used to crash search with a 500).
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

module.exports = { getStores, clearStoreCache, getStoreById, getDefaultStore, escapeRegex };
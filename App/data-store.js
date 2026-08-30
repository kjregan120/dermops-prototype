/*
 * DermaOps local data store.
 *
 * Collections: customers, allergies, conditions, medications, users
 * (providers + support staff, distinguished by `role`), schedule (booked
 * visits — formerly "appointments"), skinSites, visitNotes, messageThreads,
 * messages. allergies/conditions/
 * medications are normalized per SPEC-02 (own id + customerId) rather than
 * nested on the customer record, so each entry can be edited/deleted
 * independently. Schemas and seed content live in /Data/*.json.
 *
 * Persistence model: on first load, seed JSON is fetched from /Data and
 * cached into localStorage under STORAGE_KEY. Every create/update/remove
 * call re-persists the whole store to localStorage, so this must be served
 * over http(s) (e.g. `npx serve .`) rather than opened via file://, since
 * browsers block fetch() of local files under the file:// protocol.
 *
 * STORAGE_KEY carries a version suffix — bump it whenever the collection
 * list or a record shape changes, so browsers with an old cached copy fall
 * back to fresh seed data instead of crashing on a missing collection.
 *
 * Clinical note: visitNotes.status === 'signed' records should be amended by
 * creating a new note with supersedesId pointing at the original, not by
 * mutating the signed note in place. update() does not enforce this — callers
 * are responsible for the amend-vs-edit decision.
 */
const DB = (() => {
  const COLLECTIONS = [
    'customers',
    'allergies',
    'conditions',
    'medications',
    'users',
    'schedule',
    'skinSites',
    'visitNotes',
    'messageThreads',
    'messages'
  ];
  const STORAGE_KEY = 'dermaops.db.v3';
  const DATA_BASE = '../Data/';

  let state = null;

  function now() {
    return new Date().toISOString();
  }

  function nextId(rows) {
    return rows.reduce((max, r) => Math.max(max, r.id), 0) + 1;
  }

  async function fetchSeeds() {
    const entries = await Promise.all(
      COLLECTIONS.map(async (name) => {
        const res = await fetch(`${DATA_BASE}${name}.json`);
        if (!res.ok) throw new Error(`Failed to load seed data for "${name}" (${res.status})`);
        return [name, await res.json()];
      })
    );
    return Object.fromEntries(entries);
  }

  function loadFromStorage() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function makeCollection(name) {
    return {
      list(filterFn) {
        const rows = state[name];
        return filterFn ? rows.filter(filterFn) : rows.slice();
      },
      get(id) {
        return state[name].find((r) => r.id === id) || null;
      },
      create(data) {
        const record = { ...data, id: nextId(state[name]), createdAt: now(), updatedAt: now() };
        state[name].push(record);
        persist();
        return record;
      },
      update(id, patch) {
        const row = state[name].find((r) => r.id === id);
        if (!row) throw new Error(`${name} record ${id} not found`);
        Object.assign(row, patch, { updatedAt: now() });
        persist();
        return row;
      },
      remove(id) {
        const idx = state[name].findIndex((r) => r.id === id);
        if (idx === -1) return false;
        state[name].splice(idx, 1);
        persist();
        return true;
      }
    };
  }

  const api = { ready: false };

  api.init = async function init() {
    state = loadFromStorage() || (await fetchSeeds());
    api.ready = true;
    return state;
  };

  api.reset = async function reset() {
    state = await fetchSeeds();
    persist();
    return state;
  };

  COLLECTIONS.forEach((name) => {
    api[name] = makeCollection(name);
  });

  // Relationship helpers used across the app's patient-centric views.
  api.allergiesForCustomer = (customerId) => api.allergies.list((r) => r.customerId === customerId);
  api.conditionsForCustomer = (customerId) => api.conditions.list((r) => r.customerId === customerId);
  api.medicationsForCustomer = (customerId) => api.medications.list((r) => r.customerId === customerId);
  api.scheduleForCustomer = (customerId) => api.schedule.list((r) => r.customerId === customerId);
  api.skinSitesForCustomer = (customerId) => api.skinSites.list((r) => r.customerId === customerId);
  api.visitNotesForCustomer = (customerId) => api.visitNotes.list((r) => r.customerId === customerId);
  api.threadsForCustomer = (customerId) => api.messageThreads.list((r) => r.customerId === customerId);
  api.messagesForThread = (threadId) =>
    api.messages.list((r) => r.threadId === threadId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  api.sendMessage = (threadId, { body, senderType, senderId, direction }) => {
    const message = api.messages.create({ threadId, direction, senderType, senderId, body });
    api.messageThreads.update(threadId, {});
    return message;
  };

  return api;
})();

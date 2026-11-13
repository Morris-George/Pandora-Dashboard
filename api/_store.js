// Small JSON storage helper.
// Production: a private Vercel Blob store (BLOB_READ_WRITE_TOKEN is added to the project by Vercel).
// Local tests only: set PANDORA_STORE_DIR to use a plain folder instead.
const fs = require('fs');
const path = require('path');

const dir = () => process.env.PANDORA_STORE_DIR || '';
const configured = () => !!(dir() || process.env.BLOB_READ_WRITE_TOKEN);

let blobLib = null;
const blob = () => blobLib || (blobLib = require('@vercel/blob'));

const safePath = p => {
  if (typeof p !== 'string' || !/^[a-z0-9_\-./]+$/i.test(p) || p.includes('..')) throw new Error('bad storage path');
  return p;
};

async function getJSON(p) {
  safePath(p);
  if (dir()) {
    try { return JSON.parse(await fs.promises.readFile(path.join(dir(), p), 'utf8')); } catch (_) { return null; }
  }
  const r = await blob().get(p, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  return JSON.parse(await new Response(r.stream).text());
}

// A short-lived copy for settings that change rarely (who may open which report, the home order). Every page click reads several of
// these, and each read is a trip to the storage service. A copy is kept for ttl ms inside the running function; saving or deleting
// the same path here drops it at once, and other running copies pick the change up within ttl (10 s by default).
const mem = new Map();
async function getJSONCached(p, ttl) {
  safePath(p);
  const now = Date.now(), hit = mem.get(p);
  if (hit && now - hit.at < (ttl || 10000)) return hit.v === undefined ? hit.pr : hit.v;
  const pr = getJSON(p).then(v => { const h = mem.get(p); if (h && h.pr === pr) mem.set(p, { at: Date.now(), v: v === null ? null : v }); return v; }, e => { const h = mem.get(p); if (h && h.pr === pr) mem.delete(p); throw e; });
  mem.set(p, { at: now, pr }); // while it loads, other readers share this one read
  return pr;
}
const forget = p => { mem.delete(p); };

async function putJSON(p, obj) {
  safePath(p); forget(p);
  const body = JSON.stringify(obj);
  if (dir()) {
    const f = path.join(dir(), p);
    await fs.promises.mkdir(path.dirname(f), { recursive: true });
    await fs.promises.writeFile(f, body);
    return;
  }
  await blob().put(p, body, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json'
  });
}

async function del(p) {
  safePath(p); forget(p);
  if (dir()) { try { await fs.promises.unlink(path.join(dir(), p)); } catch (_) {} return; }
  try { await blob().del(p); } catch (_) {}
}

// pathnames under a prefix
async function list(prefix) {
  safePath(prefix);
  if (dir()) {
    const out = [];
    const walk = async (rel) => {
      let entries = [];
      try { entries = await fs.promises.readdir(path.join(dir(), rel), { withFileTypes: true }); } catch (_) { return; }
      for (const e of entries) {
        const r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) await walk(r); else out.push(r);
      }
    };
    await walk('');
    return out.filter(x => x.startsWith(prefix));
  }
  const out = [];
  let cursor;
  do {
    const r = await blob().list({ prefix, cursor, limit: 1000 });
    r.blobs.forEach(b => out.push(b.pathname));
    cursor = r.hasMore ? r.cursor : null;
  } while (cursor);
  return out;
}

// like list(), with the time each file was last saved: [{ path, at (ms) }]
async function listMeta(prefix) {
  safePath(prefix);
  if (dir()) {
    const out = [];
    for (const f of await list(prefix)) { try { out.push({ path: f, at: (await fs.promises.stat(path.join(dir(), f))).mtimeMs }); } catch (_) {} }
    return out;
  }
  const out = [];
  let cursor;
  do {
    const r = await blob().list({ prefix, cursor, limit: 1000 });
    r.blobs.forEach(b => out.push({ path: b.pathname, at: new Date(b.uploadedAt).getTime() }));
    cursor = r.hasMore ? r.cursor : null;
  } while (cursor);
  return out;
}

// forget again once a save is finished, so a read that started while it was being saved cannot keep the older copy
const putJSONSafe = async (p, obj) => { try { return await putJSON(p, obj); } finally { forget(p); } };
const delSafe = async p => { try { return await del(p); } finally { forget(p); } };
module.exports = { configured, getJSON, getJSONCached, putJSON: putJSONSafe, del: delSafe, list, listMeta };

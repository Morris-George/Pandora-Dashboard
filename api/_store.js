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

async function putJSON(p, obj) {
  safePath(p);
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
  safePath(p);
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

module.exports = { configured, getJSON, putJSON, del, list };

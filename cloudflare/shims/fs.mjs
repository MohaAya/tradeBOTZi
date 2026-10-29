// In-memory stand-in for node:fs. Workers have no disk, and the original server kept its
// state in JSON files. The engine Durable Object loads these files from its storage on start
// (hydrate) and writes every change back (setPersistence), so state survives restarts.
const files = new Map();
const dirs = new Set(["/"]);
let persist = null;

const enc = new TextEncoder();
const dec = new TextDecoder();

function norm(p) {
  const parts = [];
  for (const seg of String(p).split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop(); else parts.push(seg);
  }
  return "/" + parts.join("/");
}

function enoent(op, p) {
  const err = new Error(`ENOENT: no such file or directory, ${op} '${p}'`);
  err.code = "ENOENT";
  return err;
}

function toText(value) {
  return typeof value === "string" ? value : dec.decode(value);
}

export function hydrate(entries) {
  for (const [path, text] of Object.entries(entries || {})) files.set(path, text);
}
export function setPersistence(fn) { persist = fn; }

export function existsSync(p) {
  const n = norm(p);
  return files.has(n) || dirs.has(n);
}
export function readFileSync(p, options) {
  const n = norm(p);
  if (!files.has(n)) throw enoent("open", p);
  const text = files.get(n);
  const encoding = typeof options === "string" ? options : options && options.encoding;
  return encoding ? text : enc.encode(text);
}
export function writeFileSync(p, data) {
  const n = norm(p);
  const text = toText(data);
  files.set(n, text);
  if (persist && !n.endsWith(".tmp")) persist(n, text);
}
export function appendFileSync(p, data) {
  const n = norm(p);
  writeFileSync(n, (files.get(n) || "") + toText(data));
}
export function renameSync(from, to) {
  const a = norm(from);
  const b = norm(to);
  if (!files.has(a)) throw enoent("rename", from);
  const text = files.get(a);
  files.delete(a);
  files.set(b, text);
  if (persist) {
    if (!a.endsWith(".tmp")) persist(a, null);
    if (!b.endsWith(".tmp")) persist(b, text);
  }
}
export function mkdirSync(p) { dirs.add(norm(p)); }
export function unlinkSync(p) {
  const n = norm(p);
  if (!files.delete(n)) throw enoent("unlink", p);
  if (persist) persist(n, null);
}
export function rmSync(p, options) {
  const n = norm(p);
  if (!files.delete(n) && !(options && options.force)) throw enoent("rm", p);
  if (persist) persist(n, null);
}
export function readdirSync(p) {
  const n = norm(p);
  if (n === "/proc") throw enoent("scandir", p);
  const prefix = n === "/" ? "/" : n + "/";
  const names = new Set();
  for (const f of files.keys()) {
    if (f.startsWith(prefix)) names.add(f.slice(prefix.length).split("/")[0]);
  }
  return [...names];
}
export function statSync(p) {
  const n = norm(p);
  if (files.has(n)) return { size: files.get(n).length, isFile: () => true, isDirectory: () => false, mtimeMs: Date.now() };
  if (dirs.has(n)) return { size: 0, isFile: () => false, isDirectory: () => true, mtimeMs: Date.now() };
  throw enoent("stat", p);
}

export default {
  hydrate, setPersistence, existsSync, readFileSync, writeFileSync, appendFileSync,
  renameSync, mkdirSync, unlinkSync, rmSync, readdirSync, statSync,
};

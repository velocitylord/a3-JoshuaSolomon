require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
const mime = require('mime');

const app = express();
const PORT = process.env.PORT || 3000;
const uri = process.env.MONGODB_URI;

const TAX_RATE = 0.08875;
const DEFAULT_TIP = 0.12;

const barbershopData = [
  { id: 1, type: 'Modern Haircut',          regularPrice: 30, minLength: 40 },
  { id: 2, type: 'Mens Haircut with Beard', regularPrice: 45, minLength: 55 },
  { id: 3, type: 'Kids Haircut',            regularPrice: 20, minLength: 40 },
  { id: 4, type: 'Shape Up',                regularPrice: 15, minLength: 15 },
  { id: 5, type: 'Shape up with Beard',     regularPrice: 20, minLength: 25 }
];

function findService(id) { return barbershopData.find(s => s.id === Number(id)); }
function computeRow(svc, tipInput) {
  const price = Number(svc.regularPrice);
  const tax   = +(price * TAX_RATE).toFixed(2);
  const tip   = tipInput == null || tipInput === '' ? +(price * DEFAULT_TIP).toFixed(2)
               : Number(tipInput) < 1 ? +(price * Number(tipInput)).toFixed(2)
               : +Number(tipInput).toFixed(2);
  const total = +(price + tax + tip).toFixed(2);
  return { service: svc.type, price, tax, tip, total, duration: svc.minLength };
}


const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true } // mongo client connect
});

let db, Users, Tickets;
async function startDb() {
  await client.connect();
  const dbNameFromUri = (() => {
    try { return (uri.split('.net/')[1] || 'a3').split('?')[0] || 'a3'; } catch { return 'a3'; }
  })();
  db = client.db(dbNameFromUri);
  Users = db.collection('users');
  Tickets = db.collection('tickets');
  await Users.createIndex({ username: 1 }, { unique: true });
  await Tickets.createIndex({ owner: 1 });
}

app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });

const AUTH_COOKIE = 'a3_user';
function hasAuth(req) { return Boolean(req.cookies[AUTH_COOKIE]); }
function requireAuth(req, res, next) { if (!hasAuth(req)) return res.redirect('/login.html'); next(); }
async function getUser(req) { const u = req.cookies[AUTH_COOKIE]; return u ? Users.findOne({ username: u }) : null; }

const pub = p => path.join(__dirname, 'public', p);
app.get('/login.html', (_req, res) => res.sendFile(pub('login.html')));
app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const u = (username || '').trim(), p = password || '';
    if (!u || !p) return res.status(400).json({ error: 'Username and password required' });
    const existing = await Users.findOne({ username: u });
    if (!existing) await Users.insertOne({ username: u, password: p });
    else if (existing.password !== p) return res.status(401).json({ error: 'Incorrect password' });
    res.cookie(AUTH_COOKIE, u, { httpOnly: true, sameSite: 'lax', maxAge: 14 * 24 * 60 * 60 * 1000 });
    res.json({ message: 'Logged in', username: u });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Login failed' }); }
});
app.post('/logout', (_req, res) => { res.clearCookie(AUTH_COOKIE); res.json({ message: 'Logged out' }); });

app.get('/', requireAuth, (_req, res) => res.redirect('/index.html'));
app.get('/index.html', requireAuth, (_req, res) => res.sendFile(pub('index.html')));
app.get('/app.js',      requireAuth, (_req, res) => res.sendFile(pub('app.js')));

app.get('/me', async (req, res) => {
  const u = await getUser(req);
  if (!u) return res.status(401).json({ username: null });
  res.json({ username: u.username });
});
app.get('/catalog', requireAuth, (_req, res) => res.json(barbershopData));
app.get('/data',    requireAuth, async (req, res) => {
  try { const rows = await Tickets.find({ owner: req.cookies[AUTH_COOKIE] }).sort({ _id: -1 }).toArray(); res.json(rows); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Failed to load data' }); }
});
app.post('/submit', requireAuth, async (req, res) => {
  try {
    const { serviceid, tip } = req.body || {};
    const svc = findService(serviceid);
    if (!svc) return res.status(400).json({ error: 'Unknown service' });
    const row = computeRow(svc, tip);
    const doc = { ...row, serviceid: Number(serviceid), owner: req.cookies[AUTH_COOKIE], createdAt: new Date() };
    const r = await Tickets.insertOne(doc);
    res.json({ ...doc, _id: r.insertedId });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Create failed' }); }
});
app.post('/update', requireAuth, async (req, res) => {
  try {
    const { id, tip } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const existing = await Tickets.findOne({ _id: new ObjectId(id), owner: req.cookies[AUTH_COOKIE] });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const svc = findService(existing.serviceid);
    const row = computeRow(svc, tip);
    await Tickets.updateOne({ _id: existing._id }, { $set: { tip: row.tip, tax: row.tax, total: row.total, updatedAt: new Date() } });
    res.json({ ...existing, ...row });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Update failed' }); }
});
app.post('/delete', requireAuth, async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const r = await Tickets.deleteOne({ _id: new ObjectId(id), owner: req.cookies[AUTH_COOKIE] });
    if (!r.deletedCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Delete failed' }); }
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) { const type = mime.getType(filePath); if (type) res.setHeader('Content-Type', type); }
}));

app.all('*', (req, res, next) => {
  if (['GET', 'POST'].includes(req.method)) return next();
  res.status(405).json({ error: 'Method not allowed' });
});

startDb()
  .then(() => app.listen(PORT, () => console.log(`A3 running on http://localhost:${PORT}`)))
  .catch(err => { console.error('Failed to start DB/server:', err); process.exit(1); });

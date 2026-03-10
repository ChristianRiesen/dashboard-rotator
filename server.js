const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const storage = require('./storage');
const TabManager = require('./tab-manager');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Ensure images directory exists
const IMAGES_DIR = path.join(__dirname, 'images');
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

// Multer config for image uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: IMAGES_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, storage.generateId() + ext);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i;
    cb(null, allowed.test(path.extname(file.originalname)));
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(IMAGES_DIR));

// Load config
let config = storage.load();

// Initialize tab manager
const tabManager = new TabManager();

// Broadcast to all WebSocket clients
function broadcast(message) {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

// Broadcast config to all clients
function broadcastConfig() {
  broadcast({ type: 'config', data: config });
}

// Broadcast status to all clients
function broadcastStatus() {
  broadcast({ type: 'status', data: tabManager.getStatus() });
}

// On tab manager status change, broadcast to UI
tabManager.on('status', broadcastStatus);

// Start 1-second status tick for progress bar updates
setInterval(() => {
  if (wss.clients.size > 0) {
    broadcastStatus();
  }
}, 1000);

// Helper: save config, sync tabs, broadcast
async function applyConfig() {
  storage.save(config);
  await tabManager.syncTabs(config);
  broadcastConfig();
  broadcastStatus();
}

// Helper: generate image viewer URL for tab-manager change detection
function imageViewerUrl(id, scaling, imageFile) {
  return `http://localhost:${PORT}/viewer/${id}?s=${encodeURIComponent(scaling)}&f=${encodeURIComponent(imageFile)}`;
}

// --- Image Viewer Route ---

app.get('/viewer/:id', (req, res) => {
  const entry = config.urls.find(u => u.id === req.params.id);
  if (!entry || entry.type !== 'image') {
    return res.status(404).send('Not found');
  }
  const scaling = entry.imageScaling || 'fill-vertical';
  const imgSrc = `/images/${encodeURIComponent(entry.imageFile)}`;
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0}
html,body{width:100%;height:100%;background:#000;overflow:hidden}
body{display:flex;justify-content:center;align-items:center}
img.fill-horizontal{width:100vw;height:auto}
img.fill-vertical{width:auto;height:100vh}
</style></head><body>
<img class="${scaling}" src="${imgSrc}">
</body></html>`);
});

// --- API Routes ---

// GET /api/config
app.get('/api/config', (req, res) => {
  res.json(config);
});

// GET /api/status
app.get('/api/status', (req, res) => {
  res.json(tabManager.getStatus());
});

// PUT /api/settings
app.put('/api/settings', async (req, res) => {
  const { defaultDuration } = req.body;
  if (typeof defaultDuration === 'number' && defaultDuration > 0) {
    config.settings.defaultDuration = defaultDuration;
  }
  await applyConfig();
  res.json(config.settings);
});

// POST /api/urls/image - create image entry
app.post('/api/urls/image', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Image file required' });
  }
  const { name, imageScaling } = req.body;
  const duration = req.body.duration ? parseInt(req.body.duration, 10) : null;
  const zoom = req.body.zoom ? parseInt(req.body.zoom, 10) : null;
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  const scaling = imageScaling || 'fill-vertical';
  const maxOrder = config.urls.reduce((max, u) => Math.max(max, u.order), -1);
  const id = storage.generateId();
  const entry = {
    id,
    type: 'image',
    url: imageViewerUrl(id, scaling, req.file.filename),
    name,
    imageFile: req.file.filename,
    imageScaling: scaling,
    duration: (duration && duration > 0) ? duration : null,
    zoom: (zoom && zoom > 0) ? zoom : null,
    reloadOnDisplay: true,
    enabled: true,
    order: maxOrder + 1
  };
  config.urls.push(entry);
  await applyConfig();
  res.status(201).json(entry);
});

// POST /api/urls/:id/update-image - update image entry (with optional file replacement)
app.post('/api/urls/:id/update-image', upload.single('image'), async (req, res) => {
  const entry = config.urls.find(u => u.id === req.params.id);
  if (!entry || entry.type !== 'image') {
    return res.status(404).json({ error: 'Image entry not found' });
  }
  const { name, imageScaling } = req.body;
  const duration = req.body.duration;
  const zoom = req.body.zoom;
  if (name !== undefined && name.trim()) entry.name = name.trim();
  if (duration !== undefined) {
    const d = parseInt(duration, 10);
    entry.duration = (d > 0) ? d : null;
  }
  if (zoom !== undefined) {
    const z = parseInt(zoom, 10);
    entry.zoom = (z > 0) ? z : null;
  }
  if (imageScaling !== undefined) entry.imageScaling = imageScaling;

  if (req.file) {
    // Delete old image file
    if (entry.imageFile) {
      const oldPath = path.join(IMAGES_DIR, entry.imageFile);
      fs.unlink(oldPath, () => {});
    }
    entry.imageFile = req.file.filename;
  }

  entry.url = imageViewerUrl(entry.id, entry.imageScaling, entry.imageFile);
  await applyConfig();
  res.json(entry);
});

// POST /api/urls
app.post('/api/urls', async (req, res) => {
  const { url, name, duration, zoom, reloadOnDisplay } = req.body;
  if (!url || !name) {
    return res.status(400).json({ error: 'url and name are required' });
  }
  const maxOrder = config.urls.reduce((max, u) => Math.max(max, u.order), -1);
  const entry = {
    id: storage.generateId(),
    url,
    name,
    duration: (typeof duration === 'number' && duration > 0) ? duration : null,
    zoom: (typeof zoom === 'number' && zoom > 0) ? zoom : null,
    reloadOnDisplay: !!reloadOnDisplay,
    enabled: true,
    order: maxOrder + 1
  };
  config.urls.push(entry);
  await applyConfig();
  res.status(201).json(entry);
});

// PUT /api/urls/reorder (must be before :id route)
app.put('/api/urls/reorder', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) {
    return res.status(400).json({ error: 'ids array required' });
  }
  const urlMap = new Map(config.urls.map(u => [u.id, u]));
  ids.forEach((id, index) => {
    const entry = urlMap.get(id);
    if (entry) entry.order = index;
  });
  // Any URLs not in the ids array keep their relative order after the reordered ones
  let nextOrder = ids.length;
  config.urls
    .filter(u => !ids.includes(u.id))
    .sort((a, b) => a.order - b.order)
    .forEach(u => u.order = nextOrder++);
  config.urls.sort((a, b) => a.order - b.order);
  await applyConfig();
  res.json({ ok: true });
});

// PUT /api/urls/:id
app.put('/api/urls/:id', async (req, res) => {
  const entry = config.urls.find(u => u.id === req.params.id);
  if (!entry) {
    return res.status(404).json({ error: 'URL not found' });
  }
  const { url, name, duration, zoom, reloadOnDisplay, enabled } = req.body;
  if (url !== undefined) entry.url = url;
  if (name !== undefined) entry.name = name;
  if (duration !== undefined) {
    entry.duration = (typeof duration === 'number' && duration > 0) ? duration : null;
  }
  if (zoom !== undefined) {
    entry.zoom = (typeof zoom === 'number' && zoom > 0) ? zoom : null;
  }
  if (reloadOnDisplay !== undefined) entry.reloadOnDisplay = !!reloadOnDisplay;
  if (enabled !== undefined) entry.enabled = !!enabled;
  await applyConfig();
  res.json(entry);
});

// DELETE /api/urls/:id
app.delete('/api/urls/:id', async (req, res) => {
  const index = config.urls.findIndex(u => u.id === req.params.id);
  if (index < 0) {
    return res.status(404).json({ error: 'URL not found' });
  }
  // Clean up image file if this is an image entry
  const entry = config.urls[index];
  if (entry.type === 'image' && entry.imageFile) {
    const imgPath = path.join(IMAGES_DIR, entry.imageFile);
    fs.unlink(imgPath, () => {});
  }
  config.urls.splice(index, 1);
  // Re-normalize order
  config.urls.sort((a, b) => a.order - b.order);
  config.urls.forEach((u, i) => u.order = i);
  await applyConfig();
  res.json({ ok: true });
});

// POST /api/rotation/pause
app.post('/api/rotation/pause', async (req, res) => {
  await tabManager.pause();
  res.json({ paused: true });
});

// POST /api/rotation/resume
app.post('/api/rotation/resume', async (req, res) => {
  await tabManager.resume();
  res.json({ paused: false });
});

// POST /api/rotation/jump/:id
app.post('/api/rotation/jump/:id', async (req, res) => {
  await tabManager.jumpTo(req.params.id);
  res.json({ ok: true });
});

// POST /api/rotation/reload-current
app.post('/api/rotation/reload-current', async (req, res) => {
  await tabManager.reloadCurrent();
  res.json({ ok: true });
});

// --- WebSocket ---

wss.on('connection', (ws) => {
  // Send current state on connect
  ws.send(JSON.stringify({ type: 'config', data: config }));
  ws.send(JSON.stringify({ type: 'status', data: tabManager.getStatus() }));
});

// --- Start ---

server.listen(PORT, () => {
  console.log(`Dashboard Rotator running on http://localhost:${PORT}`);
  tabManager.start(config);
});

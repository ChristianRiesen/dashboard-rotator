const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const MAX_BACKUPS = 5;

const DEFAULT_CONFIG = {
  settings: {
    defaultDuration: 30
  },
  urls: []
};

let backupIndex = 0;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function initBackupIndex() {
  let latest = 0;
  let latestTime = 0;
  for (let i = 1; i <= MAX_BACKUPS; i++) {
    const backupPath = path.join(DATA_DIR, `config.backup.${i}.json`);
    if (fs.existsSync(backupPath)) {
      const stat = fs.statSync(backupPath);
      if (stat.mtimeMs > latestTime) {
        latestTime = stat.mtimeMs;
        latest = i;
      }
    }
  }
  backupIndex = latest % MAX_BACKUPS;
}

function load() {
  ensureDataDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    save(DEFAULT_CONFIG);
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Failed to read config, using default:', err.message);
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

function save(config) {
  ensureDataDir();

  // Create backup of current file before overwriting
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const currentContent = fs.readFileSync(CONFIG_FILE, 'utf8');
      backupIndex = (backupIndex % MAX_BACKUPS) + 1;
      const backupPath = path.join(DATA_DIR, `config.backup.${backupIndex}.json`);
      fs.writeFileSync(backupPath, currentContent, 'utf8');
    } catch (err) {
      console.error('Failed to create backup:', err.message);
    }
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

function generateId() {
  return require('crypto').randomBytes(8).toString('hex');
}

// Initialize backup index on module load
ensureDataDir();
initBackupIndex();

module.exports = { load, save, generateId };

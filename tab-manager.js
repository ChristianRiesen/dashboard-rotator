const CDP = require('chrome-remote-interface');
const fs = require('fs');
const EventEmitter = require('events');

const CDP_PORT = 9222;
const RECONNECT_INTERVAL = 3000;
const RELOAD_TIMEOUT = 15000;

class TabManager extends EventEmitter {
  constructor() {
    super();
    // Map of url config id -> CDP target id
    this.tabs = new Map();
    this.connected = false;
    this.rotationTimer = null;
    this.tickTimer = null;
    this.paused = false;
    this.activeUrlId = null;
    this.remainingSeconds = 0;
    this.totalSeconds = 0;
    this.enabledUrls = [];
    this.currentIndex = 0;
    this.config = null;
    this._reconnectTimer = null;
    this._syncing = false;
  }

  start(config) {
    this.config = config;
    this._connect();
  }

  async _connect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    try {
      const targets = await CDP.List({ port: CDP_PORT });
      this.connected = true;
      console.log('CDP connected, found', targets.length, 'targets');
      await this.syncTabs(this.config);
    } catch (err) {
      this.connected = false;
      this._reconnectTimer = setTimeout(() => this._connect(), RECONNECT_INTERVAL);
    }
  }

  _scheduleReconnect() {
    this.connected = false;
    this.tabs.clear();
    this.emit('status');
    if (!this._reconnectTimer) {
      this._reconnectTimer = setTimeout(() => this._connect(), RECONNECT_INTERVAL);
    }
  }

  async syncTabs(config) {
    if (this._syncing) return;
    this._syncing = true;
    this.config = config;

    try {
      if (!this.connected) {
        this._syncing = false;
        return;
      }

      const enabledUrls = (config.urls || [])
        .filter(u => u.enabled)
        .sort((a, b) => a.order - b.order);
      this.enabledUrls = enabledUrls;

      const enabledIds = new Set(enabledUrls.map(u => u.id));

      // Close tabs for removed/disabled URLs
      for (const [urlId, targetId] of this.tabs.entries()) {
        if (!enabledIds.has(urlId)) {
          await this._closeTab(targetId);
          this.tabs.delete(urlId);
        }
      }

      // Create or update tabs for enabled URLs
      for (const urlEntry of enabledUrls) {
        if (this.tabs.has(urlEntry.id)) {
          // Tab exists - check if URL changed
          const targetId = this.tabs.get(urlEntry.id);
          const targets = await this._listTargets();
          const target = targets.find(t => t.id === targetId);
          if (target && target.url !== urlEntry.url) {
            await this._navigateTab(targetId, urlEntry.url);
          }
        } else {
          // Create new tab
          const targetId = await this._createTab(urlEntry.url);
          if (targetId) {
            this.tabs.set(urlEntry.id, targetId);
          }
        }
      }

      // Close the initial about:blank tab if we have real tabs
      if (this.tabs.size > 0) {
        await this._closeBlankTabs();
      }

      // Handle rotation state
      if (enabledUrls.length === 0) {
        this._stopRotation();
        this.activeUrlId = null;
        this.emit('status');
      } else if (this.activeUrlId && !enabledIds.has(this.activeUrlId)) {
        // Current tab was removed/disabled - advance
        this.currentIndex = 0;
        await this._activateByIndex(0);
      } else if (!this.activeUrlId) {
        // No active tab - start from beginning
        this.currentIndex = 0;
        await this._activateByIndex(0);
      } else {
        // Update current index in case order changed
        const idx = enabledUrls.findIndex(u => u.id === this.activeUrlId);
        if (idx >= 0) {
          this.currentIndex = idx;
          // Re-apply zoom in case it changed via edit
          const targetId = this.tabs.get(this.activeUrlId);
          if (targetId) {
            await this._applyZoom(targetId, enabledUrls[idx].zoom);
          }
        }
        // Restart the tick timer with potentially updated duration
        if (!this.paused) {
          this._restartTick();
        }
      }
    } catch (err) {
      console.error('syncTabs error:', err.message);
      if (err.message && (err.message.includes('ECONNREFUSED') || err.message.includes('ECONNRESET'))) {
        this._scheduleReconnect();
      }
    } finally {
      this._syncing = false;
    }
  }

  async _listTargets() {
    try {
      return await CDP.List({ port: CDP_PORT });
    } catch {
      this._scheduleReconnect();
      return [];
    }
  }

  async _createTab(url) {
    try {
      const target = await CDP.New({ port: CDP_PORT, url });
      return target.id;
    } catch (err) {
      console.error('Failed to create tab:', err.message);
      if (err.message && err.message.includes('ECONNREFUSED')) {
        this._scheduleReconnect();
      }
      return null;
    }
  }

  async _closeTab(targetId) {
    try {
      await CDP.Close({ port: CDP_PORT, id: targetId });
    } catch (err) {
      console.error('Failed to close tab:', err.message);
    }
  }

  async _closeBlankTabs() {
    try {
      const targets = await this._listTargets();
      for (const t of targets) {
        if (t.url === 'about:blank' && !Array.from(this.tabs.values()).includes(t.id)) {
          await this._closeTab(t.id);
        }
      }
    } catch (err) {
      console.error('Failed to close blank tabs:', err.message);
    }
  }

  async _navigateTab(targetId, url) {
    let client;
    try {
      client = await CDP({ port: CDP_PORT, target: targetId });
      await client.Page.enable();
      await client.Page.navigate({ url });
    } catch (err) {
      console.error('Failed to navigate tab:', err.message);
    } finally {
      if (client) {
        try { await client.close(); } catch {}
      }
    }
  }

  async _reloadTab(targetId) {
    let client;
    try {
      client = await CDP({ port: CDP_PORT, target: targetId });
      await client.Page.enable();
      const loadPromise = new Promise((resolve) => {
        const timeout = setTimeout(resolve, RELOAD_TIMEOUT);
        client.Page.loadEventFired(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
      await client.Page.reload({ ignoreCache: true });
      await loadPromise;
    } catch (err) {
      console.error('Failed to reload tab:', err.message);
    } finally {
      if (client) {
        try { await client.close(); } catch {}
      }
    }
  }

  async _activateTab(targetId) {
    try {
      await CDP.Activate({ port: CDP_PORT, id: targetId });
    } catch (err) {
      console.error('Failed to activate tab:', err.message);
      if (err.message && err.message.includes('ECONNREFUSED')) {
        this._scheduleReconnect();
      }
    }
  }

  async _applyZoom(targetId, zoom) {
    const factor = (zoom && zoom > 0) ? zoom / 100 : 1.0;
    let client;
    try {
      client = await CDP({ port: CDP_PORT, target: targetId });
      await client.Emulation.setPageScaleFactor({ pageScaleFactor: factor });
    } catch (err) {
      console.error('Failed to apply zoom:', err.message);
    } finally {
      if (client) {
        try { await client.close(); } catch {}
      }
    }
  }

  async _activateByIndex(index) {
    if (this.enabledUrls.length === 0) return;

    this.currentIndex = index % this.enabledUrls.length;
    const urlEntry = this.enabledUrls[this.currentIndex];
    const targetId = this.tabs.get(urlEntry.id);

    if (!targetId) return;

    this.activeUrlId = urlEntry.id;
    const duration = urlEntry.duration || this.config.settings.defaultDuration;
    this.totalSeconds = duration;
    this.remainingSeconds = duration;

    await this._activateTab(targetId);
    await this._applyZoom(targetId, urlEntry.zoom);
    this.emit('status');

    if (!this.paused) {
      this._startRotationTimer();
    }
  }

  _getDuration(urlEntry) {
    return urlEntry.duration || this.config.settings.defaultDuration;
  }

  _startRotationTimer() {
    this._stopRotation();

    this.tickTimer = setInterval(() => {
      if (this.paused) return;
      this.remainingSeconds--;
      this.emit('status');

      if (this.remainingSeconds <= 0) {
        this._stopRotation();
        this._advanceToNext();
      }
    }, 1000);
  }

  _restartTick() {
    // Only restart the interval timer, keep remaining seconds
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
    }
    this.tickTimer = setInterval(() => {
      if (this.paused) return;
      this.remainingSeconds--;
      this.emit('status');

      if (this.remainingSeconds <= 0) {
        this._stopRotation();
        this._advanceToNext();
      }
    }, 1000);
  }

  _stopRotation() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  async _advanceToNext() {
    if (this.enabledUrls.length === 0) return;

    const nextIndex = (this.currentIndex + 1) % this.enabledUrls.length;
    const nextUrl = this.enabledUrls[nextIndex];
    const targetId = this.tabs.get(nextUrl.id);

    if (!targetId) {
      // Tab missing, try to recreate
      const newTargetId = await this._createTab(nextUrl.url);
      if (newTargetId) {
        this.tabs.set(nextUrl.id, newTargetId);
        // Wait a moment for the page to load
        await new Promise(resolve => setTimeout(resolve, 2000));
        await this._activateByIndex(nextIndex);
      }
      return;
    }

    if (nextUrl.reloadOnDisplay) {
      await this._reloadTab(targetId);
    }

    await this._activateByIndex(nextIndex);
  }

  async pause() {
    this.paused = true;
    this.emit('status');
  }

  async resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.enabledUrls.length > 0 && this.activeUrlId) {
      this._startRotationTimer();
    }
    this.emit('status');
  }

  async jumpTo(urlId) {
    const index = this.enabledUrls.findIndex(u => u.id === urlId);
    if (index < 0) return;

    this._stopRotation();

    const urlEntry = this.enabledUrls[index];
    const targetId = this.tabs.get(urlEntry.id);
    if (!targetId) return;

    if (urlEntry.reloadOnDisplay) {
      await this._reloadTab(targetId);
    }

    await this._activateByIndex(index);
  }

  async reloadCurrent() {
    if (!this.activeUrlId) return;
    const targetId = this.tabs.get(this.activeUrlId);
    if (!targetId) return;
    await this._reloadTab(targetId);
    // Re-apply zoom after reload
    const urlEntry = this.enabledUrls.find(u => u.id === this.activeUrlId);
    if (urlEntry) {
      await this._applyZoom(targetId, urlEntry.zoom);
    }
  }

  getStatus() {
    const mem = this._readMemory();
    return {
      activeUrlId: this.activeUrlId,
      paused: this.paused,
      remainingSeconds: this.remainingSeconds,
      totalSeconds: this.totalSeconds,
      connected: this.connected,
      memoryTotalMB: mem.totalMB,
      memoryAvailableMB: mem.availableMB,
      enabledCount: (this.config?.urls || []).filter(u => u.enabled).length
    };
  }

  _readMemory() {
    try {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const totalMatch = meminfo.match(/MemTotal:\s+(\d+)/);
      const availMatch = meminfo.match(/MemAvailable:\s+(\d+)/);
      return {
        totalMB: totalMatch ? Math.round(parseInt(totalMatch[1]) / 1024) : 0,
        availableMB: availMatch ? Math.round(parseInt(availMatch[1]) / 1024) : 0
      };
    } catch {
      return { totalMB: 0, availableMB: 0 };
    }
  }

  destroy() {
    this._stopRotation();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
    }
  }
}

module.exports = TabManager;

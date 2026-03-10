(function () {
  'use strict';

  let config = { settings: { defaultDuration: 30 }, urls: [] };
  let status = { activeUrlId: null, paused: false, remainingSeconds: 0, totalSeconds: 0, connected: false };
  let ws = null;
  let editingId = null;
  let durationSaveTimer = null;
  let draggedId = null;
  let addType = 'url'; // 'url' or 'image'

  // --- DOM refs ---
  const connectionBadge = document.getElementById('connection-badge');
  const activeName = document.getElementById('active-name');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const btnPause = document.getElementById('btn-pause');
  const btnReload = document.getElementById('btn-reload');
  const defaultDurationInput = document.getElementById('default-duration');
  const urlList = document.getElementById('url-list');
  const btnAddUrl = document.getElementById('btn-add-url');
  const btnAddImage = document.getElementById('btn-add-image');
  const addForm = document.getElementById('add-form');
  const addFormTitle = document.getElementById('add-form-title');
  const addName = document.getElementById('add-name');
  const addUrl = document.getElementById('add-url');
  const addDuration = document.getElementById('add-duration');
  const addReloadCheckbox = document.getElementById('add-reload');
  const addReloadRow = document.getElementById('add-reload-row');
  const addUrlFields = document.getElementById('add-url-fields');
  const addImageFields = document.getElementById('add-image-fields');
  const addImageFile = document.getElementById('add-image-file');
  const addImageScaling = document.getElementById('add-image-scaling');
  const btnAddSave = document.getElementById('btn-add-save');
  const btnAddCancel = document.getElementById('btn-add-cancel');
  const memoryInfo = document.getElementById('memory-info');
  const btnSettings = document.getElementById('btn-settings');
  const settingsOverlay = document.getElementById('settings-overlay');
  const btnSettingsClose = document.getElementById('btn-settings-close');

  // --- WebSocket ---
  function connectWs() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}`);

    ws.onopen = () => {};

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'config') {
        config = msg.data;
        defaultDurationInput.value = config.settings.defaultDuration;
        renderUrlList();
      } else if (msg.type === 'status') {
        status = msg.data;
        renderStatus();
      }
    };

    ws.onclose = () => {
      status.connected = false;
      renderStatus();
      setTimeout(connectWs, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  // --- API helpers ---
  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`/api${path}`, opts);
    return res.json();
  }

  async function apiFormData(method, path, formData) {
    const res = await fetch(`/api${path}`, { method, body: formData });
    return res.json();
  }

  // --- Render Status ---
  function renderStatus() {
    // Connection badge
    if (status.connected) {
      connectionBadge.textContent = 'Online';
      connectionBadge.className = 'badge connected';
    } else {
      connectionBadge.textContent = 'Offline';
      connectionBadge.className = 'badge disconnected';
    }

    // Active URL name
    const activeUrl = config.urls.find(u => u.id === status.activeUrlId);
    if (activeUrl) {
      activeName.textContent = activeUrl.name;
    } else {
      activeName.textContent = 'No dashboard active';
    }

    // Progress bar
    if (status.totalSeconds > 0 && !status.paused) {
      const pct = (status.remainingSeconds / status.totalSeconds) * 100;
      progressBar.style.width = Math.max(0, pct) + '%';
      progressText.textContent = `${status.remainingSeconds}s / ${status.totalSeconds}s`;
    } else if (status.paused) {
      progressText.textContent = `Paused \u2013 ${status.remainingSeconds}s / ${status.totalSeconds}s`;
    } else {
      progressBar.style.width = '0%';
      progressText.textContent = '';
    }

    // Pause button
    const hasUrls = config.urls.some(u => u.enabled);
    btnPause.disabled = !hasUrls;
    btnReload.disabled = !status.activeUrlId;
    btnPause.textContent = status.paused ? 'Resume' : 'Pause';

    // Update active indicators in list
    document.querySelectorAll('.url-item').forEach(el => {
      const id = el.dataset.id;
      const indicator = el.querySelector('.url-active-indicator');
      if (id === status.activeUrlId) {
        el.classList.add('active');
        if (indicator) indicator.textContent = '\u25B6';
      } else {
        el.classList.remove('active');
        if (indicator) indicator.textContent = '';
      }
    });

    // Memory info
    if (status.memoryTotalMB > 0) {
      const avail = status.memoryAvailableMB;
      const total = status.memoryTotalMB;
      const pctAvail = avail / total;
      const availStr = avail >= 1024 ? (avail / 1024).toFixed(1) + ' GB' : avail + ' MB';
      const totalStr = total >= 1024 ? (total / 1024).toFixed(1) + ' GB' : total + ' MB';
      const count = status.enabledCount || 0;

      let text = `${count} active tab${count !== 1 ? 's' : ''} \u2014 ${availStr} available of ${totalStr}`;
      memoryInfo.className = 'memory-info';

      if (pctAvail < 0.1) {
        text += ' \u2014 memory low, consider disabling some URLs';
        memoryInfo.classList.add('danger');
      } else if (pctAvail < 0.2) {
        text += ' \u2014 memory getting low';
        memoryInfo.classList.add('warning');
      }

      memoryInfo.textContent = text;
    } else {
      memoryInfo.textContent = '';
    }
  }

  // --- Scaling label helper ---
  function scalingLabel(scaling) {
    if (scaling === 'fill-horizontal') return 'Fill Horizontally';
    if (scaling === 'fill-vertical') return 'Fill Vertically';
    return scaling || '';
  }

  // --- Render URL List ---
  function renderUrlList() {
    const sorted = [...config.urls].sort((a, b) => a.order - b.order);
    urlList.innerHTML = '';

    if (sorted.length === 0) {
      urlList.innerHTML = '<div class="empty-state">No URLs configured. Add one to get started.</div>';
      return;
    }

    sorted.forEach(entry => {
      if (editingId === entry.id) {
        urlList.appendChild(createEditForm(entry));
      } else {
        urlList.appendChild(createUrlItem(entry));
      }
    });

    renderStatus();
  }

  function createUrlItem(entry) {
    const div = document.createElement('div');
    div.className = 'url-item' + (entry.enabled ? '' : ' disabled');
    div.dataset.id = entry.id;
    div.draggable = false;

    const duration = entry.duration || config.settings.defaultDuration;
    const isActive = status.activeUrlId === entry.id;
    const isImage = entry.type === 'image';

    const addressLine = isImage
      ? `<span class="url-type-badge">IMG</span> ${escapeHtml(scalingLabel(entry.imageScaling))}`
      : escapeHtml(entry.url);

    div.innerHTML = `
      <span class="drag-handle" draggable="true" title="Drag to reorder">\u2630</span>
      <span class="url-active-indicator">${isActive ? '\u25B6' : ''}</span>
      <label class="url-toggle" title="${entry.enabled ? 'Disable' : 'Enable'}">
        <input type="checkbox" ${entry.enabled ? 'checked' : ''} data-action="toggle">
      </label>
      <div class="url-info">
        <div class="url-info-top">
          <span class="url-name">${escapeHtml(entry.name)}</span>
          <span class="url-duration">${duration}s</span>
          ${entry.reloadOnDisplay && !isImage ? '<span class="url-reload-badge">reload</span>' : ''}
        </div>
        <div class="url-address">${addressLine}</div>
      </div>
      <div class="url-actions">
        <button class="btn btn-sm btn-ghost" data-action="edit">Edit</button>
        <button class="btn btn-sm btn-danger" data-action="delete">Del</button>
      </div>
    `;

    if (isActive) div.classList.add('active');

    // Click to jump
    div.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]') || e.target.closest('.drag-handle') || e.target.closest('.url-toggle')) return;
      if (entry.enabled) {
        api('POST', `/rotation/jump/${entry.id}`);
      }
    });

    // Toggle
    div.querySelector('[data-action="toggle"]').addEventListener('change', (e) => {
      e.stopPropagation();
      api('PUT', `/urls/${entry.id}`, { enabled: e.target.checked });
    });

    // Edit
    div.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
      e.stopPropagation();
      editingId = entry.id;
      renderUrlList();
    });

    // Delete
    div.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${entry.name}"?`)) {
        api('DELETE', `/urls/${entry.id}`);
      }
    });

    // Drag and drop via handle
    const handle = div.querySelector('.drag-handle');
    handle.addEventListener('dragstart', (e) => {
      draggedId = entry.id;
      e.dataTransfer.effectAllowed = 'move';
      div.classList.add('dragging');
    });

    handle.addEventListener('dragend', () => {
      draggedId = null;
      div.classList.remove('dragging');
      document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
      });
    });

    div.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!draggedId || draggedId === entry.id) return;
      const rect = div.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      div.classList.toggle('drag-over-top', e.clientY < midY);
      div.classList.toggle('drag-over-bottom', e.clientY >= midY);
    });

    div.addEventListener('dragleave', () => {
      div.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    div.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      div.classList.remove('drag-over-top', 'drag-over-bottom');
      if (!draggedId || draggedId === entry.id) return;
      const rect = div.getBoundingClientRect();
      const dropAfter = e.clientY >= rect.top + rect.height / 2;
      reorderUrls(draggedId, entry.id, dropAfter);
    });

    return div;
  }

  function createEditForm(entry) {
    const div = document.createElement('div');
    div.className = 'url-edit-form';
    const isImage = entry.type === 'image';

    if (isImage) {
      div.innerHTML = `
        <div class="form-title">Edit Image Entry</div>
        <div class="form-row">
          <label>Name</label>
          <input type="text" id="edit-name" value="${escapeAttr(entry.name)}">
        </div>
        <div class="form-row">
          <label>Replace Image (optional)</label>
          <input type="file" id="edit-image-file" accept="image/*">
        </div>
        <div class="form-row">
          <label>Scaling</label>
          <select id="edit-image-scaling">
            <option value="fill-vertical" ${entry.imageScaling === 'fill-vertical' ? 'selected' : ''}>Fill Vertically</option>
            <option value="fill-horizontal" ${entry.imageScaling === 'fill-horizontal' ? 'selected' : ''}>Fill Horizontally</option>
          </select>
        </div>
        <div class="form-row">
          <label>Duration override (seconds, blank for default)</label>
          <input type="number" id="edit-duration" min="5" max="3600" value="${entry.duration || ''}">
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" id="edit-save">Save</button>
          <button class="btn btn-ghost" id="edit-cancel">Cancel</button>
        </div>
      `;

      div.querySelector('#edit-save').addEventListener('click', () => {
        const name = div.querySelector('#edit-name').value.trim();
        if (!name) return alert('Name is required.');

        const durVal = div.querySelector('#edit-duration').value;
        const imageScaling = div.querySelector('#edit-image-scaling').value;
        const fileInput = div.querySelector('#edit-image-file');

        const formData = new FormData();
        formData.append('name', name);
        formData.append('duration', durVal || '');
        formData.append('imageScaling', imageScaling);
        if (fileInput.files.length > 0) {
          formData.append('image', fileInput.files[0]);
        }

        editingId = null;
        apiFormData('POST', `/urls/${entry.id}/update-image`, formData);
      });
    } else {
      div.innerHTML = `
        <div class="form-title">Edit Entry</div>
        <div class="form-row">
          <label>Name</label>
          <input type="text" id="edit-name" value="${escapeAttr(entry.name)}">
        </div>
        <div class="form-row">
          <label>URL</label>
          <input type="url" id="edit-url" value="${escapeAttr(entry.url)}">
        </div>
        <div class="form-row">
          <label>Duration override (seconds, blank for default)</label>
          <input type="number" id="edit-duration" min="5" max="3600" value="${entry.duration || ''}">
        </div>
        <div class="form-row">
          <label class="checkbox-label">
            <input type="checkbox" id="edit-reload" ${entry.reloadOnDisplay ? 'checked' : ''}>
            Reload on each display
          </label>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" id="edit-save">Save</button>
          <button class="btn btn-ghost" id="edit-cancel">Cancel</button>
        </div>
      `;

      div.querySelector('#edit-save').addEventListener('click', () => {
        const name = div.querySelector('#edit-name').value.trim();
        const url = div.querySelector('#edit-url').value.trim();
        const durVal = div.querySelector('#edit-duration').value;
        const duration = durVal ? parseInt(durVal, 10) : null;
        const reloadOnDisplay = div.querySelector('#edit-reload').checked;

        if (!name || !url) return alert('Name and URL are required.');

        editingId = null;
        api('PUT', `/urls/${entry.id}`, { name, url, duration, reloadOnDisplay });
      });
    }

    div.querySelector('#edit-cancel').addEventListener('click', () => {
      editingId = null;
      renderUrlList();
    });

    return div;
  }

  function reorderUrls(fromId, targetId, dropAfter) {
    const sorted = [...config.urls].sort((a, b) => a.order - b.order);
    const ids = sorted.map(u => u.id);
    const fromIndex = ids.indexOf(fromId);
    let toIndex = ids.indexOf(targetId);
    if (fromIndex < 0 || toIndex < 0) return;

    ids.splice(fromIndex, 1);
    // Recalculate target index after removal
    toIndex = ids.indexOf(targetId);
    if (dropAfter) toIndex++;
    // Skip if position hasn't changed
    if (toIndex === fromIndex) return;
    ids.splice(toIndex, 0, fromId);
    api('PUT', '/urls/reorder', { ids });
  }

  // --- Drag and drop on list container (catch drops in empty space) ---
  urlList.addEventListener('dragover', (e) => {
    if (!draggedId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  urlList.addEventListener('drop', (e) => {
    if (!draggedId) return;
    e.preventDefault();
    // Dropped in empty space below all items — move to end
    const lastItem = urlList.querySelector('.url-item:last-child');
    if (lastItem && lastItem.dataset.id !== draggedId) {
      const targetId = lastItem.dataset.id;
      reorderUrls(draggedId, targetId, true);
    }
  });

  // --- Event Listeners ---

  // Pause / Resume
  btnPause.addEventListener('click', () => {
    if (status.paused) {
      api('POST', '/rotation/resume');
    } else {
      api('POST', '/rotation/pause');
    }
  });

  // Force Reload
  btnReload.addEventListener('click', () => {
    api('POST', '/rotation/reload-current');
  });

  // Default duration - save on change with debounce
  defaultDurationInput.addEventListener('input', () => {
    clearTimeout(durationSaveTimer);
    durationSaveTimer = setTimeout(() => {
      const val = parseInt(defaultDurationInput.value, 10);
      if (val && val >= 5) {
        api('PUT', '/settings', { defaultDuration: val });
      }
    }, 500);
  });

  // Settings modal
  btnSettings.addEventListener('click', () => {
    settingsOverlay.style.display = 'flex';
  });

  btnSettingsClose.addEventListener('click', () => {
    settingsOverlay.style.display = 'none';
  });

  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) {
      settingsOverlay.style.display = 'none';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsOverlay.style.display !== 'none') {
      settingsOverlay.style.display = 'none';
    }
  });

  // --- Add form helpers ---
  function openAddForm(type) {
    addType = type;
    addForm.style.display = 'block';
    addName.value = '';
    addUrl.value = '';
    addDuration.value = '';
    addReloadCheckbox.checked = false;
    addImageFile.value = '';
    addImageScaling.value = 'fill-vertical';

    if (type === 'image') {
      addFormTitle.textContent = 'New Image';
      addUrlFields.style.display = 'none';
      addImageFields.style.display = 'block';
      addReloadRow.style.display = 'none';
    } else {
      addFormTitle.textContent = 'New Entry';
      addUrlFields.style.display = 'block';
      addImageFields.style.display = 'none';
      addReloadRow.style.display = 'block';
    }

    addName.focus();
  }

  // Add URL form
  btnAddUrl.addEventListener('click', () => openAddForm('url'));
  btnAddImage.addEventListener('click', () => openAddForm('image'));

  btnAddCancel.addEventListener('click', () => {
    addForm.style.display = 'none';
  });

  btnAddSave.addEventListener('click', () => {
    const name = addName.value.trim();
    if (!name) return alert('Name is required.');

    if (addType === 'image') {
      if (!addImageFile.files.length) return alert('Please select an image file.');

      const formData = new FormData();
      formData.append('name', name);
      formData.append('image', addImageFile.files[0]);
      formData.append('imageScaling', addImageScaling.value);
      const durVal = addDuration.value;
      if (durVal) formData.append('duration', durVal);

      apiFormData('POST', '/urls/image', formData);
    } else {
      const url = addUrl.value.trim();
      if (!url) return alert('URL is required.');

      const durVal = addDuration.value;
      const duration = durVal ? parseInt(durVal, 10) : null;
      const reloadOnDisplay = addReloadCheckbox.checked;

      api('POST', '/urls', { name, url, duration, reloadOnDisplay });
    }

    addForm.style.display = 'none';
  });

  // --- Helpers ---
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // --- Init ---
  connectWs();
})();

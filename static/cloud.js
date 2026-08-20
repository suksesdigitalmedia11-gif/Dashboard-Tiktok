(function () {
  const CHUNK = 500;
  const MAX_RETRIES = 3;

  // ===== TOAST SYSTEM =====
  function ensureToastContainer() {
    let c = document.querySelector('.toast-container');
    if (!c) {
      c = document.createElement('div');
      c.className = 'toast-container';
      document.body.appendChild(c);
    }
    return c;
  }

  window.showToast = function (message, level, duration) {
    level = level || 'info';
    duration = duration || 5000;
    var container = ensureToastContainer();
    var icons = { success: '✅', error: '❌', warn: '⚠️', info: 'ℹ️' };
    var titles = { success: 'Berhasil', error: 'Gagal', warn: 'Perhatian', info: 'Info' };
    var toast = document.createElement('div');
    toast.className = 'toast ' + level;
    toast.innerHTML =
      '<span class="toast-icon">' + (icons[level] || 'ℹ️') + '</span>' +
      '<div class="toast-body"><strong>' + (titles[level] || 'Info') + '</strong><p>' + String(message || '') + '</p></div>' +
      '<button class="toast-close" onclick="this.parentElement.remove()">✕</button>';
    container.appendChild(toast);
    if (duration > 0) {
      setTimeout(function () {
        toast.classList.add('out');
        setTimeout(function () { if (toast.parentElement) toast.remove(); }, 300);
      }, duration);
    }
  };

  // ===== PROGRESS OVERLAY =====
  function ensureProgressOverlay() {
    var el = document.querySelector('.upload-overlay');
    if (!el) {
      el = document.createElement('div');
      el.className = 'upload-overlay hidden';
      el.innerHTML =
        '<div class="upload-progress-card">' +
        '<div class="spinner"></div>' +
        '<h3 id="progTitle">Mengupload Data...</h3>' +
        '<div class="filename" id="progFile"></div>' +
        '<div class="progress-bar-wrap"><div class="progress-bar-fill" id="progBar"></div></div>' +
        '<div class="progress-text" id="progText">Menyiapkan...</div>' +
        '<div class="progress-stats">' +
        '<span id="progChunk">0/0 bagian</span>' +
        '<span id="progSpeed"></span>' +
        '</div>' +
        '<button class="cancel-upload hidden" id="progCancel" onclick="window._cancelUpload && window._cancelUpload()">Batalkan Upload</button>' +
        '</div>';
      document.body.appendChild(el);
    }
    return el;
  }

  window._uploadProgress = {
    show: function (filename, totalChunks) {
      var overlay = ensureProgressOverlay();
      overlay.classList.remove('hidden');
      document.getElementById('progTitle').textContent = 'Mengupload Data...';
      document.getElementById('progFile').textContent = filename;
      document.getElementById('progBar').style.width = '0%';
      document.getElementById('progText').textContent = 'Menyiapkan...';
      document.getElementById('progChunk').textContent = '0/' + totalChunks + ' bagian';
      document.getElementById('progSpeed').textContent = '';
      document.getElementById('progCancel').classList.add('hidden');
      window._cancelUpload = null;
    },
    update: function (part, total, pct, speedText) {
      document.getElementById('progBar').style.width = pct + '%';
      document.getElementById('progText').textContent = 'Mengirim bagian ' + part + ' dari ' + total + '...';
      document.getElementById('progChunk').textContent = part + '/' + total + ' bagian (' + pct + '%)';
      if (speedText) document.getElementById('progSpeed').textContent = speedText;
    },
    complete: function (success, message) {
      var overlay = document.querySelector('.upload-overlay');
      if (!overlay) return;
      document.getElementById('progTitle').textContent = success ? '✅ Upload Selesai!' : '⚠️ Upload Selesai';
      document.getElementById('progBar').style.width = '100%';
      document.getElementById('progBar').style.background = success ? 'var(--green)' : 'var(--gold)';
      document.getElementById('progText').textContent = message || '';
      document.querySelector('.upload-progress-card .spinner').style.display = 'none';
      setTimeout(function () {
        overlay.classList.add('hidden');
        document.querySelector('.upload-progress-card .spinner').style.display = '';
        document.getElementById('progBar').style.background = '';
      }, 2000);
    },
    hide: function () {
      var overlay = document.querySelector('.upload-overlay');
      if (overlay) overlay.classList.add('hidden');
    },
    enableCancel: function (fn) {
      document.getElementById('progCancel').classList.remove('hidden');
      window._cancelUpload = fn;
    }
  };

  // ===== RETRY LOGIC =====
  async function retryFetch(url, options, maxRetries) {
    maxRetries = maxRetries || MAX_RETRIES;
    var lastError;
    for (var attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          var delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
          console.log('[retry] Attempt ' + (attempt + 1) + ' after ' + delay + 'ms');
          await new Promise(function (r) { setTimeout(r, delay); });
        }
        var res = await fetch(url, options);
        if (!res.ok) {
          var text = await res.text().catch(function () { return ''; });
          throw new Error('HTTP ' + res.status + ': ' + (text || 'Server error'));
        }
        var data = await res.json().catch(function () { return null; });
        if (data && data.ok === false) throw new Error(data.error || 'Server returned error');
        return data;
      } catch (e) {
        lastError = e;
        if (attempt < maxRetries) {
          console.warn('[retry] Chunk failed, retrying...', e.message);
        }
      }
    }
    throw lastError || new Error('Upload gagal setelah ' + (maxRetries + 1) + ' percobaan');
  }

  // ===== UPLOAD WITH PROGRESS =====
  async function uploadForm(form, api, notify) {
    var fileInput = form.querySelector('input[type="file"]');
    var files = Array.from(fileInput.files || []);
    if (!files.length) throw new Error("Pilih minimal satu file terlebih dahulu.");

    var storeName = form.elements.storeName.value || "ventura";
    var kind = form.elements.kind.value || "auto";
    var submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) { submitButton.disabled = true; submitButton.textContent = "Menyiapkan..."; }

    var results = [];
    var cancelled = false;
    window._cancelUpload = function () { cancelled = true; window._uploadProgress.hide(); };

    try {
      for (var f = 0; f < files.length; f++) {
        if (cancelled) {
          window.showToast('Upload dibatalkan oleh user.', 'warn');
          break;
        }

        var file = files[f];
        var sizeMB = (file.size / 1024 / 1024).toFixed(1);

        if (!window.XLSX) throw new Error("Library Excel belum siap. Refresh halaman.");

        // Baca file dan parse workbook
        if (submitButton) submitButton.textContent = "Membaca " + file.name + "...";
        var startTime = Date.now();
        var buffer = await file.arrayBuffer();
        var workbook = window.XLSX.read(buffer, { type: "array", cellDates: true, raw: false });

        // ── pickSheet: pilih sheet yang tepat (sama dgn upload.js di server) ──
        function sheetHasIncomeColumns(ws) {

          var maxCheck = 6;
          var checked = 0;
          for (var key in ws) {
            if (!key || key[0] === '!') continue;
            var cell = ws[key];
            if (!cell) continue;
            var v = String(cell.w != null ? cell.w : (cell.v != null ? cell.v : '')).toLowerCase().replace(/[^a-z0-9]+/g, '');
            if (v.includes('idpesananpenyesuaian') || v.includes('orderadjustmentid') ||
              v.includes('jumlahpenyelesaian') || v.includes('totalsettlement')) return true;
            if (++checked >= maxCheck * 50) break;
          }
          return false;
        }
        var sheetName;
        if (workbook.SheetNames.includes('OrderSKUList')) sheetName = 'OrderSKUList';
        else if (workbook.SheetNames.includes('Detail pesanan')) sheetName = 'Detail pesanan';
        else if (workbook.SheetNames.includes('Daftar Pesanan')) sheetName = 'Daftar Pesanan';
        else {
          sheetName = workbook.SheetNames.find(function (sn) {
            return sheetHasIncomeColumns(workbook.Sheets[sn]);
          }) || workbook.SheetNames[0];
        }
        console.log('[upload] File:', file.name, '| Sheet dipilih:', sheetName, '(dari:', workbook.SheetNames.join(', ') + ')');

        var sheet = workbook.Sheets[sheetName];

        // Fix !ref range
        var keys = Object.keys(sheet).filter(function (k) { return k && k[0] !== '!'; });
        var maxRow = 0, maxCol = 0;
        for (var ki = 0; ki < keys.length; ki++) {
          try { var c = window.XLSX.utils.decode_cell(keys[ki]); if (c.r > maxRow) maxRow = c.r; if (c.c > maxCol) maxCol = c.c; } catch (e) { }
        }
        if (maxRow > 0) {
          sheet['!ref'] = window.XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
        }

        var rows = window.XLSX.utils.sheet_to_json(sheet, { defval: "" });
        if (!rows.length) throw new Error("File " + file.name + " kosong atau tidak terbaca.");

        var totalParts = Math.ceil(rows.length / CHUNK);

        // Show progress overlay
        window._uploadProgress.show(file.name + ' (' + sizeMB + ' MB, ' + rows.length + ' baris)', totalParts);
        window._uploadProgress.enableCancel(function () { cancelled = true; window._uploadProgress.hide(); });

        if (submitButton) submitButton.textContent = "Mengirim " + rows.length + " baris...";

        var fileResults = [];
        var totalInserted = 0;
        var failedParts = 0;

        for (var i = 0; i < rows.length; i += CHUNK) {
          if (cancelled) break;

          var chunk = rows.slice(i, i + CHUNK);
          var part = Math.floor(i / CHUNK) + 1;
          var progressPct = Math.round(part / totalParts * 100);

          var elapsed = (Date.now() - startTime) / 1000;
          var speedText = part > 0 ? Math.round(part * CHUNK / Math.max(elapsed, 1)) + ' baris/detik' : '';

          window._uploadProgress.update(part, totalParts, progressPct, speedText);

          try {
            var result = await retryFetch("/api/upload", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                storeName: storeName,
                kind: kind,
                filename: totalParts > 1 ? file.name + " (" + part + "/" + totalParts + ")" : file.name,
                rows: chunk,
              }),
            });
            fileResults.push(result);
            totalInserted += (result.inserted || 0);
          } catch (chunkErr) {
            failedParts++;
            console.error('[upload] Part ' + part + ' failed:', chunkErr.message);
            window.showToast('Bagian ' + part + '/' + totalParts + ' gagal: ' + chunkErr.message, 'error', 6000);
            // Continue with remaining chunks instead of aborting
          }
        }

        results.push({ results: fileResults });

        // Show completion
        if (failedParts > 0) {
          window._uploadProgress.complete(false, file.name + ': ' + totalInserted + ' baru, ' + failedParts + ' bagian gagal');
          window.showToast(file.name + ': ' + totalInserted + ' baris berhasil, ' + failedParts + ' bagian gagal. Cek koneksi lalu coba lagi.', 'warn', 8000);
        } else {
          window._uploadProgress.complete(true, file.name + ': ' + totalInserted + ' baris baru berhasil');
          window.showToast('✅ ' + file.name + ': ' + totalInserted + ' baris baru berhasil diimport!', 'success', 6000);
        }

        if (submitButton) {
          submitButton.textContent = "✅ Selesai!";
          setTimeout(function () { submitButton.textContent = "Upload & Update Dashboard"; submitButton.disabled = false; }, 2500);
        }
      }

      return results;
    } catch (err) {
      window._uploadProgress.hide();
      if (submitButton) { submitButton.disabled = false; submitButton.textContent = "Upload & Update Dashboard"; }
      throw err;
    } finally {
      if (submitButton && submitButton.textContent.indexOf('Upload') === 0) {
        submitButton.textContent = "Upload & Update Dashboard"; submitButton.disabled = false;
      }
    }
  }

  window.CloudFinance = { uploadForm: uploadForm };
})();

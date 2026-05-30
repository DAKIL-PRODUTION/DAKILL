/* ═══════════════════════════════════════════════════════════
   KAS WI-FI BERSAMA — app.js
   Terhubung ke Google Apps Script (GAS) sebagai backend.
   ═══════════════════════════════════════════════════════════ */

'use strict';

// ── Config ────────────────────────────────────────────────────
const STORAGE_KEY    = 'kasWifi_gasUrl';
const QRIS_IMG_URL   = 'QR..jpeg';   // ← Isi URL gambar QRIS Anda (JPG/PNG), atau biarkan kosong untuk placeholder
const DEFAULT_TARGET = 105000; // Backup jika GAS belum dikonfigurasi

let GAS_URL       = localStorage.getItem(STORAGE_KEY) || '';
let refreshTimer  = null;
let currentTarget = DEFAULT_TARGET;

// ── Formatters ────────────────────────────────────────────────
const idr = n => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0
}).format(n || 0);

const escHtml = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtTime = ts => {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
  } catch { return String(ts); }
};

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('gas-url-input');

  if (GAS_URL) {
    // URL sudah tersimpan — sembunyikan panduan setup
    document.getElementById('setup-guide').style.display = 'none';
    if (urlInput) urlInput.value = GAS_URL;
    loadData();
    startAutoRefresh();
  } else {
    setStatus('Masukkan URL Google Apps Script untuk memulai', false);
  }

  // Custom QR image jika dikonfigurasi
  if (QRIS_IMG_URL) {
    document.getElementById('qris-img').src = QRIS_IMG_URL;
  }
});

// ── Setup URL ─────────────────────────────────────────────────
window.saveGasUrl = function () {
  const val = (document.getElementById('gas-url-input').value || '').trim();
  if (!val || !val.startsWith('http')) {
    showToast('URL tidak valid. Pastikan diawali https://', 'error');
    return;
  }
  GAS_URL = val;
  localStorage.setItem(STORAGE_KEY, GAS_URL);
  document.getElementById('setup-guide').style.display = 'none';
  showToast('URL tersimpan! Memuat data…', 'success');
  loadData();
  startAutoRefresh();
};

// ── Load Data from GAS ────────────────────────────────────────
async function loadData() {
  if (!GAS_URL) return;
  setStatus('Memuat data…', false);

  const filterBulan = document.getElementById('filter-bulan')?.checked ?? true;
  const url = GAS_URL + (filterBulan ? '?filter=bulan' : '');

  try {
    const res  = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    if (json.status === 'error') throw new Error(json.message || 'Gagal memuat');

    // Simpan target dari config GAS
    currentTarget = json.config?.biaya_wifi || json.summary?.biaya_wifi || DEFAULT_TARGET;

    renderDashboard(json.summary || {});
    renderParticipants(json.rows || []);
    renderHistory(json.rows || []);

    setStatus('Terakhir update: ' + new Date().toLocaleTimeString('id-ID'), true);
  } catch (err) {
    setStatus('Gagal memuat: ' + err.message, false);
    console.error('[KasWifi] loadData error:', err);
  }
}

// ── Render: Dashboard ─────────────────────────────────────────
function renderDashboard(s) {
  setText('stat-masuk',  idr(s.total_masuk));
  setText('stat-keluar', idr(s.total_keluar));
  setText('stat-saldo',  idr(s.saldo));
  setText('stat-sisa',   idr(s.sisa_kebutuhan ?? currentTarget));
  setText('stat-target', idr(s.biaya_wifi || currentTarget));
  setText('stat-peserta', (s.jumlah_peserta || 0) + ' peserta');

  const pct  = s.persentase || 0;
  const fill = document.getElementById('progress-fill');
  const pctEl = document.getElementById('stat-persen');

  if (pctEl) pctEl.textContent = pct + '%';
  if (fill) {
    // Small delay so CSS transition runs after paint
    requestAnimationFrame(() => {
      fill.style.width = Math.min(pct, 100) + '%';
      fill.classList.toggle('full', pct >= 100);
    });
    const track = fill.closest('[role="progressbar"]');
    if (track) track.setAttribute('aria-valuenow', pct);
  }
}

// ── Render: Participants ──────────────────────────────────────
function renderParticipants(rows) {
  const list    = document.getElementById('participant-list');
  if (!list) return;

  const masuk   = rows.filter(r => r['Jenis'] === 'Masuk');
  const byName  = {};
  masuk.forEach(r => { byName[r['Nama']] = (byName[r['Nama']] || 0) + (r['Nominal'] || 0); });
  const entries = Object.entries(byName);

  if (!entries.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><p>Belum ada yang setor</p></div>`;
    return;
  }

  list.innerHTML = entries
    .sort((a, b) => b[1] - a[1])                      // urutkan nominal terbesar
    .map(([nama, total]) => `
      <div class="participant-chip">
        <span>👤 ${escHtml(nama)}</span>
        <span class="chip-amount">${idr(total)}</span>
      </div>
    `).join('');
}

// ── Render: History ───────────────────────────────────────────
function renderHistory(rows) {
  const tbody = document.getElementById('history-body');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">📋</div><p>Belum ada riwayat</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = [...rows].reverse().map(r => {
    const jenis = r['Jenis'] || 'Masuk';
    const sign  = jenis === 'Masuk' ? '+' : '−';
    const color = jenis === 'Masuk' ? 'var(--green)' : 'var(--red)';
    return `
      <tr>
        <td style="font-family:var(--mono);font-size:.73rem;color:var(--muted);white-space:nowrap">${fmtTime(r['Timestamp'])}</td>
        <td style="font-weight:600">${escHtml(r['Nama'] || '—')}</td>
        <td style="font-family:var(--mono);color:${color};font-weight:700;white-space:nowrap">${sign}${idr(r['Nominal'])}</td>
        <td><span class="badge ${jenis.toLowerCase()}">${escHtml(jenis)}</span></td>
        <td style="color:var(--muted);font-size:.78rem">${escHtml(r['Keterangan'] || '—')}</td>
      </tr>
    `;
  }).join('');
}

// ── QRIS Modal ────────────────────────────────────────────────

/** Buka modal QRIS — validasi input dulu */
window.openQris = function () {
  if (!GAS_URL) {
    showToast('Setup URL Google Apps Script dulu!', 'error');
    return;
  }

  const nama    = (document.getElementById('nama-input')?.value || '').trim();
  const nominal = parseFloat(document.getElementById('nominal-input')?.value || '0');

  if (!nama) {
    showToast('Nama wajib diisi!', 'error');
    document.getElementById('nama-input')?.focus();
    return;
  }
  if (!nominal || nominal < 1000) {
    showToast('Nominal minimal Rp 1.000', 'error');
    document.getElementById('nominal-input')?.focus();
    return;
  }

  // Tampilkan nominal di modal
  const amountEl = document.getElementById('qr-amount-display');
  if (amountEl) amountEl.textContent = idr(nominal);

  // Update QR placeholder dengan nominal (opsional — ganti dengan QRIS statis jika punya)
  if (!QRIS_IMG_URL) {
    const qrData = encodeURIComponent(`KasWiFiBersama|${nama}|${nominal}`);
    const img    = document.getElementById('qris-img');
    if (img) img.src = `QR..jpeg`;
  }

  openModal();
};

window.closeQris = function () { closeModal(); };

window.handleOverlayClick = function (e) {
  if (e.target === document.getElementById('qris-overlay')) closeModal();
};

function openModal() {
  const overlay = document.getElementById('qris-overlay');
  if (overlay) {
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal() {
  const overlay = document.getElementById('qris-overlay');
  if (overlay) {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }
}

// ── Confirm Payment ───────────────────────────────────────────
window.confirmPayment = async function () {
  const nama    = (document.getElementById('nama-input')?.value || '').trim();
  const nominal = parseFloat(document.getElementById('nominal-input')?.value || '0');

  if (!nama || !nominal) { closeModal(); return; }

  setModalLoading(true);

  try {
    const res = await fetch(GAS_URL, {
      method : 'POST',
      headers: { 'Content-Type': 'text/plain' },   // text/plain avoids CORS preflight
      body   : JSON.stringify({ nama, nominal, keterangan: 'Bayar iuran Wi-Fi' })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.status === 'error') throw new Error(json.message);

    // Berhasil
    closeModal();
    document.getElementById('nama-input').value    = '';
    document.getElementById('nominal-input').value = '';
    showToast(`🎉 Terima kasih, ${nama}! Setoran tercatat.`, 'success');
    await loadData();

  } catch (err) {
    closeModal();
    showToast('Gagal menyimpan: ' + err.message, 'error');
    console.error('[KasWifi] confirmPayment error:', err);
  } finally {
    setModalLoading(false);
  }
};

// ── Auto Refresh ──────────────────────────────────────────────
function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { if (GAS_URL) loadData(); }, 10_000);
}

// ── UI Helpers ────────────────────────────────────────────────
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setStatus(msg, live) {
  setText('status-text', msg);
  const dot = document.getElementById('status-dot');
  if (dot) dot.classList.toggle('live', live);
}

function setModalLoading(on) {
  const btn     = document.getElementById('btn-confirm');
  const spinner = document.getElementById('spinner-modal');
  const txt     = document.getElementById('btn-confirm-text');
  if (!btn) return;
  btn.disabled = on;
  if (spinner) spinner.classList.toggle('active', on);
  if (txt) txt.textContent = on ? 'Menyimpan…' : '✅ Sudah Bayar, Catat Sekarang';
}

let toastTimer;
function showToast(msg, type = 'success') {
  const toast   = document.getElementById('toast');
  const iconEl  = document.getElementById('toast-icon');
  const msgEl   = document.getElementById('toast-msg');
  if (!toast) return;
  if (iconEl) iconEl.textContent = type === 'success' ? '✅' : '❌';
  if (msgEl)  msgEl.textContent  = msg;
  toast.className = 'show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = ''; }, 3800);
}

// ── Keyboard: Esc closes modal ────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

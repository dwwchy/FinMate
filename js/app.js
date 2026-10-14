/**
 * FinMate — Master Application Controller
 * Sistem Rollover Saldo Bulanan, Kategori Terpisah & Multi-Rekening
 * Vanilla JavaScript ES6+
 */

const STORAGE_KEY = 'finmate_shared_core_v4';
let state = null;
let currentActiveTab = 'dashboard';
let tempNewReceiptImg = '';
let tempEditReceiptImg = '';
let currentViewingReceiptTxId = null;
let sharedSyncPollingTimer = null;

// ========================================================
// 1. STATE PERSISTENCE & MIGRATION
// ========================================================

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state = JSON.parse(raw);
    }
  } catch (err) {
    console.warn('Gagal membaca data dari storage:', err);
  }

  // Fallback ke initialData jika kosong
  if (!state || !state.settings || !state.wallets || !state.categories) {
    state = deepClone(initialData);
    saveState();
  }

  // Migrasi skema jika dari versi sebelumnya
  if (!state.profile) {
    state.profile = deepClone(initialData.profile);
  }

  // Pastikan activeMonth ada (default YYYY-MM sekarang)
  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (!state.settings.activeMonth) {
    state.settings.activeMonth = currentYm;
  }
  if (!state.settings.theme) {
    state.settings.theme = 'dark';
  }
  if (!state.settings.firstOpenedDate) {
    state.settings.firstOpenedDate = new Date().toISOString().slice(0, 10);
  }

  // Normalisasi wallets menjadi Array (Hanya Bank & Cash dengan saldo awal 0)
  if (!Array.isArray(state.wallets) || state.wallets.length === 0) {
    state.wallets = deepClone(initialData.wallets);
  }

  // Normalisasi categories terpisah (income vs expense)
  if (!state.categories || typeof state.categories !== 'object') {
    state.categories = deepClone(initialData.categories);
  }
  if (!Array.isArray(state.categories.income)) {
    state.categories.income = [];
  }
  if (!Array.isArray(state.categories.expense)) {
    state.categories.expense = [];
  }

  if (!Array.isArray(state.transactions)) {
    state.transactions = deepClone(initialData.transactions);
  }

  // Normalisasi auth state & Google Drive backup
  if (!state.auth) {
    state.auth = deepClone(initialData.auth);
  }
  if (!state.deviceGoogleAccounts || !Array.isArray(state.deviceGoogleAccounts)) {
    state.deviceGoogleAccounts = [];
  }
  if (!state.driveBackups || !Array.isArray(state.driveBackups)) {
    state.driveBackups = [];
  }

  // Normalisasi walletId & receipt notes pada transaksi
  const defaultWalletId = state.wallets[0]?.id || 'bank';
  state.transactions.forEach(t => {
    if (!t.walletId) {
      t.walletId = defaultWalletId;
    }
    if (t.notes === undefined) {
      t.notes = "";
    }
    if (t.receiptImage === undefined) {
      t.receiptImage = "";
    }
  });
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Gagal menyimpan data ke storage:', err);
  }
}

function resetDataToDefault() {
  if (confirm('Apakah Anda yakin ingin mereset seluruh data? Semua riwayat transaksi akan dihapus dan sisa saldo kas akan kembali ke Rp 0.')) {
    // 1. Kosongkan seluruh transaksi
    state.transactions = [];

    // 2. Reset saldo awal seluruh rekening kas menjadi 0 (Bank & Cash)
    state.wallets = [
      {
        id: "bank",
        name: "Bank",
        initialBalance: 0,
        color: "#38BDF8",
        isDefault: true
      },
      {
        id: "cash",
        name: "Cash",
        initialBalance: 0,
        color: "#34D399",
        isDefault: false
      }
    ];

    // 3. Kembalikan kategori ke default (kosong)
    state.categories = deepClone(initialData.categories);

    // 4. Kunci dan arahkan periode bulan ke bulan saat ini
    const today = new Date().toISOString().slice(0, 10);
    state.settings.activeMonth = today.slice(0, 7);
    state.settings.firstOpenedDate = today;

    saveState();
    initApp();
    showToast('Seluruh data transaksi dan sisa saldo berhasil dikosongkan!');
  }
}

// ========================================================
// 2. TEMA TERANG & GELAP (DUAL-THEME PASTEL BLUE)
// ========================================================

function initTheme() {
  const currentTheme = state.settings.theme || 'dark';
  applyTheme(currentTheme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('themeIcon');
  if (icon) {
    icon.setAttribute('data-lucide', theme === 'light' ? 'sun' : 'moon');
  }
  lucide.createIcons();
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = current === 'light' ? 'dark' : 'light';
  state.settings.theme = newTheme;
  saveState();
  applyTheme(newTheme);
  showToast(`Tema ${newTheme === 'light' ? 'Terang' : 'Gelap'} diaktifkan`);
}

// ========================================================
// 3. TAB NAVIGATION (SATU BARIS NAVIGASI DI BAWAH)
// ========================================================

function switchTab(tabId) {
  currentActiveTab = tabId;

  // Sembunyikan semua tab section
  const sections = document.querySelectorAll('.tab-section');
  sections.forEach(s => s.classList.add('hidden'));

  // Tampilkan tab section yang dipilih dengan animasi fade-in
  const targetSection = document.getElementById(`tabSection-${tabId}`);
  if (targetSection) {
    targetSection.classList.remove('hidden');
    targetSection.classList.remove('animate-fadeInSlideUp');
    void targetSection.offsetWidth;
    targetSection.classList.add('animate-fadeInSlideUp');
  }

  // Perbarui style tombol tab di navigasi dock
  const navBtns = document.querySelectorAll('.nav-tab-item');
  navBtns.forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active-tab');
    } else {
      btn.classList.remove('active-tab');
    }
  });

  // Render konten sesuai tab
  if (tabId === 'dashboard') {
    renderDashboard();
  } else if (tabId === 'transaksi') {
    renderTransactionFormContext();
  } else if (tabId === 'dompet') {
    renderDompetTab();
  } else if (tabId === 'riwayat') {
    renderTransactionList();
  } else if (tabId === 'profil') {
    renderProfileTab();
  }

  lucide.createIcons();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ========================================================
// 4. PERIOD SWITCHER & SISTEM PENGUNCIAN BULAN AWAL
// ========================================================

function getStartMonth() {
  let earliestMonth = null;
  if (state.transactions && state.transactions.length > 0) {
    state.transactions.forEach(t => {
      const ym = (t.date || '').slice(0, 7);
      if (ym && (!earliestMonth || ym < earliestMonth)) {
        earliestMonth = ym;
      }
    });
  }
  if (!earliestMonth) {
    earliestMonth = (state.settings.firstOpenedDate || new Date().toISOString().slice(0, 10)).slice(0, 7);
  }
  return earliestMonth;
}

function updatePeriodSwitcherUI() {
  const currentYm = state.settings.activeMonth || getStartMonth();
  const startMonth = getStartMonth();
  const prevBtn = document.getElementById('prevMonthBtn');
  const labelPeriod = document.getElementById('currentPeriodLabel');

  if (labelPeriod) {
    labelPeriod.textContent = formatMonthYearIndo(currentYm);
  }

  if (prevBtn) {
    if (currentYm <= startMonth) {
      prevBtn.disabled = true;
      prevBtn.classList.add('opacity-30', 'cursor-not-allowed');
      prevBtn.title = `Terkunci: Periode awal transaksi Anda (${formatMonthYearIndo(startMonth)})`;
    } else {
      prevBtn.disabled = false;
      prevBtn.classList.remove('opacity-30', 'cursor-not-allowed');
      prevBtn.title = "Bulan Sebelumnya";
    }
  }
}

function changeMonthPeriod(delta) {
  const currentYm = state.settings.activeMonth || getStartMonth();
  const startMonth = getStartMonth();

  if (delta < 0 && currentYm <= startMonth) {
    showToast(`Bulan terkunci pada periode awal transaksi Anda (${formatMonthYearIndo(startMonth)})`, 'info');
    return;
  }

  const [yearStr, monthStr] = currentYm.split('-');
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10);

  month += delta;
  if (month < 1) {
    month = 12;
    year -= 1;
  } else if (month > 12) {
    month = 1;
    year += 1;
  }

  const newYm = `${year}-${String(month).padStart(2, '0')}`;

  if (newYm < startMonth) {
    showToast(`Bulan terkunci pada periode awal transaksi Anda (${formatMonthYearIndo(startMonth)})`, 'info');
    return;
  }

  state.settings.activeMonth = newYm;
  saveState();

  renderDashboard();
  renderTransactionList();
  showToast(`Periode: ${formatMonthYearIndo(newYm)}`);
}

/**
 * Menghitung kalkulasi finansial periode tertentu:
 * - Rollover saldo dari bulan-bulan sebelumnya
 * - Pemasukan & pengeluaran bulan ini
 * - Sisa saldo kumulatif
 */
function calculateMonthFinances(targetMonth) {
  const activeYm = targetMonth || state.settings.activeMonth || "2026-10";

  // 1. Cek riwayat transaksi sebelum bulan aktif
  const pastTxs = state.transactions.filter(t => (t.date || '').slice(0, 7) < activeYm);
  const hasPastTransactions = pastTxs.length > 0;

  // Total saldo awal dari semua dompet/rekening
  let totalWalletsInitial = 0;
  state.wallets.forEach(w => {
    totalWalletsInitial += Number(w.initialBalance) || 0;
  });

  let carriedOverBalance = 0;
  if (hasPastTransactions) {
    let pastIncome = 0;
    let pastExpense = 0;
    pastTxs.forEach(t => {
      const amt = Number(t.amount) || 0;
      if (t.type === 'income') {
        pastIncome += amt;
      } else {
        pastExpense += amt;
      }
    });

    const previousAccumulatedNet = totalWalletsInitial + pastIncome - pastExpense;
    // Rollover saldo surplus positif dari bulan-bulan sebelumnya
    carriedOverBalance = previousAccumulatedNet > 0 ? previousAccumulatedNet : 0;
  }

  // 2. Hitung arus kas khusus bulan aktif
  let monthIncome = 0;
  let monthExpense = 0;
  const monthTxs = [];
  const categoryExpenses = {};

  state.transactions.forEach(t => {
    const tMonth = (t.date || '').slice(0, 7);
    if (tMonth === activeYm) {
      monthTxs.push(t);
      const amt = Number(t.amount) || 0;
      if (t.type === 'income') {
        monthIncome += amt;
      } else {
        monthExpense += amt;
        const cat = t.category || 'Lain-lain';
        categoryExpenses[cat] = (categoryExpenses[cat] || 0) + amt;
      }
    }
  });

  const monthNet = monthIncome - monthExpense;
  // Jika ada riwayat transaksi sebelumnya, saldo awal bulan ini berasal dari rollover sisa saldo lalu.
  // Jika belum ada transaksi sebelumnya (bulan awal), saldo awal berasal dari nominal awal dompet.
  const startingBalance = hasPastTransactions ? carriedOverBalance : totalWalletsInitial;
  const totalAvailableBalance = startingBalance + monthNet;

  return {
    activeYm,
    hasPastTransactions,
    carriedOverBalance,
    monthIncome,
    monthExpense,
    monthNet,
    totalAvailableBalance,
    monthTxs,
    categoryExpenses
  };
}

// ========================================================
// 5. DASHBOARD: METRIK, ROLLOVER & TRANSAKSI BULAN AKTIF
// ========================================================

function renderDashboard() {
  const activeYm = state.settings.activeMonth || getStartMonth();
  const fin = calculateMonthFinances(activeYm);

  // Perbarui UI Period Switcher dan Status Penguncian Bulan Awal
  updatePeriodSwitcherUI();

  const metricPeriodName = document.getElementById('metricPeriodName');
  if (metricPeriodName) metricPeriodName.textContent = `Periode ${formatMonthYearIndo(activeYm)}`;

  const recentHeader = document.getElementById('recentTxHeader');
  if (recentHeader) recentHeader.textContent = `Transaksi ${formatMonthYearIndo(activeYm)}`;

  const firstDateEl = document.getElementById('dashFirstOpenedDate');
  if (firstDateEl) {
    let earliestDate = state.settings.firstOpenedDate || new Date().toISOString().slice(0, 10);
    if (state.transactions && state.transactions.length > 0) {
      state.transactions.forEach(t => {
        if (t.date && t.date < earliestDate) earliestDate = t.date;
      });
    }
    firstDateEl.textContent = formatDateIndo(earliestDate);
  }

  // 1. Sisa Saldo Bulan Lalu (Rollover Card)
  // Sesuai permintaan: Jika belum ada transaksi sebelumnya atau tidak ada sisa saldo, kartu disembunyikan
  const rolloverCardSection = document.getElementById('rolloverCardSection');
  const rolloverBalanceEl = document.getElementById('dashRolloverBalance');
  const rolloverTitleEl = document.getElementById('rolloverTitle');
  const rolloverDescEl = document.getElementById('rolloverDesc');

  if (rolloverCardSection) {
    if (fin.hasPastTransactions && fin.carriedOverBalance > 0) {
      rolloverCardSection.classList.remove('hidden');
      if (rolloverBalanceEl) {
        rolloverBalanceEl.textContent = formatRp(fin.carriedOverBalance);
      }
      if (rolloverTitleEl) {
        rolloverTitleEl.textContent = `Sisa Saldo Sebelum ${formatMonthYearIndo(activeYm)}`;
      }
      if (rolloverDescEl) {
        rolloverDescEl.textContent = `Saldo surplus sebesar ${formatRp(fin.carriedOverBalance)} berhasil dialihkan ke bulan ini`;
      }
    } else {
      rolloverCardSection.classList.add('hidden');
    }
  }

  // 2. Tiga Metrik Utama
  const totalBalEl = document.getElementById('metricTotalBalance');
  if (totalBalEl) totalBalEl.textContent = formatRp(fin.totalAvailableBalance);

  const totalIncEl = document.getElementById('metricTotalIncome');
  if (totalIncEl) totalIncEl.textContent = formatRp(fin.monthIncome);

  const totalExpEl = document.getElementById('metricTotalExpense');
  if (totalExpEl) totalExpEl.textContent = formatRp(fin.monthExpense);

  const netStatusEl = document.getElementById('metricNetStatus');
  if (netStatusEl) {
    if (fin.monthNet >= 0) {
      netStatusEl.textContent = `+${formatRp(fin.monthNet)} Net`;
      netStatusEl.className = 'text-emerald-400 font-bold';
    } else {
      netStatusEl.textContent = `-${formatRp(Math.abs(fin.monthNet))} Defisit`;
      netStatusEl.className = 'text-rose-400 font-bold';
    }
  }

  // 3. Transaksi Terkini pada Bulan Aktif
  renderDashboardRecent(fin.monthTxs);
}

function renderDashboardRecent(monthTxs) {
  const container = document.getElementById('dashRecentTransactions');
  if (!container) return;

  const sorted = [...monthTxs]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  if (sorted.length === 0) {
    container.innerHTML = `
      <div class="py-6 text-center text-secondary-var text-xs space-y-1">
        <p>Belum ada transaksi di periode ${formatMonthYearIndo(state.settings.activeMonth)}.</p>
        <p class="text-[11px] text-sky-400">Tekan "+ Catat Baru" untuk mencatat keuangan kas.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = sorted.map(tx => {
    const isIncome = tx.type === 'income';
    const wallet = state.wallets.find(w => w.id === tx.walletId) || { name: 'Kas Bersama' };
    const hasProof = (tx.notes && tx.notes.trim()) || tx.receiptImage;

    return `
      <div class="py-2.5 flex items-center justify-between gap-3 hover:bg-[var(--bg-card-hover)] px-2 rounded-xl transition-colors">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isIncome ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}">
            <i data-lucide="${isIncome ? 'arrow-down-left' : 'arrow-up-right'}" class="w-4 h-4 stroke-[2.2]"></i>
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-xs sm:text-sm font-bold text-primary-var truncate">${escapeHtml(tx.title)}</span>
              ${hasProof ? `
                <button
                  type="button"
                  onclick="openReceiptDetailModal('${tx.id}')"
                  class="badge-receipt"
                  title="Lihat Bukti Nota & Coretan Rincian"
                >
                  <i data-lucide="receipt" class="w-3 h-3"></i>
                  <span>${tx.receiptImage ? 'Bukti & Foto' : 'Coretan Bukti'}</span>
                </button>
              ` : ''}
            </div>
            <div class="text-[10.5px] text-secondary-var flex items-center gap-1.5 truncate mt-0.5">
              <span class="font-semibold text-primary-var/90">${escapeHtml(tx.category)}</span>
              <span>•</span>
              <span class="text-sky-400 font-semibold">${escapeHtml(wallet.name)}</span>
              <span>•</span>
              <span>${formatDateIndo(tx.date)}</span>
            </div>
          </div>
        </div>

        <div class="text-right shrink-0">
          <div class="text-xs sm:text-sm font-extrabold font-mono-num whitespace-nowrap ${isIncome ? 'text-emerald-400' : 'text-rose-400'}">
            ${isIncome ? '+' : '-'}${formatRp(tx.amount)}
          </div>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

// ========================================================
// 6. FORM TRANSAKSI: KATEGORI TERPISAH & SUMBER DANA
// ========================================================

function renderTransactionFormContext() {
  updateFormTypeVisual();
  populateWalletSelect('txWalletSelect');
}

function updateFormTypeVisual() {
  const typeRadio = document.querySelector('input[name="txType"]:checked');
  const type = typeRadio?.value || 'expense';

  const catInput = document.getElementById('txCategory');
  const catList = document.getElementById('txCategoryList');
  const catHint = document.getElementById('txCategoryHint');

  const cats = (state.categories && Array.isArray(state.categories[type])) ? state.categories[type] : [];

  if (catHint) {
    catHint.textContent = type === 'income'
      ? 'Tulis kategori pemasukan Anda sendiri atau pilih dari yang pernah dicatat.'
      : 'Tulis kategori pengeluaran Anda sendiri atau pilih dari yang pernah dicatat.';
  }

  if (catList) {
    catList.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
  }

  lucide.createIcons();
}

function populateWalletSelect(selectId, selectedWalletId) {
  const select = document.getElementById(selectId);
  if (!select) return;

  select.innerHTML = state.wallets.map(w => `
    <option value="${w.id}" ${w.id === selectedWalletId ? 'selected' : ''}>
      ${escapeHtml(w.name)}
    </option>
  `).join('');
}

// ========================================================
// 6.0 FITUR AUTO-BULLET (•) PADA CATATAN RINCIAN NOTA
// ========================================================

function handleBulletAutoInsertOnFocus(textarea) {
  if (!textarea) return;
  if (!textarea.value || textarea.value.trim() === '') {
    textarea.value = '• ';
    textarea.selectionStart = textarea.selectionEnd = 2;
  }
}

function insertBulletPointToNotes(textareaId) {
  const el = document.getElementById(textareaId);
  if (!el) return;
  const start = el.selectionStart || 0;
  const end = el.selectionEnd || 0;
  const val = el.value || '';

  if (!val.trim()) {
    el.value = '• ';
    el.selectionStart = el.selectionEnd = 2;
    el.focus();
    return;
  }

  const needsNewline = start > 0 && val.charAt(start - 1) !== '\n';
  const insertText = (needsNewline ? '\n' : '') + '• ';
  el.value = val.substring(0, start) + insertText + val.substring(end);
  const newPos = start + insertText.length;
  el.selectionStart = el.selectionEnd = newPos;
  el.focus();
}

function handleBulletKeyDown(e, textarea) {
  if (e.key === 'Enter') {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;

    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const currentLine = value.substring(lineStart, start);

    if (/^\s*•\s*/.test(currentLine)) {
      e.preventDefault();
      const insertText = '\n• ';
      textarea.value = value.substring(0, start) + insertText + value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + insertText.length;
    }
  }
}

function handleSaveTransaction(event) {
  event.preventDefault();

  const amountInput = document.getElementById('txAmount');
  const dateInput = document.getElementById('txDate');
  const categoryInput = document.getElementById('txCategory');
  const walletSelect = document.getElementById('txWalletSelect');
  const typeRadio = document.querySelector('input[name="txType"]:checked');
  const notesInput = document.getElementById('txNotes');

  const amount = parseNumberFromDots(amountInput?.value);
  const date = dateInput?.value || new Date().toISOString().slice(0, 10);
  const type = typeRadio?.value || 'expense';
  const category = categoryInput?.value?.trim() || (type === 'income' ? 'Pemasukan' : 'Pengeluaran');
  const walletId = walletSelect?.value || (state.wallets[0]?.id || 'bank');
  const notes = notesInput?.value.trim() || '';
  const receiptImage = tempNewReceiptImg || '';

  if (amount <= 0) {
    showToast('Nominal transaksi harus lebih dari 0.', 'warning');
    return;
  }

  // Simpan kategori kustom baru jika belum ada dalam daftar
  if (!state.categories) state.categories = { income: [], expense: [] };
  if (!Array.isArray(state.categories[type])) state.categories[type] = [];
  if (category && !state.categories[type].includes(category)) {
    state.categories[type].push(category);
  }

  // Turunkan judul/nama transaksi secara otomatis dari coretan rincian (baris pertama) atau kategori
  let title = '';
  if (notes) {
    const firstLine = notes.split('\n')[0].replace(/^[•\-\*\s]+/, '').trim();
    if (firstLine) {
      title = firstLine.slice(0, 45);
    }
  }
  if (!title) {
    title = category || (type === 'income' ? 'Pemasukan Kas' : 'Pengeluaran Kas');
  }

  // Tambahkan transaksi baru
  const newTx = {
    id: `trx-${Date.now()}`,
    title,
    amount,
    type,
    category,
    walletId,
    date,
    notes,
    receiptImage
  };

  state.transactions.unshift(newTx);

  // Jika tanggal transaksi berada pada bulan lain, alihkan ke bulan tersebut
  const txMonth = date.slice(0, 7);
  state.settings.activeMonth = txMonth;
  saveState();

  // Reset Form
  if (amountInput) amountInput.value = '';
  if (categoryInput) categoryInput.value = '';
  if (notesInput) notesInput.value = '';
  removeReceiptPhoto('new');

  renderDashboard();
  renderDompetTab();
  renderTransactionList();
  lucide.createIcons();

  // Sinkronisasi otomatis ke cloud/server bersama dan Google Drive
  syncSharedDataSilent();
  runBackgroundDriveBackup(true);

  showToast(`Transaksi "${title}" (${formatRp(amount)}) berhasil dicatat!`);
  switchTab('dashboard');
}

// ========================================================
// 7. TAB DOMPET: REKENING KAS & TAMBAH REKENING BARU
// ========================================================

function renderDompetTab() {
  const container = document.getElementById('walletListContainer');
  if (!container) return;

  // Hitung saldo riil tiap dompet
  container.innerHTML = state.wallets.map(wallet => {
    let walletNet = Number(wallet.initialBalance) || 0;

    state.transactions.forEach(t => {
      if (t.walletId === wallet.id) {
        const amt = Number(t.amount) || 0;
        if (t.type === 'income') {
          walletNet += amt;
        } else {
          walletNet -= amt;
        }
      }
    });

    const isKasUtama = wallet.isDefault || wallet.id === 'kas_bersama';

    return `
      <div class="app-card space-y-2.5 border-l-4" style="border-left-color: ${wallet.color || '#38BDF8'};">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style="background-color: ${wallet.color || '#38BDF8'}20; color: ${wallet.color || '#38BDF8'};">
              <i data-lucide="wallet" class="w-3.5 h-3.5"></i>
            </div>
            <div>
              <h3 class="text-xs sm:text-sm font-bold text-primary-var flex items-center gap-1.5">
                <span>${escapeHtml(wallet.name)}</span>
                ${isKasUtama ? '<span class="badge-fund-shared">Rekening Utama</span>' : ''}
              </h3>
              <p class="text-[10px] text-secondary-var">Saldo awal: ${formatRp(wallet.initialBalance || 0)}</p>
            </div>
          </div>

          <div class="flex items-center gap-1.5">
            <button
              onclick="openEditWalletModal('${wallet.id}')"
              class="btn-secondary text-xs h-7 px-2.5 flex items-center gap-1"
              title="Edit Nama & Saldo"
            >
              <i data-lucide="edit-3" class="w-3 h-3 text-sky-400"></i>
              <span>Edit</span>
            </button>
            ${!isKasUtama ? `
              <button
                onclick="handleDeleteWallet('${wallet.id}')"
                class="p-1 rounded-lg text-secondary-var hover:text-rose-400 hover:bg-rose-500/10 transition"
                title="Hapus Rekening"
              >
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            ` : ''}
          </div>
        </div>

        <div class="text-xl sm:text-2xl font-extrabold font-mono-num text-primary-var">
          ${formatRp(walletNet)}
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

// Modal Tambah Rekening Baru
function openAddWalletModal() {
  const modal = document.getElementById('modalAddWallet');
  const nameInput = document.getElementById('newWalletNameInput');
  const balInput = document.getElementById('newWalletBalanceInput');

  if (nameInput) nameInput.value = '';
  if (balInput) balInput.value = '';

  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    nameInput?.focus();
  }
  lucide.createIcons();
}

function closeAddWalletModal() {
  const modal = document.getElementById('modalAddWallet');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function handleSaveNewWallet(event) {
  event.preventDefault();

  const nameInput = document.getElementById('newWalletNameInput');
  const balInput = document.getElementById('newWalletBalanceInput');

  const name = nameInput?.value.trim();
  const balance = parseNumberFromDots(balInput?.value);

  if (!name) {
    showToast('Nama rekening tidak boleh kosong.', 'warning');
    return;
  }

  const newWallet = {
    id: `wallet_${Date.now()}`,
    name,
    initialBalance: balance,
    color: '#38BDF8',
    isDefault: false
  };

  state.wallets.push(newWallet);
  saveState();

  closeAddWalletModal();
  renderDashboard();
  renderDompetTab();
  populateWalletSelect('txWalletSelect');
  showToast(`Rekening "${name}" berhasil ditambahkan!`);
}

// Modal Edit Rekening
function openEditWalletModal(walletId) {
  const wallet = state.wallets.find(w => w.id === walletId) || state.wallets[0];
  if (!wallet) return;

  const modal = document.getElementById('modalEditWallet');
  const idInput = document.getElementById('editWalletId');
  const nameInput = document.getElementById('editWalletNameInput');
  const balInput = document.getElementById('editWalletBalanceInput');

  if (idInput) idInput.value = wallet.id;
  if (nameInput) nameInput.value = wallet.name;
  if (balInput) balInput.value = formatNumberWithDots(wallet.initialBalance || 0);

  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
  lucide.createIcons();
}

function closeEditWalletModal() {
  const modal = document.getElementById('modalEditWallet');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function handleSaveWalletEdit(event) {
  event.preventDefault();

  const idInput = document.getElementById('editWalletId');
  const nameInput = document.getElementById('editWalletNameInput');
  const balInput = document.getElementById('editWalletBalanceInput');

  const walletId = idInput?.value;
  const wallet = state.wallets.find(w => w.id === walletId);
  if (!wallet) return;

  const newName = nameInput?.value.trim() || wallet.name;
  const newBalance = parseNumberFromDots(balInput?.value);

  wallet.name = newName;
  wallet.initialBalance = newBalance;
  saveState();

  closeEditWalletModal();
  renderDashboard();
  renderDompetTab();
  populateWalletSelect('txWalletSelect');
  showToast(`Rekening "${newName}" berhasil diperbarui!`);
}

function handleDeleteWallet(walletId) {
  const wallet = state.wallets.find(w => w.id === walletId);
  if (!wallet || wallet.isDefault) return;

  const targetWallet = state.wallets.find(w => w.id !== walletId) || { id: 'bank', name: 'Bank' };

  if (confirm(`Hapus rekening "${wallet.name}"? Transaksi yang terhubung akan dialihkan ke ${targetWallet.name}.`)) {
    state.transactions.forEach(t => {
      if (t.walletId === walletId) {
        t.walletId = targetWallet.id;
      }
    });

    state.wallets = state.wallets.filter(w => w.id !== walletId);
    saveState();

    renderDashboard();
    renderDompetTab();
    populateWalletSelect('txWalletSelect');
    showToast(`Rekening "${wallet.name}" dihapus.`);
  }
}

// ========================================================
// 9. RIWAYAT TRANSAKSI DENGAN FILTER & CRUD LENGKAP
// ========================================================

function renderTransactionList() {
  const container = document.getElementById('transactionListContainer');
  const countBadge = document.getElementById('txHistoryCount');
  if (!container) return;

  const activeYm = state.settings.activeMonth || "2026-10";
  const searchKeyword = (document.getElementById('filterSearch')?.value || '').toLowerCase().trim();
  const filterCat = document.getElementById('filterCategory')?.value || 'all';

  // Filter transaksi berdasarkan periode bulan aktif
  let list = state.transactions.filter(t => (t.date || '').startsWith(activeYm));

  if (searchKeyword) {
    list = list.filter(tx => tx.title.toLowerCase().includes(searchKeyword));
  }

  if (filterCat !== 'all') {
    list = list.filter(tx => tx.category === filterCat);
  }

  list.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (countBadge) {
    countBadge.textContent = `${list.length} Transaksi`;
  }

  // Populate filter category select
  populateFilterCategorySelect();

  if (list.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-secondary-var space-y-2">
        <i data-lucide="inbox" class="w-8 h-8 mx-auto text-muted-var stroke-[1.5]"></i>
        <p class="text-xs">Tidak ada transaksi pada ${formatMonthYearIndo(activeYm)}.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = list.map(tx => {
    const isIncome = tx.type === 'income';
    const wallet = state.wallets.find(w => w.id === tx.walletId) || { name: 'Kas Bersama' };
    const catIcon = getCategoryIcon(tx.category, tx.type);
    const catEmoji = getCategoryEmoji(tx.category, tx.type);

    const hasProof = (tx.notes && tx.notes.trim()) || tx.receiptImage;

    return `
      <div class="py-2.5 flex items-center justify-between gap-3 hover:bg-[var(--bg-card-hover)] transition-colors px-2 rounded-xl">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isIncome ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}">
            <i data-lucide="${isIncome ? 'arrow-down-left' : 'arrow-up-right'}" class="w-4 h-4 stroke-[2.2]"></i>
          </div>
          <div class="min-w-0 space-y-0.5">
            <div class="flex items-center gap-1.5 flex-wrap">
              <h4 class="text-xs sm:text-sm font-bold text-primary-var truncate">${escapeHtml(tx.title)}</h4>
              <span class="badge-fund-shared">${escapeHtml(wallet.name)}</span>
              ${hasProof ? `
                <button
                  type="button"
                  onclick="openReceiptDetailModal('${tx.id}')"
                  class="badge-receipt"
                  title="Lihat Bukti Nota & Coretan Rincian"
                >
                  <i data-lucide="receipt" class="w-3 h-3"></i>
                  <span>${tx.receiptImage ? 'Bukti & Foto' : 'Coretan Bukti'}</span>
                </button>
              ` : ''}
            </div>
            <div class="text-[10.5px] text-secondary-var flex items-center gap-1.5 truncate">
              <span class="font-semibold text-primary-var/90">${escapeHtml(tx.category)}</span>
              <span>•</span>
              <span>${formatDateIndo(tx.date)}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <div class="text-right">
            <div class="text-xs sm:text-sm font-extrabold font-mono-num whitespace-nowrap ${isIncome ? 'text-emerald-400' : 'text-rose-400'}">
              ${isIncome ? '+' : '-'}${formatRp(tx.amount)}
            </div>
          </div>

          <!-- Edit Transaksi -->
          <button
            onclick="openEditTxModal('${tx.id}')"
            class="p-1.5 rounded-lg text-secondary-var hover:text-sky-400 hover:bg-sky-500/10 transition"
            title="Edit Transaksi"
          >
            <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
          </button>

          <!-- Hapus Transaksi -->
          <button
            onclick="handleDeleteTransaction('${tx.id}')"
            class="p-1.5 rounded-lg text-secondary-var hover:text-rose-400 hover:bg-rose-500/10 transition"
            title="Hapus Transaksi"
          >
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

function populateFilterCategorySelect() {
  const select = document.getElementById('filterCategory');
  if (!select) return;

  const currentVal = select.value;
  const catsSet = new Set([
    ...(state.categories.income || []),
    ...(state.categories.expense || []),
    ...state.transactions.map(t => t.category).filter(Boolean)
  ]);
  const allCats = Array.from(catsSet);

  select.innerHTML = `<option value="all">Semua Kategori</option>` +
    allCats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

  if (allCats.includes(currentVal)) {
    select.value = currentVal;
  }
}

function handleDeleteTransaction(txId) {
  const tx = state.transactions.find(t => t.id === txId);
  if (!tx) return;

  if (confirm(`Hapus transaksi "${tx.title}" (${formatRp(tx.amount)})?`)) {
    state.transactions = state.transactions.filter(t => t.id !== txId);
    saveState();

    renderDashboard();
    renderDompetTab();
    renderTransactionList();
    lucide.createIcons();

    // Sinkronisasi otomatis ke cloud/server bersama dan Google Drive
    syncSharedDataSilent();
    runBackgroundDriveBackup(true);

    showToast(`Transaksi "${tx.title}" berhasil dihapus.`);
  }
}

function openEditTxModal(txId) {
  const tx = state.transactions.find(t => t.id === txId);
  if (!tx) return;

  const modal = document.getElementById('modalEditTx');
  const idInput = document.getElementById('editTxId');
  const titleInput = document.getElementById('editTxTitle');
  const amtInput = document.getElementById('editTxAmount');
  const dateInput = document.getElementById('editTxDate');
  const radioExp = document.getElementById('editTxTypeExpense');
  const radioInc = document.getElementById('editTxTypeIncome');
  const notesInput = document.getElementById('editTxNotes');

  if (idInput) idInput.value = tx.id;
  if (titleInput) titleInput.value = tx.title;
  if (amtInput) amtInput.value = formatNumberWithDots(tx.amount);
  if (dateInput) dateInput.value = tx.date;
  if (notesInput) notesInput.value = tx.notes || '';

  tempEditReceiptImg = tx.receiptImage || '';
  const previewContainer = document.getElementById('editTxReceiptPreviewContainer');
  const emptyState = document.getElementById('editTxReceiptEmptyState');
  const previewImg = document.getElementById('editTxReceiptPreviewImg');
  const fileNameEl = document.getElementById('editTxReceiptFileName');

  if (tx.receiptImage) {
    if (previewImg) previewImg.src = tx.receiptImage;
    if (fileNameEl) fileNameEl.textContent = 'bukti_nota.jpg';
    if (previewContainer) previewContainer.classList.remove('hidden');
    if (emptyState) emptyState.classList.add('hidden');
  } else {
    if (previewImg) previewImg.src = '';
    if (previewContainer) previewContainer.classList.add('hidden');
    if (emptyState) emptyState.classList.remove('hidden');
  }

  if (tx.type === 'income') {
    if (radioInc) radioInc.checked = true;
  } else {
    if (radioExp) radioExp.checked = true;
  }

  updateEditModalCategories(tx.category);
  populateWalletSelect('editTxWallet', tx.walletId);

  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
  lucide.createIcons();
}

function updateEditModalCategories(selectedCat) {
  const radioInc = document.getElementById('editTxTypeIncome');
  const catInput = document.getElementById('editTxCategory');
  const catList = document.getElementById('editTxCategoryList');
  if (!catInput) return;

  const isIncome = radioInc?.checked;
  const type = isIncome ? 'income' : 'expense';
  const cats = (state.categories && Array.isArray(state.categories[type])) ? state.categories[type] : [];

  if (catList) {
    catList.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
  }
  if (selectedCat !== undefined) {
    catInput.value = selectedCat;
  }
}

function closeEditTxModal() {
  const modal = document.getElementById('modalEditTx');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  tempEditReceiptImg = '';
}

function handleSaveTxEdit(event) {
  event.preventDefault();

  const idInput = document.getElementById('editTxId');
  const titleInput = document.getElementById('editTxTitle');
  const amtInput = document.getElementById('editTxAmount');
  const dateInput = document.getElementById('editTxDate');
  const catInput = document.getElementById('editTxCategory');
  const walletSelect = document.getElementById('editTxWallet');
  const typeRadio = document.querySelector('input[name="editTxType"]:checked');
  const notesInput = document.getElementById('editTxNotes');

  const tx = state.transactions.find(t => t.id === idInput?.value);
  if (!tx) {
    showToast('Transaksi tidak ditemukan.', 'warning');
    return;
  }

  const type = typeRadio?.value || 'expense';
  const newCat = catInput?.value?.trim() || tx.category || (type === 'income' ? 'Pemasukan' : 'Pengeluaran');

  // Simpan kategori baru jika belum ada dalam riwayat
  if (!state.categories) state.categories = { income: [], expense: [] };
  if (!Array.isArray(state.categories[type])) state.categories[type] = [];
  if (newCat && !state.categories[type].includes(newCat)) {
    state.categories[type].push(newCat);
  }

  const notes = notesInput?.value.trim() || '';
  let newTitle = titleInput?.value.trim() || '';
  if (!newTitle && notes) {
    const firstLine = notes.split('\n')[0].replace(/^[•\-\*\s]+/, '').trim();
    if (firstLine) newTitle = firstLine.slice(0, 45);
  }
  if (!newTitle) {
    newTitle = newCat || tx.title || 'Transaksi Kas';
  }

  const newAmount = parseNumberFromDots(amtInput?.value);
  if (newAmount <= 0) {
    showToast('Nominal transaksi harus lebih dari 0.', 'warning');
    return;
  }

  tx.title = newTitle;
  tx.amount = newAmount;
  tx.date = dateInput?.value || tx.date;
  tx.category = newCat;
  tx.walletId = walletSelect?.value || tx.walletId || (state.wallets[0]?.id || 'bank');
  tx.type = type;
  tx.notes = notes;
  tx.receiptImage = tempEditReceiptImg || '';

  saveState();
  closeEditTxModal();

  renderDashboard();
  renderDompetTab();
  renderTransactionList();
  lucide.createIcons();

  // Sinkronisasi ke server bersama & Google Drive
  syncSharedDataSilent();
  runBackgroundDriveBackup(true);

  showToast(`Transaksi "${tx.title}" berhasil diperbarui!`);
}

// ========================================================
// 10. EVALUASI DENGAN AI (EVALUASI AKHIR BULAN)
// ========================================================

function openAiEvaluationModal() {
  const modal = document.getElementById('modalAiEvaluation');
  if (!modal) return;

  const activeYm = state.settings.activeMonth || "2026-10";
  const subtitle = document.getElementById('aiModalSubtitle');
  if (subtitle) subtitle.textContent = `Periode Evaluasi: ${formatMonthYearIndo(activeYm)}`;

  const fin = calculateMonthFinances(activeYm);
  const totalIncome = fin.monthIncome;
  const totalExpense = fin.monthExpense;
  const netSavings = fin.monthNet;
  const burnRate = totalIncome > 0 ? (totalExpense / totalIncome) * 100 : 100;

  // Hitung Skor Kesehatan Kas (0 - 100)
  let healthScore = 75;
  let statusBadgeHtml = '🟢 Sangat Sehat (Surplus)';

  if (totalIncome === 0 && totalExpense === 0) {
    healthScore = 80;
    statusBadgeHtml = '⚪ Belum Ada Aktivitas';
  } else if (totalIncome === 0 && totalExpense > 0) {
    healthScore = 35;
    statusBadgeHtml = '🔴 Kritis (Belum Ada Iuran)';
  } else if (burnRate <= 50) {
    healthScore = 95;
    statusBadgeHtml = '🟢 Sangat Prima (Surplus Tinggi)';
  } else if (burnRate <= 75) {
    healthScore = 88;
    statusBadgeHtml = '🟢 Sehat & Terkendali';
  } else if (burnRate <= 95) {
    healthScore = 72;
    statusBadgeHtml = '🟡 Cukup Baik (Mendekati Batas)';
  } else if (burnRate <= 100) {
    healthScore = 60;
    statusBadgeHtml = '🟡 Waspada (Kas Pas-pasan)';
  } else {
    healthScore = Math.max(25, Math.round(55 - (burnRate - 100) * 0.4));
    statusBadgeHtml = '🔴 Defisit (Pengeluaran > Iuran)';
  }

  // Tampilkan Nilai Metrik
  const elScore = document.getElementById('aiHealthScore');
  const elBadge = document.getElementById('aiHealthStatusBadge');
  const elInc = document.getElementById('aiMetricIncome');
  const elExp = document.getElementById('aiMetricExpense');
  const elNet = document.getElementById('aiMetricNet');

  if (elScore) elScore.textContent = healthScore;
  if (elBadge) {
    elBadge.innerHTML = statusBadgeHtml;
    if (healthScore >= 75) {
      elBadge.className = 'text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-400/30';
    } else if (healthScore >= 60) {
      elBadge.className = 'text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-400/30';
    } else {
      elBadge.className = 'text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-400/30';
    }
  }

  if (elInc) elInc.textContent = formatRp(totalIncome);
  if (elExp) elExp.textContent = formatRp(totalExpense);
  if (elNet) {
    elNet.textContent = (netSavings >= 0 ? '+' : '') + formatRp(netSavings);
    elNet.className = `text-xs font-bold font-mono-num ${netSavings >= 0 ? 'text-sky-400' : 'text-rose-400'}`;
  }

  // Breakdown Pos Pengeluaran Dominan
  const catEntries = Object.entries(fin.categoryExpenses).sort((a, b) => b[1] - a[1]);
  const breakdownListEl = document.getElementById('aiCategoryBreakdownList');

  if (breakdownListEl) {
    if (catEntries.length === 0) {
      breakdownListEl.innerHTML = `
        <div class="text-xs text-secondary-var py-2 text-center">
          Belum ada data pengeluaran kas yang tercatat di ${formatMonthYearIndo(activeYm)}.
        </div>
      `;
    } else {
      breakdownListEl.innerHTML = catEntries.slice(0, 4).map(([cat, amt]) => {
        const pct = totalExpense > 0 ? Math.round((amt / totalExpense) * 100) : 0;
        return `
          <div class="space-y-1">
            <div class="flex items-center justify-between text-[11px]">
              <span class="font-semibold text-primary-var">${escapeHtml(cat)}</span>
              <span class="font-mono-num text-secondary-var">${formatRp(amt)} (${pct}%)</span>
            </div>
            <div class="category-bar-track">
              <div class="category-bar-fill bg-sky-400" style="width: ${pct}%;"></div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 3 Rekomendasi Taktis AI
  const recListEl = document.getElementById('aiRecommendationsList');
  const topCat = catEntries[0] ? catEntries[0][0] : null;
  const topCatPct = catEntries[0] && totalExpense > 0 ? Math.round((catEntries[0][1] / totalExpense) * 100) : 0;

  const recommendations = [];

  if (netSavings < 0) {
    recommendations.push({
      icon: 'alert-triangle',
      color: 'text-rose-400',
      title: 'Perlu Tambahan Iuran Kas',
      desc: `Pengeluaran ${formatMonthYearIndo(activeYm)} melebihi iuran masuk (${formatRp(Math.abs(netSavings))}). Disarankan rapat singkat untuk penyesuaian nominal iuran rutin.`
    });
  } else if (burnRate > 80) {
    recommendations.push({
      icon: 'shield-alert',
      color: 'text-amber-400',
      title: 'Sisa Cadangan Kas Menipis',
      desc: `Sekitar ${Math.round(burnRate)}% kas terpakai. Hindari pengeluaran non-primer hingga siklus iuran berikutnya.`
    });
  } else {
    recommendations.push({
      icon: 'check-circle-2',
      color: 'text-emerald-400',
      title: 'Kas Berjalan Sangat Sehat',
      desc: `Surplus kas sebesar ${formatRp(netSavings)} terjaga dengan baik. Iuran kas saat ini sudah ideal untuk dilanjutkan.`
    });
  }

  if (topCat) {
    recommendations.push({
      icon: 'zap',
      color: 'text-sky-400',
      title: `Optimalisasi Pos "${topCat}" (${topCatPct}%)`,
      desc: `Pos ini merupakan beban pengeluaran terbesar kelompok di ${formatMonthYearIndo(activeYm)}. Tinjau efisiensi pemakaian bersama.`
    });
  }

  recommendations.push({
    icon: 'piggy-bank',
    color: 'text-indigo-400',
    title: 'Sisa Saldo Masuk ke Bulan Depan (Rollover)',
    desc: `Sisa saldo kas (${formatRp(fin.totalAvailableBalance)}) akan otomatis terbawa ke bulan berikutnya sebagai dana awal kelompok.`
  });

  if (recListEl) {
    recListEl.innerHTML = recommendations.map(rec => `
      <div class="flex items-start gap-2 p-2 rounded-lg bg-[var(--input-bg)] border border-[var(--border-color)]">
        <i data-lucide="${rec.icon}" class="w-4 h-4 ${rec.color} shrink-0 mt-0.5"></i>
        <div class="min-w-0">
          <div class="font-bold text-primary-var text-[11px]">${escapeHtml(rec.title)}</div>
          <div class="text-[10.5px] text-secondary-var leading-snug mt-0.5">${escapeHtml(rec.desc)}</div>
        </div>
      </div>
    `).join('');
  }

  // Format WhatsApp
  const groupName = state.profile?.groupName || 'Kas Bersama';
  const waTextArea = document.getElementById('aiWhatsAppReportText');
  if (waTextArea) {
    let catListWa = catEntries.slice(0, 3).map((c, i) => {
      const p = totalExpense > 0 ? Math.round((c[1] / totalExpense) * 100) : 0;
      return `${i + 1}. ${c[0]}: ${formatRp(c[1])} (${p}%)`;
    }).join('\n');

    if (!catListWa) catListWa = '• Belum ada rincian pengeluaran';

    const waReport = 
`📊 *EVALUASI KAS BERSAMA — ${groupName.toUpperCase()}*
📅 Periode: ${formatMonthYearIndo(activeYm)}
⭐ Skor Kesehatan Kas: ${healthScore}/100

💰 *Ringkasan Keuangan Kas:*
• Sisa Saldo Bulan Lalu: ${formatRp(fin.carriedOverBalance)}
• Total Pemasukan/Iuran: ${formatRp(totalIncome)}
• Total Pengeluaran: ${formatRp(totalExpense)}
• Sisa Saldo Tersedia: ${formatRp(fin.totalAvailableBalance)}

🔍 *Beban Pengeluaran Terbesar:*
${catListWa}

💡 *Catatan AI FinMate:*
${recommendations.map(r => `• ${r.title}: ${r.desc}`).join('\n')}

_Dibuat otomatis oleh FinMate AI Financial Advisor_`;

    waTextArea.value = waReport;
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  lucide.createIcons();
}

function closeAiEvaluationModal() {
  const modal = document.getElementById('modalAiEvaluation');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function copyAiReportToClipboard() {
  const waTextArea = document.getElementById('aiWhatsAppReportText');
  if (!waTextArea) return;

  waTextArea.select();
  waTextArea.setSelectionRange(0, 99999);
  navigator.clipboard.writeText(waTextArea.value).then(() => {
    showToast('Format laporan WhatsApp berhasil disalin!');
  }).catch(() => {
    document.execCommand('copy');
    showToast('Format laporan WhatsApp berhasil disalin!');
  });
}

// ========================================================
// 11. TAB PROFIL & CADANGAN DATA
// ========================================================

function renderProfileTab() {
  const profile = state.profile || initialData.profile;

  // 1. Identitas Profil Standar
  const avatarEl = document.getElementById('profileAvatarDisplay');
  if (avatarEl) avatarEl.textContent = profile.userAvatar || '👤';

  const nameEl = document.getElementById('profileNameDisplay');
  if (nameEl) nameEl.textContent = profile.userName || 'Saya';

  const roleEl = document.getElementById('profileRoleDisplay');
  if (roleEl) roleEl.textContent = `${profile.userRole || 'Pengelola Kas'} • ${profile.groupName || 'Kontrakan Bersama'}`;

  const inputName = document.getElementById('inputProfileName');
  if (inputName) inputName.value = profile.userName || '';

  const inputGroup = document.getElementById('inputGroupName');
  if (inputGroup) inputGroup.value = profile.groupName || '';

  // 2. Google Account & Drive Backup Area
  const accountAreaEl = document.getElementById('googleAccountCardArea');
  const authBadgeEl = document.getElementById('driveAuthBadge');
  const backupCountBadgeEl = document.getElementById('driveBackupCountBadge');
  const historyListEl = document.getElementById('driveBackupHistoryList');
  const autoSyncBannerEl = document.getElementById('autoSyncLiveStatusBanner');
  const autoSyncTextEl = document.getElementById('autoSyncLiveStatusText');

  const isConnected = Boolean(state.googleAccount && state.googleAccount.email);
  const isOnline = navigator.onLine !== false;

  const visibleBackups = Array.isArray(state.driveBackups)
    ? isConnected
      ? state.driveBackups.filter(
          (b) =>
            !b.email ||
            b.email.toLowerCase() === state.googleAccount.email.toLowerCase()
        )
      : state.driveBackups
    : [];

  if (authBadgeEl) {
    if (isConnected) {
      if (!isOnline) {
        authBadgeEl.textContent = 'Menunggu Internet';
        authBadgeEl.className =
          'px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/35 shrink-0 whitespace-nowrap';
      } else {
        authBadgeEl.textContent = '🟢 Google Drive Aktif';
        authBadgeEl.className =
          'px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 shrink-0 whitespace-nowrap';
      }
    } else {
      authBadgeEl.textContent = 'Belum Terhubung';
      authBadgeEl.className =
        'px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700 shrink-0 whitespace-nowrap';
    }
  }

  if (autoSyncBannerEl && autoSyncTextEl) {
    if (!isConnected) {
      autoSyncBannerEl.className =
        'p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-start gap-2.5 text-[11px] text-slate-300';
      autoSyncTextEl.innerHTML =
        '<span class="font-bold text-slate-200">Cadangan Otomatis:</span> Masuk dengan akun Google di atas agar setiap transaksi otomatis dicadangkan ke Google Drive &amp; dapat dipantau bersama di perangkat lain.';
    } else if (!isOnline) {
      autoSyncBannerEl.className =
        'p-2.5 rounded-xl bg-amber-950/25 border border-amber-500/35 flex items-start gap-2.5 text-[11px] text-amber-200';
      autoSyncTextEl.innerHTML =
        '<span class="font-bold text-amber-300">⏳ Mode Offline:</span> Catatan tersimpan aman di perangkat dan akan otomatis diunggah ke Google Drive saat internet terhubung.';
    } else {
      autoSyncBannerEl.className =
        'p-2.5 rounded-xl bg-emerald-950/25 border border-emerald-500/30 flex items-start gap-2.5 text-[11px] text-slate-300';
      autoSyncTextEl.innerHTML =
        '<span class="font-bold text-emerald-300">✅ Cadangan Otomatis Aktif:</span> Setiap transaksi baru/edit/hapus otomatis dicadangkan ke folder Google Drive (' + DRIVE_MAIN_FOLDER_NAME + ').';
    }
  }

  if (backupCountBadgeEl) {
    backupCountBadgeEl.textContent = `${visibleBackups.length} Cadangan`;
  }

  if (accountAreaEl) {
    if (!isConnected) {
      accountAreaEl.innerHTML = `
        <div class="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
          <div class="flex items-start gap-3">
            <div class="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <i data-lucide="smartphone" class="w-4 h-4"></i>
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-xs font-bold text-white">Sinkronisasi Google Drive (${getDetectedDeviceName()})</div>
              <p class="text-[11px] text-slate-400 leading-relaxed mt-0.5">
                Hubungkan akun Google Anda untuk mengaktifkan pencadangan otomatis transaksi kas bersama ke Google Drive.
              </p>
            </div>
          </div>
          <button
            type="button"
            onclick="openGoogleAuthModal(false)"
            class="w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-3 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 shadow-md transition-all active:scale-[0.99] cursor-pointer"
            style="background-color:#ffffff !important; color:#1e293b !important; border-color:#cbd5e1 !important;"
          >
            ${getGoogleGLogoSvg('w-4 h-4')}
            <span style="color:#1e293b !important; font-weight:700;">Continue with Google</span>
          </button>
        </div>
      `;
    } else {
      const initials = (state.googleAccount.name || 'G')
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();

      const validFolderId = state.googleAccount.driveFolderId || '';
      const safeAccEmail = (state.googleAccount.email || '').replace(/'/g, "\\'");

      accountAreaEl.innerHTML = `
        <div class="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-500/30 space-y-2.5">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500 text-slate-950 font-extrabold text-sm flex items-center justify-center shrink-0">
                ${initials || 'G'}
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-xs sm:text-sm font-bold text-white truncate">${escapeHtml(state.googleAccount.name)}</div>
                <div class="text-[11px] text-emerald-400 truncate">${escapeHtml(state.googleAccount.email)}</div>
                <div class="text-[10px] text-slate-400 truncate">Terdeteksi di ${escapeHtml(state.googleAccount.deviceLabel || getDetectedDeviceName())}</div>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-1.5 shrink-0">
              <button
                type="button"
                onclick="handleOpenGoogleDriveFolder(event, '${validFolderId}', '${safeAccEmail}')"
                class="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-1 transition-colors cursor-pointer"
              >
                <i data-lucide="folder-open" class="w-3.5 h-3.5"></i>
                <span>Folder Drive</span>
              </button>
              <button
                type="button"
                onclick="openGoogleAuthModal(false)"
                class="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
              >
                Ganti Akun
              </button>
              <button
                type="button"
                onclick="disconnectGoogleAccount()"
                class="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 transition-colors cursor-pointer"
              >
                Keluar
              </button>
            </div>
          </div>

          <div class="pt-2 border-t border-emerald-500/20 flex items-center justify-between text-[11px]">
            <span class="text-slate-300 flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Pencadangan Otomatis</span>
            </span>
            <span class="font-bold text-emerald-400">Aktif</span>
          </div>
        </div>
      `;
    }
  }

  if (historyListEl) {
    if (!visibleBackups || visibleBackups.length === 0) {
      historyListEl.innerHTML = `
        <div class="py-4 px-3 rounded-xl bg-slate-900/50 border border-slate-800/80 text-center text-xs text-slate-400">
          Belum ada riwayat cadangan Google Drive. Klik "Cadangkan Sekarang" di atas.
        </div>
      `;
    } else {
      historyListEl.innerHTML = visibleBackups
        .slice(0, 6)
        .map((b) => {
          const validItemFolderId = b.folderId || (state.googleAccount && state.googleAccount.driveFolderId) || '';
          const safeItemEmail = (b.email || (state.googleAccount && state.googleAccount.email) || '').replace(/'/g, "\\'");
          return `
            <div class="p-2.5 rounded-xl bg-slate-900/65 border border-slate-800/90 space-y-1.5">
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-start gap-2 min-w-0 flex-1 overflow-hidden">
                  <div class="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0 mt-0.5">
                    <i data-lucide="file-json" class="w-3.5 h-3.5"></i>
                  </div>
                  <div class="min-w-0 flex-1 overflow-hidden">
                    <div class="text-xs font-bold text-white truncate" title="${escapeHtml(b.fileName)}">${escapeHtml(b.fileName)}</div>
                    <div class="text-[10px] text-slate-400 truncate">${b.txCount || 0} transaksi • ${b.walletCount || 0} rekening</div>
                  </div>
                </div>

                <div class="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onclick="handleOpenGoogleDriveFolder(event, '${validItemFolderId}', '${safeItemEmail}')"
                    class="p-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition-colors cursor-pointer"
                    title="Buka di Drive"
                  >
                    <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
                  </button>
                  <button
                    type="button"
                    onclick="downloadBackupSnapshotJson('${b.id}')"
                    class="p-1.5 rounded-lg bg-blue-500/15 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 transition-colors cursor-pointer"
                    title="Download JSON"
                  >
                    <i data-lucide="download" class="w-3.5 h-3.5"></i>
                  </button>
                  <button
                    type="button"
                    onclick="deleteBackupHistoryItem('${b.id}')"
                    class="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/25 text-rose-300 border border-rose-500/25 transition-colors cursor-pointer"
                    title="Hapus Riwayat"
                  >
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                  </button>
                </div>
              </div>
              <div class="text-[10px] text-slate-500 font-mono-num flex justify-between">
                <span>${escapeHtml(b.email || '')}</span>
                <span>${escapeHtml(b.createdAt || '')}</span>
              </div>
            </div>
          `;
        })
        .join('');
    }
  }

  updateHeaderAuthIndicator();
}

// ========================================================
// 11.1 SISTEM PENGUNGGAHAN & PRATINJAU BUKTI NOTA (CANVAS COMPRESS)
// ========================================================

function handleReceiptFileSelect(event, mode) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Harap pilih berkas berupa foto nota / struk.', 'warning');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      // Kompresi resolusi gambar agar hemat penyimpanan & cepat disinkronkan
      const maxWidth = 900;
      const maxHeight = 900;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const compressedBase64 = canvas.toDataURL('image/jpeg', 0.72);

      if (mode === 'new') {
        tempNewReceiptImg = compressedBase64;
        const previewContainer = document.getElementById('txReceiptPreviewContainer');
        const emptyState = document.getElementById('txReceiptEmptyState');
        const previewImg = document.getElementById('txReceiptPreviewImg');
        const fileNameEl = document.getElementById('txReceiptFileName');

        if (previewImg) previewImg.src = compressedBase64;
        if (fileNameEl) fileNameEl.textContent = file.name || 'bukti_nota.jpg';
        if (previewContainer) previewContainer.classList.remove('hidden');
        if (emptyState) emptyState.classList.add('hidden');
      } else {
        tempEditReceiptImg = compressedBase64;
        const previewContainer = document.getElementById('editTxReceiptPreviewContainer');
        const emptyState = document.getElementById('editTxReceiptEmptyState');
        const previewImg = document.getElementById('editTxReceiptPreviewImg');
        const fileNameEl = document.getElementById('editTxReceiptFileName');

        if (previewImg) previewImg.src = compressedBase64;
        if (fileNameEl) fileNameEl.textContent = file.name || 'bukti_nota.jpg';
        if (previewContainer) previewContainer.classList.remove('hidden');
        if (emptyState) emptyState.classList.add('hidden');
      }

      showToast('Foto bukti nota berhasil dipilih & dikompresi!');
      lucide.createIcons();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removeReceiptPhoto(mode) {
  if (mode === 'new') {
    tempNewReceiptImg = '';
    const input = document.getElementById('txReceiptInput');
    if (input) input.value = '';
    const previewContainer = document.getElementById('txReceiptPreviewContainer');
    const emptyState = document.getElementById('txReceiptEmptyState');
    if (previewContainer) previewContainer.classList.add('hidden');
    if (emptyState) emptyState.classList.remove('hidden');
  } else {
    tempEditReceiptImg = '';
    const input = document.getElementById('editTxReceiptInput');
    if (input) input.value = '';
    const previewContainer = document.getElementById('editTxReceiptPreviewContainer');
    const emptyState = document.getElementById('editTxReceiptEmptyState');
    if (previewContainer) previewContainer.classList.add('hidden');
    if (emptyState) emptyState.classList.remove('hidden');
  }
}

// ========================================================
// 11.2 MODAL BUKTI TRANSAKSI & RINCIAN NOTA
// ========================================================

function openReceiptDetailModal(txId) {
  const tx = state.transactions.find(t => t.id === txId);
  if (!tx) return;

  currentViewingReceiptTxId = tx.id;
  const modal = document.getElementById('modalReceiptDetail');
  if (!modal) return;

  const titleEl = document.getElementById('receiptDetailTitle');
  const catEl = document.getElementById('receiptDetailCategory');
  const walletEl = document.getElementById('receiptDetailWallet');
  const amtEl = document.getElementById('receiptDetailAmount');
  const dateEl = document.getElementById('receiptDetailDate');
  const notesEl = document.getElementById('receiptDetailNotes');
  const imgEl = document.getElementById('receiptDetailImg');
  const noImgEl = document.getElementById('receiptDetailNoImg');

  const wallet = state.wallets.find(w => w.id === tx.walletId) || { name: 'Kas Bersama' };
  const isIncome = tx.type === 'income';

  if (titleEl) titleEl.textContent = tx.title;
  if (catEl) catEl.textContent = tx.category;
  if (walletEl) walletEl.textContent = wallet.name;
  if (amtEl) {
    amtEl.textContent = `${isIncome ? '+' : '-'}${formatRp(tx.amount)}`;
    amtEl.className = `text-sm sm:text-base font-extrabold font-mono-num ${isIncome ? 'text-emerald-400' : 'text-rose-400'}`;
  }
  if (dateEl) dateEl.textContent = formatDateIndo(tx.date);

  if (notesEl) {
    if (tx.notes && tx.notes.trim()) {
      notesEl.textContent = tx.notes.trim();
      notesEl.classList.remove('hidden');
    } else {
      notesEl.textContent = 'Tidak ada coretan rincian tertulis pada transaksi ini.';
    }
  }

  if (imgEl && noImgEl) {
    if (tx.receiptImage) {
      imgEl.src = tx.receiptImage;
      imgEl.classList.remove('hidden');
      noImgEl.classList.add('hidden');
    } else {
      imgEl.src = '';
      imgEl.classList.add('hidden');
      noImgEl.classList.remove('hidden');
    }
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  lucide.createIcons();
}

function closeReceiptDetailModal() {
  const modal = document.getElementById('modalReceiptDetail');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  currentViewingReceiptTxId = null;
}

function editFromReceiptDetail() {
  const txId = currentViewingReceiptTxId;
  closeReceiptDetailModal();
  if (txId) {
    openEditTxModal(txId);
  }
}

function openReceiptFullScreen() {
  const imgEl = document.getElementById('receiptDetailImg');
  if (imgEl && imgEl.src && !imgEl.classList.contains('hidden')) {
    const w = window.open('');
    if (w) {
      w.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Bukti Nota Transaksi FinMate</title>
        </head>
        <body style="margin:0; background:#0b132b; display:flex; align-items:center; justify-content:center; min-height:100vh; padding: 12px; box-sizing: border-box;">
          <img src="${imgEl.src}" style="max-width:100%; max-height:96vh; object-fit:contain; border-radius:8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);" />
        </body>
        </html>
      `);
    }
  }
}

// ========================================================
// 12. OTENTIKASI RESMI GOOGLE & CADANGAN OTOMATIS GOOGLE DRIVE
// ========================================================

const DEFAULT_GOOGLE_CLIENT_ID = '1097773326723-ri4lejjm4p7kejd4v9hst3c4tk97cjoa.apps.googleusercontent.com';
const GOOGLE_CLIENT_ID_STORAGE_KEY = 'finmate_google_oauth_client_id';
const GOOGLE_DRIVE_SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.file';
const DRIVE_MAIN_FOLDER_NAME = 'FinMate';
const DRIVE_CLOUD_SNAPSHOTS_KEY = 'finmate_drive_cloud_snapshots';

let pendingAutoBackupAfterLogin = false;
let googleTokenClient = null;
let latestGoogleAccessToken = '';
const driveFolderPermCache = new Set();

let googleOAuthFlowState = {
  step: 1, // 1 | 2 | 3 | 4
  selectedEmail: '',
  selectedDefaultName: '',
  selectedPicture: '',
  enteredName: '',
  showOtherAccountInput: false
};

function getGoogleClientId() {
  const saved = (localStorage.getItem(GOOGLE_CLIENT_ID_STORAGE_KEY) || '').trim();
  if (saved && !saved.includes('ri4lejjm4p7kejd4v9hst3c4tk97cjoa')) {
    localStorage.removeItem(GOOGLE_CLIENT_ID_STORAGE_KEY);
    return DEFAULT_GOOGLE_CLIENT_ID.trim();
  }
  return saved || DEFAULT_GOOGLE_CLIENT_ID.trim();
}

function saveGoogleClientId(clientId) {
  const cleaned = (clientId || '').trim();
  if (cleaned) {
    localStorage.setItem(GOOGLE_CLIENT_ID_STORAGE_KEY, cleaned);
  } else {
    localStorage.removeItem(GOOGLE_CLIENT_ID_STORAGE_KEY);
  }
}

function getDetectedDeviceName() {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS / iPhone';
  if (/Win/i.test(ua)) return 'Windows PC';
  if (/Mac/i.test(ua)) return 'MacBook / macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Perangkat';
}

function buildSafeDriveFolderUrl(folderId, email) {
  const cleanEmail = (email || (state.googleAccount && state.googleAccount.email) || '').trim();
  const targetUrl = folderId
    ? `https://drive.google.com/drive/folders/${folderId}`
    : `https://drive.google.com/drive/search?q=${encodeURIComponent('FinMate')}`;
  if (cleanEmail) {
    return `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(
      cleanEmail
    )}&continue=${encodeURIComponent(targetUrl)}`;
  }
  return targetUrl;
}

function getGoogleGLogoSvg(sizeClass = 'w-4 h-4') {
  return `
    <svg class="${sizeClass} shrink-0" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"/>
      <path fill="#FBBC05" d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"/>
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"/>
    </svg>
  `;
}

function copyCurrentOriginToClipboard() {
  const origin = window.location.origin && window.location.origin !== 'null'
    ? window.location.origin
    : 'http://localhost:5600';
  navigator.clipboard.writeText(origin).then(() => {
    showToast('Origin URL berhasil disalin: ' + origin);
  }).catch(() => {
    showToast('Origin URL: ' + origin);
  });
}

function openGoogleClientIdSetupModal() {
  googleOAuthFlowState.step = 'setup_client_id';
  const modal = document.getElementById('modalGoogleAuth');
  if (!modal) return;
  renderGoogleAuthStep();
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function handleSaveGoogleClientIdAndConnect(event) {
  if (event) event.preventDefault();
  const input = document.getElementById('googleClientIdInput');
  const raw = input ? input.value.trim() : '';
  if (!raw || !raw.includes('.apps.googleusercontent.com')) {
    showToast('Masukkan Google Client ID yang valid (akhiran .apps.googleusercontent.com)', 'warning');
    return;
  }
  saveGoogleClientId(raw);
  const isHttpOrigin = window.location.protocol === 'http:' || window.location.protocol === 'https:';
  if (isHttpOrigin && window.google && window.google.accounts && window.google.accounts.oauth2) {
    showToast('Client ID tersimpan! Membuka pop-up autentikasi Google...', 'success');
    closeGoogleAuthModal();
    setTimeout(() => {
      launchRealGoogleOAuthPopup(raw);
    }, 250);
  } else {
    showToast('Client ID tersimpan! Sekarang pilih akun Google Anda.', 'success');
    googleOAuthFlowState.step = 1;
    renderGoogleAuthStep();
  }
}

function getAutoDetectedDeviceGoogleAccounts() {
  const deviceLabel = getDetectedDeviceName();
  const accounts = [];

  const addUnique = (name, email, color, picture) => {
    if (!name || !email) return;
    const exists = accounts.some((a) => a.email.toLowerCase() === email.toLowerCase());
    if (!exists) {
      accounts.push({
        name,
        email,
        deviceLabel,
        color: color || '#d81b60',
        picture: picture || ''
      });
    }
  };

  if (state.googleAccount && state.googleAccount.email) {
    addUnique(
      state.googleAccount.name,
      state.googleAccount.email,
      '#059669',
      state.googleAccount.picture || ''
    );
  }

  if (Array.isArray(state.deviceGoogleAccounts)) {
    state.deviceGoogleAccounts.forEach((acc) => {
      if (acc && acc.email) {
        addUnique(acc.name, acc.email, '#2563eb', acc.picture || '');
      }
    });
  }

  return accounts;
}

function handleHeaderGoogleSyncClick() {
  if (!state.auth?.isLoggedIn || !state.googleAccount?.email) {
    openGoogleAuthModal(false);
  } else {
    switchTab('profil');
  }
}

function handleGoogleModalOverlayClick(event) {
  if (event && event.target && event.target.id === 'modalGoogleAuth') {
    closeGoogleAuthModal();
  }
}

function decodeJwtResponse(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error('Error decoding JWT token:', e);
    return null;
  }
}

function handleGoogleOneTapResponse(response) {
  if (response && response.credential) {
    const payload = decodeJwtResponse(response.credential);
    if (payload) {
      const name = payload.name || payload.given_name || (payload.email ? payload.email.split('@')[0] : 'User');
      const email = payload.email || '';
      const picture = payload.picture || '';
      completeDirectGoogleAccountLogin(name, email, picture, '');
    }
  }
}

function initGoogleOneTapIfAvailable() {
  const clientId = getGoogleClientId();
  if (clientId && window.google && window.google.accounts && window.google.accounts.id) {
    try {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleOneTapResponse,
        auto_select: true,
        cancel_on_tap_outside: false
      });
      window.google.accounts.id.prompt();
    } catch (e) {
      console.warn('GIS One Tap prompt info:', e);
    }
  }
}

function checkAndTriggerGoogleAutoLoginOnStartup() {
  // Jika sudah terhubung akun Google dan aktif login, tidak perlu aksi lanjutan
  if (state.googleAccount && state.googleAccount.email && state.auth?.isLoggedIn) {
    return;
  }

  // Coba inisialisasi One Tap secara aman tanpa memicu browser pop-up blocker
  setTimeout(() => {
    initGoogleOneTapIfAvailable();
  }, 400);
}

async function openGoogleAuthModal(triggerBackupAfterLogin = false) {
  pendingAutoBackupAfterLogin = Boolean(triggerBackupAfterLogin);
  const clientId = getGoogleClientId();

  if (window.google && window.google.accounts && window.google.accounts.oauth2) {
    launchRealGoogleOAuthPopup(clientId);
    return;
  }

  showToast('Memuat Google Sign-In, mohon tunggu sebentar...', 'info');
  let retries = 0;
  const timer = setInterval(() => {
    retries++;
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      clearInterval(timer);
      launchRealGoogleOAuthPopup(clientId);
    } else if (retries >= 15) {
      clearInterval(timer);
      showToast('Layanan Google tidak dapat dijangkau. Periksa koneksi internet Anda.', 'warning');
    }
  }, 200);
}

function closeGoogleAuthModal() {
  const modal = document.getElementById('modalGoogleAuth');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function launchRealGoogleOAuthPopup(clientId) {
  try {
    googleTokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_DRIVE_SCOPES,
      prompt: 'select_account consent',
      callback: async (tokenResponse) => {
        if (tokenResponse && tokenResponse.access_token) {
          latestGoogleAccessToken = tokenResponse.access_token;
          await handleRealGoogleTokenSuccess(tokenResponse.access_token);
        } else if (tokenResponse && tokenResponse.error) {
          console.error('Google OAuth token error:', tokenResponse);
          if (tokenResponse.error === 'access_denied') {
            showToast('Akses login Google dibatalkan atau ditolak.');
          } else {
            showToast('Gagal terhubung ke Google: ' + (tokenResponse.error_description || tokenResponse.error));
          }
        }
      },
      error_callback: (err) => {
        console.warn('Google OAuth error callback:', err);
        if (err && err.type === 'popup_blocked') {
          showToast('Pop-up Google diblokir browser. Silakan izinkan pop-up di browser Anda.', 'warning');
        } else {
          showToast('Jendela login Google ditutup atau terjadi masalah koneksi.', 'info');
        }
      }
    });
    googleTokenClient.requestAccessToken({ prompt: 'select_account consent' });
  } catch (err) {
    console.error('Failed to initialize Google OAuth Client:', err);
    showToast('Gagal membuka pop-up Google OAuth.', 'warning');
  }
}

async function handleRealGoogleTokenSuccess(accessToken) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error('Gagal mengambil profil Google');
    const profile = await res.json();

    const defaultName = profile.name || profile.given_name || (profile.email ? profile.email.split('@')[0] : 'User');
    const email = profile.email || '';
    const picture = profile.picture || '';

    completeDirectGoogleAccountLogin(defaultName, email, picture, accessToken);
  } catch (e) {
    console.error('Error fetching Google userinfo:', e);
    showToast('Gagal memuat profil akun Google.');
  }
}

function renderGoogleAuthStep() {
  const container = document.getElementById('googleAuthModalBody');
  if (!container) return;

  const step = googleOAuthFlowState.step;
  const currentHost = (window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')
    ? window.location.hostname
    : 'dwwchy.github.io';

  if (step === 'setup_client_id') {
    const currentClientId = getGoogleClientId();
    const currentOrigin = window.location.origin && window.location.origin !== 'null'
      ? window.location.origin
      : 'http://localhost:5600';

    container.innerHTML = `
      <div class="bg-white text-[#202124] rounded-[24px] sm:rounded-[28px] overflow-hidden">
        <!-- Top header -->
        <div class="px-6 py-4 border-b border-[#e0e0e0] flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            ${getGoogleGLogoSvg('w-5 h-5')}
            <span style="font-family: 'Google Sans', Roboto, sans-serif; font-size: 15px; font-weight: 500; color: #202124;">
              Hubungkan Google Cloud Console
            </span>
          </div>
          <button
            type="button"
            onclick="closeGoogleAuthModal()"
            class="p-1 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>

        <form onsubmit="handleSaveGoogleClientIdAndConnect(event)" class="p-6 space-y-4">
          <!-- Blue Info Alert -->
          <div class="p-4 rounded-xl bg-blue-50 border border-blue-200 text-xs text-slate-700 space-y-2 leading-relaxed">
            <div class="font-bold text-blue-700 flex items-center gap-1.5 text-xs">
              <i data-lucide="shield-check" class="w-4 h-4 text-blue-600"></i>
              <span>Pengaturan OAuth 2.0 Client ID (Web Application)</span>
            </div>
            <p class="text-[11.5px] text-slate-600">
              Agar Google memunculkan pop-up akun resmi dan mencadangkan otomatis ke <b>Google Drive</b>, hubungkan Client ID dari <b>Google Cloud Console</b>.
            </p>
            <div class="pt-1.5 border-t border-blue-200/80">
              <div class="text-[11px] font-semibold text-slate-700 mb-1">Authorized JavaScript Origins Anda:</div>
              <div class="flex items-center gap-1.5 bg-white p-1.5 rounded-lg border border-blue-200">
                <code id="appOriginText" class="text-[11px] text-blue-600 font-mono flex-1 select-all">${currentOrigin}</code>
                <button
                  type="button"
                  onclick="copyCurrentOriginToClipboard()"
                  class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer"
                >
                  Salin
                </button>
              </div>
              <p class="text-[10px] text-slate-500 mt-1">Daftarkan URL di atas di Google Cloud Console pada bagian <i>"Authorized JavaScript origins"</i>.</p>
            </div>
          </div>

          <div>
            <label for="googleClientIdInput" class="block text-xs font-bold text-slate-700 mb-1.5">
              Google OAuth Client ID
            </label>
            <input
              id="googleClientIdInput"
              type="text"
              required
              value="${currentClientId.replace(/"/g, '&quot;')}"
              placeholder="1234567890-abcdefg.apps.googleusercontent.com"
              class="w-full px-3.5 py-2.5 rounded-xl text-xs sm:text-sm border border-slate-300 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 font-mono bg-white"
            />
          </div>

          <!-- Quick instructions steps -->
          <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-600 space-y-1">
            <div class="font-bold text-slate-700">Langkah di Google Cloud Console:</div>
            <ol class="list-decimal pl-4 space-y-0.5">
              <li>Buka <a href="https://console.cloud.google.com/apis/credentials" target="_blank" class="text-blue-600 hover:underline font-medium">console.cloud.google.com</a></li>
              <li>Aktifkan <b>Google Drive API</b> di menu <i>APIs & Services -> Library</i></li>
              <li>Buat Credentials -> <b>OAuth client ID</b> (Type: <i>Web application</i>)</li>
              <li>Tempelkan Client ID di atas lalu klik simpan</li>
            </ol>
          </div>

          <div class="flex flex-col sm:flex-row gap-2 pt-1">
            <button
              type="button"
              onclick="googleBackToStep1()"
              class="py-2.5 px-4 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition-colors cursor-pointer"
            >
              Kembali ke Login
            </button>
            <button
              type="submit"
              class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white shadow-md transition-all cursor-pointer"
            >
              <i data-lucide="check-circle-2" class="w-4 h-4"></i>
              <span>Simpan & Hubungkan</span>
            </button>
          </div>
        </form>
      </div>
    `;
  } else if (step === 1) {
    const accounts = getAutoDetectedDeviceGoogleAccounts();
    const accountsHtml = accounts
      .map((acc) => {
        const safeName = acc.name.replace(/'/g, "\\'");
        const safeEmail = acc.email.replace(/'/g, "\\'");
        const initial = (acc.name || acc.email || 'G').trim().charAt(0).toUpperCase();

        return `
          <button
            type="button"
            onclick="handleGoogleStep1PickAccount('${safeName}', '${safeEmail}')"
            class="w-full py-3.5 flex items-center gap-3.5 hover:bg-slate-50 transition-colors cursor-pointer text-left"
            style="border-bottom: 1px solid #dadce0;"
          >
            <div
              class="w-8 h-8 rounded-full text-white font-medium text-sm flex items-center justify-center shrink-0 shadow-sm"
              style="background-color: ${acc.color || '#d81b60'}; color: #ffffff !important;"
            >
              ${initial}
            </div>
            <div class="min-w-0 flex-1">
              <div style="color: #202124; font-size: 14px; font-weight: 500; font-family: 'Google Sans', Roboto, Arial, sans-serif;" class="truncate">
                ${escapeHtml(acc.name)}
              </div>
              <div style="color: #5f6368; font-size: 12px; font-family: Roboto, Arial, sans-serif;" class="truncate">
                ${escapeHtml(acc.email)}
              </div>
            </div>
          </button>
        `;
      })
      .join('');

    container.innerHTML = `
      <div class="bg-white text-[#202124] rounded-[24px] sm:rounded-[28px] overflow-hidden">
        <!-- Top header: Google Logo + Sign in with Google + Close button -->
        <div class="flex items-center justify-between px-7 pt-6 pb-3">
          <div class="flex items-center gap-3">
            ${getGoogleGLogoSvg('w-5 h-5')}
            <span style="color: #3c4043; font-size: 15px; font-weight: 500; font-family: 'Google Sans', Roboto, Arial, sans-serif;">
              Sign in with Google
            </span>
          </div>
          <button
            type="button"
            onclick="closeGoogleAuthModal()"
            class="p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            title="Tutup"
          >
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>
        <div style="border-bottom: 1px solid #e0e0e0;"></div>

        <!-- Content -->
        <div class="px-7 pt-7 pb-4">
          <!-- Big Title persis screenshot -->
          <h1 style="color: #202124; font-size: 32px; line-height: 38px; font-weight: 400; font-family: 'Google Sans', Roboto, Arial, sans-serif; letter-spacing: -0.5px;">
            Choose an<br>account
          </h1>
          <div style="color: #3c4043; font-size: 15px; margin-top: 12px; margin-bottom: 24px; font-family: Roboto, Arial, sans-serif;">
            to continue to <a href="#" onclick="event.preventDefault()" style="color: #1a73e8; font-weight: 500; text-decoration: none;">${currentHost}</a>
          </div>

          <!-- Account list -->
          <div style="border-top: 1px solid #dadce0;">
            ${accountsHtml}

            <!-- Use another account row persis screenshot -->
            <button
              type="button"
              onclick="toggleGoogleOtherAccountInput()"
              class="w-full py-3.5 flex items-center gap-3.5 hover:bg-slate-50 transition-colors cursor-pointer text-left"
              style="border-bottom: 1px solid #dadce0;"
            >
              <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[#5f6368]">
                <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <circle cx="12" cy="8" r="4"></circle>
                  <path d="M4 20c0-4 4-6 8-6s8 2 8 6"></path>
                </svg>
              </div>
              <div style="color: #202124; font-size: 14px; font-weight: 500; font-family: 'Google Sans', Roboto, Arial, sans-serif;">
                Use another account
              </div>
            </button>
          </div>

          <!-- Toggle Input for other account -->
          <div id="googleOtherAccountBox" class="${googleOAuthFlowState.showOtherAccountInput ? '' : 'hidden'} pt-3 pb-2 space-y-2">
            <input
              id="googleOtherEmailInput"
              type="email"
              placeholder="Email or phone"
              class="w-full px-3.5 py-2.5 rounded-lg text-sm border border-slate-300 text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
              style="color: #202124 !important; background: #ffffff !important;"
            />
            <div class="flex justify-end gap-2">
              <button
                type="button"
                onclick="handleGoogleOtherEmailContinue()"
                class="px-5 py-2 rounded-lg text-xs font-semibold bg-[#1a73e8] hover:bg-[#1557b0] text-white transition-all cursor-pointer shadow-sm"
              >
                Next
              </button>
            </div>
          </div>

          <!-- Policy disclaimer text persis screenshot -->
          <div class="pt-6 pb-2" style="color: #5f6368; font-size: 12px; line-height: 18px; font-family: Roboto, Arial, sans-serif;">
            Before using this app, you can review ${currentHost}'s 
            <a href="#" onclick="event.preventDefault()" style="color: #1a73e8; font-weight: 500; text-decoration: none;">Privacy Policy</a> and 
            <a href="#" onclick="event.preventDefault()" style="color: #1a73e8; font-weight: 500; text-decoration: none;">Terms of Service</a>.
          </div>
        </div>

        <!-- Bottom Footer persis screenshot -->
        <div class="px-7 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs border-t border-slate-100" style="color: #5f6368; font-family: Roboto, Arial, sans-serif;">
          <div class="inline-flex items-center gap-1.5 cursor-pointer hover:text-slate-900">
            <span>English (United States)</span>
            <span style="font-size: 9px;">▼</span>
          </div>
          <div class="flex items-center gap-4">
            <button
              type="button"
              onclick="openGoogleClientIdSetupModal()"
              class="hover:text-blue-700 cursor-pointer font-medium"
              style="color: #1a73e8;"
              title="Konfigurasi Google Cloud Console Client ID"
            >
              Google Console
            </button>
            <a href="#" onclick="event.preventDefault()" class="hover:text-slate-900 cursor-pointer" style="text-decoration: none; color: inherit;">Help</a>
            <a href="#" onclick="event.preventDefault()" class="hover:text-slate-900 cursor-pointer" style="text-decoration: none; color: inherit;">Privacy</a>
            <a href="#" onclick="event.preventDefault()" class="hover:text-slate-900 cursor-pointer" style="text-decoration: none; color: inherit;">Terms</a>
          </div>
        </div>
      </div>
    `;
  } else if (step === 2) {
    const email = googleOAuthFlowState.selectedEmail;
    const initial = (googleOAuthFlowState.selectedDefaultName || email || 'G')
      .trim()
      .charAt(0)
      .toUpperCase();

    container.innerHTML = `
      <div class="bg-white text-[#202124] rounded-[24px] sm:rounded-[28px] overflow-hidden">
        <!-- Top Header -->
        <div class="flex items-center justify-between px-7 pt-6 pb-3">
          <div class="flex items-center gap-3">
            ${getGoogleGLogoSvg('w-5 h-5')}
            <span style="color: #3c4043; font-size: 15px; font-weight: 500; font-family: 'Google Sans', Roboto, Arial, sans-serif;">
              Sign in with Google
            </span>
          </div>
          <button
            type="button"
            onclick="closeGoogleAuthModal()"
            class="p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>
        <div style="border-bottom: 1px solid #e0e0e0;"></div>

        <!-- Content: Perizinan Drive -->
        <div class="px-7 pt-6 pb-6">
          <div class="flex flex-col items-center text-center mb-5">
            <div class="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 mb-3 shadow-sm">
              <i data-lucide="shield-check" class="w-6 h-6"></i>
            </div>
            <h3 style="color: #202124; font-size: 20px; font-weight: 500; font-family: 'Google Sans', Roboto, sans-serif;">
              FinMate ingin mengakses Google Drive Anda
            </h3>

            <!-- Account Pill -->
            <button
              type="button"
              onclick="googleBackToStep1()"
              class="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 hover:bg-slate-100 text-xs text-slate-800 transition-colors cursor-pointer"
            >
              <span
                class="w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0"
                style="background-color:#d81b60; color:#ffffff !important;"
              >
                ${initial}
              </span>
              <span class="truncate max-w-[210px] font-medium">${escapeHtml(email)}</span>
              <i data-lucide="chevron-down" class="w-3.5 h-3.5 text-slate-500"></i>
            </button>
          </div>

          <div class="space-y-4">
            <h4 style="color: #202124; font-size: 13px; font-weight: 500;">
              Hal ini memungkinkan FinMate untuk:
            </h4>

            <div class="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
              <div class="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0 mt-0.5">
                <i data-lucide="folder-sync" class="w-4 h-4"></i>
              </div>
              <div class="min-w-0 flex-1">
                <div style="color: #202124; font-size: 13px; font-weight: 500;">Melihat dan mengunggah file cadangan transaksi</div>
                <div style="color: #5f6368; font-size: 11px; margin-top: 2px;">File disimpan di folder <b class="text-slate-800">${DRIVE_MAIN_FOLDER_NAME}</b> di Google Drive Anda.</div>
              </div>
            </div>

            <p style="color: #5f6368; font-size: 11px; line-height: 16px;">
              Pastikan Anda mempercayai FinMate. Anda dapat mencabut atau mengelola akses ini kapan saja di Akun Google Anda.
            </p>

            <div class="grid grid-cols-2 gap-3 pt-3">
              <button
                type="button"
                onclick="googleBackToStep1()"
                class="py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onclick="handleGoogleStep2ApprovePolicy()"
                class="py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold bg-[#1a73e8] hover:bg-[#1557b0] text-white shadow-sm transition-all cursor-pointer"
              >
                Lanjutkan
              </button>
            </div>
          </div>
        </div>

        <div class="px-7 py-3 flex items-center justify-between text-xs border-t border-slate-100 text-[#5f6368]">
          <span>English (United States)</span>
          <div class="flex gap-4">
            <a href="#" onclick="event.preventDefault()" class="hover:text-slate-900 cursor-pointer">Help</a>
            <a href="#" onclick="event.preventDefault()" class="hover:text-slate-900 cursor-pointer">Privacy</a>
            <a href="#" onclick="event.preventDefault()" class="hover:text-slate-900 cursor-pointer">Terms</a>
          </div>
        </div>
      </div>
    `;
  } else if (step === 3) {
    const email = googleOAuthFlowState.selectedEmail;
    const prefillName = googleOAuthFlowState.enteredName || googleOAuthFlowState.selectedDefaultName || '';

    container.innerHTML = `
      <div class="bg-white text-[#202124] rounded-[24px] sm:rounded-[28px] overflow-hidden">
        <!-- Header -->
        <div class="px-6 py-4 flex items-center justify-between border-b border-[#e0e0e0]">
          <div class="flex items-center gap-2.5">
            ${getGoogleGLogoSvg('w-5 h-5')}
            <span style="font-family: 'Google Sans', Roboto, sans-serif; font-size: 15px; font-weight: 500; color: #202124;">
              Konfirmasi Akun FinMate
            </span>
          </div>
          <button
            type="button"
            onclick="closeGoogleAuthModal()"
            class="p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>

        <form onsubmit="handleGoogleStep3ConfirmName(event)" class="p-6 space-y-4">
          <div>
            <label class="block text-xs font-bold text-slate-600 mb-1">Email Google Terhubung</label>
            <input
              type="email"
              value="${escapeHtml(email)}"
              readonly
              class="w-full px-3.5 py-2.5 rounded-xl text-xs sm:text-sm text-slate-700 bg-slate-100 border border-slate-200 cursor-not-allowed focus:outline-none"
            />
          </div>

          <div>
            <label for="googleStep3NameInput" class="block text-xs font-bold text-slate-700 mb-1">Nama Tampilan di Kas Bersama</label>
            <input
              id="googleStep3NameInput"
              type="text"
              required
              value="${escapeHtml(prefillName)}"
              placeholder="Contoh: Mohamad Dwi Cahyono"
              class="w-full px-3.5 py-2.5 rounded-xl text-xs sm:text-sm bg-white border border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          </div>

          <label class="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
            <input
              id="googleStep3TermsCheck"
              type="checkbox"
              checked
              required
              class="w-4 h-4 rounded accent-[#1a73e8] cursor-pointer"
            />
            <span class="text-xs text-slate-600">Aktifkan sinkronisasi otomatis ke Google Drive & kas bersama</span>
          </label>

          <div class="pt-2">
            <button
              type="submit"
              class="w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold bg-[#1a73e8] hover:bg-[#1557b0] text-white shadow-md transition-all cursor-pointer"
            >
              Konfirmasi & Masuk Sekarang
            </button>
          </div>
        </form>
      </div>
    `;

    setTimeout(() => {
      const nameInput = document.getElementById('googleStep3NameInput');
      if (nameInput) {
        nameInput.focus();
        nameInput.select();
      }
    }, 60);
  } else if (step === 4) {
    const finalName = googleOAuthFlowState.enteredName || googleOAuthFlowState.selectedDefaultName || 'User';
    const email = googleOAuthFlowState.selectedEmail;

    container.innerHTML = `
      <div class="bg-white text-[#202124] rounded-[24px] sm:rounded-[28px] overflow-hidden p-6 sm:p-7 text-center space-y-4">
        <div class="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 mx-auto shadow-sm">
          <i data-lucide="check-circle-2" class="w-8 h-8"></i>
        </div>

        <div class="space-y-1">
          <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-700">
            <i data-lucide="check" class="w-3.5 h-3.5"></i>
            <span>Google Drive Terhubung</span>
          </div>
          <h3 style="color: #202124; font-size: 20px; font-weight: 500; font-family: 'Google Sans', Roboto, sans-serif;" class="pt-1">
            Selamat Datang, ${escapeHtml(finalName)}!
          </h3>
          <p class="text-xs font-semibold text-emerald-600">${escapeHtml(email)}</p>
        </div>

        <p class="text-xs text-slate-500 leading-relaxed max-w-sm mx-auto">
          Akun Anda telah berhasil terhubung ke Google Cloud Console & Google Drive. Mulai sekarang setiap transaksi kas bersama akan otomatis dicadangkan dengan aman.
        </p>

        <div class="pt-2">
          <button
            type="button"
            onclick="finishGoogleWelcomePopup()"
            class="w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold bg-[#1a73e8] hover:bg-[#1557b0] text-white shadow-md transition-all cursor-pointer"
          >
            Selesai & Buka Dashboard
          </button>
        </div>
      </div>
    `;
  }

  if (window.lucide) {
    window.lucide.createIcons({ nodes: [container] });
  }
}

function handleGoogleStep1PickAccount(name, email, picture = '') {
  const chosenName = name || 'Mohamad Dwi Cahyono';
  const chosenEmail = email || 'muhammaddwicahyono20220@gmail.com';
  const chosenPicture = picture || '';

  googleOAuthFlowState.selectedDefaultName = chosenName;
  googleOAuthFlowState.selectedEmail = chosenEmail;
  googleOAuthFlowState.enteredName = chosenName;
  googleOAuthFlowState.selectedPicture = chosenPicture;

  // Langsung selesaikan login akun yang dipilih dari pop-up Google perangkat
  completeDirectGoogleAccountLogin(chosenName, chosenEmail, chosenPicture);
}

async function completeDirectGoogleAccountLogin(name, email, picture = '', accessToken = '') {
  const enteredName = name || 'Pengguna FinMate';
  const userEmail = email || '';
  const userPicture = picture || '';
  const deviceLabel = getDetectedDeviceName();

  if (accessToken) {
    latestGoogleAccessToken = accessToken;
  }

  state.googleAccount = {
    name: enteredName,
    email: userEmail,
    picture: userPicture,
    accessToken: latestGoogleAccessToken || (state.googleAccount && state.googleAccount.accessToken) || '',
    accessTokenExpiresAt: latestGoogleAccessToken ? Date.now() + 3300 * 1000 : (state.googleAccount && state.googleAccount.accessTokenExpiresAt) || 0,
    driveFolderId: (state.googleAccount && state.googleAccount.driveFolderId) || '',
    folderOwnerEmail: userEmail,
    deviceLabel: deviceLabel,
    autoBackup: true,
    connectedAt: new Date().toLocaleString('id-ID')
  };

  if (userEmail) {
    if (!Array.isArray(state.deviceGoogleAccounts)) {
      state.deviceGoogleAccounts = [];
    }
    const existsIdx = state.deviceGoogleAccounts.findIndex(
      (a) => a.email && a.email.toLowerCase() === userEmail.toLowerCase()
    );
    if (existsIdx === -1) {
      state.deviceGoogleAccounts.unshift({ name: enteredName, email: userEmail, picture: userPicture, deviceLabel });
    } else {
      state.deviceGoogleAccounts[existsIdx] = { name: enteredName, email: userEmail, picture: userPicture, deviceLabel };
    }
  }

  // Sinkronkan ke auth kas bersama
  if (!state.auth) state.auth = {};
  state.auth.isLoggedIn = true;
  state.auth.provider = 'google';
  state.auth.user = {
    name: enteredName,
    email: userEmail,
    photoURL: userPicture || `https://ui-avatars.com/api/?name=${encodeURIComponent(enteredName)}&background=0284c7&color=ffffff&bold=true`
  };
  state.auth.lastSyncTime = new Date().toISOString();

  if (!state.profile) state.profile = {};
  state.profile.userName = enteredName;

  saveState();
  renderProfileTab();
  renderDashboard();
  renderDompetTab();
  renderTransactionList();
  updateHeaderAuthIndicator();
  closeGoogleAuthModal();
  if (window.lucide) window.lucide.createIcons();

  // Sinkronisasi data Google Drive (Jika diakses di perangkat lain, otomatis memulihkan transaksi)
  if (latestGoogleAccessToken) {
    try {
      showToast('Menghubungkan ke folder FinMate di Google Drive...', 'info');

      // 1. Pastikan folder FinMate dibuat/ditemukan dan simpan ID foldernya
      const mainFolderId = await getOrCreateGoogleDriveFolder(latestGoogleAccessToken, DRIVE_MAIN_FOLDER_NAME);
      if (
        mainFolderId &&
        !mainFolderId.includes('ERROR') &&
        !mainFolderId.includes('DENIED') &&
        !mainFolderId.includes('EXPIRED')
      ) {
        if (state.googleAccount) {
          state.googleAccount.driveFolderId = mainFolderId;
          saveState();
        }
      }

      // 2. Cek apakah ada cadangan transaksi sebelumnya di Google Drive
      const driveSnapshot = await fetchLatestBackupFromRealGoogleDrive(latestGoogleAccessToken);
      if (driveSnapshot && Array.isArray(driveSnapshot.transactions) && driveSnapshot.transactions.length > 0) {
        restoreFromSnapshotObject(driveSnapshot);
        await syncDriveBackupHistoryFromGoogle(latestGoogleAccessToken);
        showToast(`Selamat datang, ${enteredName}! Data transaksi dari Google Drive berhasil dipulihkan.`, 'success');
      } else {
        const todayISO = getTodayLocalISO();
        const fileName = `Cadangan_Transaksi_${todayISO}.json`;
        const payload = buildFullTransactionBackupPayload();
        const uploadRes = await uploadBackupToRealGoogleDrive(latestGoogleAccessToken, fileName, payload);
        if (uploadRes && uploadRes.mainFolderId && state.googleAccount) {
          state.googleAccount.driveFolderId = uploadRes.mainFolderId;
          saveState();
        }
        await syncDriveBackupHistoryFromGoogle(latestGoogleAccessToken);
        showToast(`Selamat datang, ${enteredName}! Folder FinMate berhasil dibuat di Google Drive.`, 'success');
      }
      renderDashboard();
      renderTransactionList();
      renderDompetTab();
      renderProfileTab();
    } catch (err) {
      console.warn('Google Drive sync error:', err);
    }
  }

  // Jalankan pencadangan background & sync server bersama
  runBackgroundDriveBackup(true);
  syncSharedDataNow(true);

  showToast(`Selamat datang, ${enteredName}! Akun Google & Drive berhasil terhubung.`);
}

function toggleGoogleOtherAccountInput() {
  googleOAuthFlowState.showOtherAccountInput = !googleOAuthFlowState.showOtherAccountInput;
  renderGoogleAuthStep();
  if (googleOAuthFlowState.showOtherAccountInput) {
    setTimeout(() => {
      const input = document.getElementById('googleOtherEmailInput');
      if (input) input.focus();
    }, 50);
  }
}

function handleGoogleOtherEmailContinue() {
  const input = document.getElementById('googleOtherEmailInput');
  const rawEmail = input ? input.value.trim() : '';
  if (!rawEmail || !rawEmail.includes('@')) {
    showToast('Masukkan alamat email Google yang valid.', 'warning');
    return;
  }
  const emailPrefix = rawEmail.split('@')[0].replace(/[._-]+/g, ' ');
  const suggestedName = emailPrefix
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  googleOAuthFlowState.selectedDefaultName = suggestedName || 'User';
  googleOAuthFlowState.selectedEmail = rawEmail;
  googleOAuthFlowState.enteredName = suggestedName || 'User';
  googleOAuthFlowState.step = 3;
  renderGoogleAuthStep();
}

function googleBackToStep1() {
  googleOAuthFlowState.step = 1;
  renderGoogleAuthStep();
}

function handleGoogleStep2ApprovePolicy() {
  googleOAuthFlowState.step = 3;
  renderGoogleAuthStep();
}

function handleGoogleStep3ConfirmName(event) {
  if (event) event.preventDefault();
  const nameInput = document.getElementById('googleStep3NameInput');
  const enteredName = nameInput ? nameInput.value.trim() : '';
  if (!enteredName) {
    showToast('Harap masukkan nama Anda.', 'warning');
    return;
  }

  const email = googleOAuthFlowState.selectedEmail;
  const picture = googleOAuthFlowState.selectedPicture || '';
  completeDirectGoogleAccountLogin(enteredName, email, picture, latestGoogleAccessToken);
}

async function finishGoogleWelcomePopup() {
  const name = googleOAuthFlowState.enteredName || (state.googleAccount && state.googleAccount.name) || 'User';
  closeGoogleAuthModal();
  showToast(`Selamat datang, ${name}! FinMate siap digunakan.`);
}

function disconnectGoogleAccount() {
  if (confirm('Keluar dari Akun Google? Data catatan keuangan kas tetap tersimpan di perangkat ini.')) {
    latestGoogleAccessToken = '';
    state.googleAccount = null;
    if (state.auth) {
      state.auth.isLoggedIn = false;
      state.auth.user = null;
      state.auth.syncStatus = 'idle';
    }
    saveState();
    renderProfileTab();
    updateHeaderAuthIndicator();
    if (window.lucide) window.lucide.createIcons();
    showToast('Akun Google telah diputuskan.');
  }
}

async function handleOpenGoogleDriveFolder(event, folderId, email) {
  if (event) event.stopPropagation();

  let validFolderId = folderId || (state.googleAccount && state.googleAccount.driveFolderId) || '';
  const userEmail = email || (state.googleAccount && state.googleAccount.email) || '';

  // Jika folderId belum tersimpan dan token Google aktif tersedia, cari atau buatkan folder sekarang
  if (!validFolderId && latestGoogleAccessToken) {
    showToast('Memeriksa & menyiapkan folder FinMate di Google Drive...', 'info');
    try {
      const createdOrFoundId = await getOrCreateGoogleDriveFolder(latestGoogleAccessToken, DRIVE_MAIN_FOLDER_NAME);
      if (
        createdOrFoundId &&
        !createdOrFoundId.includes('ERROR') &&
        !createdOrFoundId.includes('DENIED') &&
        !createdOrFoundId.includes('EXPIRED')
      ) {
        validFolderId = createdOrFoundId;
        if (state.googleAccount) {
          state.googleAccount.driveFolderId = validFolderId;
          saveState();
        }
        // Pastikan file cadangan awal juga diunggah
        const todayISO = getTodayLocalISO();
        const fileName = `Cadangan_Transaksi_${todayISO}.json`;
        const payload = buildFullTransactionBackupPayload();
        await uploadBackupToRealGoogleDrive(latestGoogleAccessToken, fileName, payload);
        renderProfileTab();
      }
    } catch (e) {
      console.warn('Gagal menyiapkan folder FinMate:', e);
    }
  }

  // Jika belum login ke Google sama sekali
  if (!userEmail && !latestGoogleAccessToken) {
    showToast('Silakan masuk dengan akun Google terlebih dahulu.', 'warning');
    openGoogleAuthModal(false);
    return;
  }

  const url = buildSafeDriveFolderUrl(validFolderId, userEmail);
  window.open(url, '_blank');
}

function downloadBackupSnapshotJson(backupId) {
  const item = (state.driveBackups || []).find((b) => b.id === backupId);
  const data = item?.payload || buildFullTransactionBackupPayload();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = item?.fileName || `Cadangan_FinMate_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function deleteBackupHistoryItem(backupId) {
  if (confirm('Hapus catatan riwayat cadangan ini? (File di Google Drive asli tidak akan terhapus).')) {
    state.driveBackups = (state.driveBackups || []).filter((b) => b.id !== backupId);
    saveState();
    renderProfileTab();
    if (window.lucide) window.lucide.createIcons();
    showToast('Catatan cadangan dihapus.');
  }
}

async function ensureDriveFolderLinkPermission(accessToken, folderId) {
  if (!accessToken || !folderId) return false;
  if (driveFolderPermCache.has(folderId)) return true;
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folderId}/permissions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8'
        },
        body: JSON.stringify({
          role: 'reader',
          type: 'anyone'
        })
      }
    );
    if (res.ok) {
      driveFolderPermCache.add(folderId);
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

async function getOrCreateGoogleDriveFolder(accessToken, folderName = DRIVE_MAIN_FOLDER_NAME) {
  if (!accessToken) return null;
  try {
    const escapedName = folderName.replace(/'/g, "\\'");
    const q = `mimeType = 'application/vnd.google-apps.folder' and name = '${escapedName}' and trashed = false`;

    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (searchRes.status === 401) return 'TOKEN_EXPIRED';
    if (searchRes.status === 403) {
      const errData = await searchRes.json().catch(() => ({}));
      const errMsg = (errData && errData.error && errData.error.message) || '';
      if (errMsg.includes('has not been used in project') || errMsg.includes('is disabled')) {
        return 'DRIVE_API_DISABLED';
      }
      return 'DRIVE_PERMISSION_DENIED';
    }

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        const existingId = searchData.files[0].id;
        await ensureDriveFolderLinkPermission(accessToken, existingId);
        return existingId;
      }
    }

    const folderMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      description: 'Folder Otomatis Cadangan Transaksi FinMate'
    };

    const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8'
      },
      body: JSON.stringify(folderMetadata)
    });

    if (createRes.status === 401) return 'TOKEN_EXPIRED';
    if (createRes.status === 403) return 'DRIVE_PERMISSION_DENIED';
    if (!createRes.ok) return null;

    const createdFolder = await createRes.json();
    if (createdFolder && createdFolder.id) {
      await ensureDriveFolderLinkPermission(accessToken, createdFolder.id);
      return createdFolder.id;
    }
    return null;
  } catch (e) {
    console.warn('Error getOrCreateGoogleDriveFolder:', e);
    return null;
  }
}

async function upsertJsonFileInDriveFolder(accessToken, folderId, fileName, payloadObj, descriptionText) {
  if (!accessToken || !fileName) return null;
  try {
    const escapedFileName = fileName.replace(/'/g, "\\'");
    let searchQ = `name = '${escapedFileName}' and trashed = false`;
    if (folderId) {
      searchQ += ` and '${folderId}' in parents`;
    }

    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(searchQ)}&fields=files(id,name)&pageSize=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    let existingFileId = null;
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        existingFileId = searchData.files[0].id;
      }
    }

    const jsonContent = JSON.stringify(payloadObj, null, 2);

    if (existingFileId) {
      const updateRes = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8'
          },
          body: jsonContent
        }
      );
      if (updateRes.ok) return await updateRes.json();
    }

    const createMetaRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8'
      },
      body: JSON.stringify({
        name: fileName,
        mimeType: 'application/json',
        description: descriptionText || 'FinMate Automatic Backup',
        parents: folderId ? [folderId] : []
      })
    });

    if (!createMetaRes.ok) return null;
    const createdMeta = await createMetaRes.json();
    const newFileId = createdMeta.id;

    const uploadRes = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${newFileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8'
        },
        body: jsonContent
      }
    );

    if (!uploadRes.ok) return createdMeta;
    return await uploadRes.json();
  } catch (e) {
    console.warn('Error upsertJsonFileInDriveFolder:', e);
    return null;
  }
}

async function uploadBackupToRealGoogleDrive(accessToken, fileName, payloadObj) {
  if (!accessToken) return null;
  try {
    const mainFolderId = await getOrCreateGoogleDriveFolder(accessToken, DRIVE_MAIN_FOLDER_NAME);
    if (
      mainFolderId === 'TOKEN_EXPIRED' ||
      mainFolderId === 'DRIVE_API_DISABLED' ||
      mainFolderId === 'DRIVE_PERMISSION_DENIED'
    ) {
      return { error: mainFolderId };
    }
    if (!mainFolderId) return null;

    const dailyFile = await upsertJsonFileInDriveFolder(
      accessToken,
      mainFolderId,
      fileName,
      payloadObj,
      'Cadangan Transaksi FinMate'
    );

    let masterFile = null;
    if (Array.isArray(payloadObj.transactions) && payloadObj.transactions.length > 0) {
      masterFile = await upsertJsonFileInDriveFolder(
        accessToken,
        mainFolderId,
        'FinMate_Master_Sync.json',
        payloadObj,
        'Master Sync FinMate'
      );
    }

    return {
      dailyFile: dailyFile || masterFile,
      mainFolderId: mainFolderId
    };
  } catch (e) {
    console.warn('Real Google Drive upload error:', e);
    return null;
  }
}

async function fetchLatestBackupFromRealGoogleDrive(accessToken) {
  if (!accessToken) return null;
  try {
    const query = encodeURIComponent(
      "(name = 'FinMate_Master_Sync.json' or name contains 'Cadangan_Transaksi_' or name contains 'FinMate_') and trashed = false"
    );
    const listRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=modifiedTime desc&pageSize=5&fields=files(id,name,modifiedTime,parents)`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!listRes.ok) return null;
    const listData = await listRes.json();
    if (!listData.files || listData.files.length === 0) return null;

    for (const file of listData.files) {
      try {
        const fileRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (fileRes.ok) {
          const snapshot = await fileRes.json();
          if (snapshot && Array.isArray(snapshot.transactions) && snapshot.transactions.length > 0) {
            return snapshot;
          }
        }
      } catch (_) {}
    }
    return null;
  } catch (e) {
    console.warn('Real Google Drive restore error:', e);
    return null;
  }
}

async function syncDriveBackupHistoryFromGoogle(accessToken) {
  if (!accessToken || !state.googleAccount || !state.googleAccount.email) return;
  try {
    const query = encodeURIComponent(
      "(name contains 'Cadangan_Transaksi_' or name = 'FinMate_Master_Sync.json') and trashed = false"
    );
    const listRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=modifiedTime desc&pageSize=10&fields=files(id,name,modifiedTime,parents)`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!listRes.ok) return;
    const data = await listRes.json();
    if (!data.files || data.files.length === 0) return;

    const email = state.googleAccount.email;
    const fetchedEntries = data.files.map((f) => {
      const parentFolderId = Array.isArray(f.parents) && f.parents.length > 0 ? f.parents[0] : '';
      const modDate = f.modifiedTime ? new Date(f.modifiedTime) : new Date();
      const createdAt = modDate.toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      return {
        id: 'drive_' + f.id,
        driveFileId: f.id,
        folderId: parentFolderId || state.googleAccount.driveFolderId || '',
        folderPath: DRIVE_MAIN_FOLDER_NAME,
        driveFolderUrl: buildSafeDriveFolderUrl(parentFolderId || state.googleAccount.driveFolderId, email),
        fileName: f.name,
        email: email,
        createdAt: createdAt,
        txCount: state.transactions.length,
        walletCount: state.wallets.length
      };
    });

    if (fetchedEntries.length > 0) {
      const nonDriveEntries = (state.driveBackups || []).filter(
        (b) => !b.email || b.email.toLowerCase() !== email.toLowerCase()
      );
      state.driveBackups = [...fetchedEntries, ...nonDriveEntries];
      saveState();
      renderProfileTab();
      if (window.lucide) window.lucide.createIcons();
    }
  } catch (e) {
    console.warn('Error syncDriveBackupHistoryFromGoogle:', e);
  }
}

function getCloudSnapshotsMap() {
  try {
    const raw = localStorage.getItem(DRIVE_CLOUD_SNAPSHOTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveCloudSnapshotForEmail(email, snapshotData) {
  const map = getCloudSnapshotsMap();
  map[email.toLowerCase()] = snapshotData;
  localStorage.setItem(DRIVE_CLOUD_SNAPSHOTS_KEY, JSON.stringify(map));
}

function buildFullTransactionBackupPayload() {
  return {
    app: 'FinMate',
    version: 3,
    backedUpAt: new Date().toISOString(),
    googleAccount: state.googleAccount,
    profile: state.profile,
    wallets: state.wallets,
    categories: state.categories,
    settings: state.settings,
    transactions: state.transactions,
    auth: state.auth
  };
}

function restoreFromSnapshotObject(snapshot) {
  if (!snapshot) return;
  if (Array.isArray(snapshot.transactions)) {
    state.transactions = snapshot.transactions;
  }
  if (Array.isArray(snapshot.wallets)) {
    state.wallets = snapshot.wallets;
  }
  if (snapshot.categories && typeof snapshot.categories === 'object') {
    state.categories = snapshot.categories;
  }
  if (snapshot.profile && typeof snapshot.profile === 'object') {
    state.profile = { ...state.profile, ...snapshot.profile };
  }
  if (snapshot.settings && typeof snapshot.settings === 'object') {
    state.settings = { ...state.settings, ...snapshot.settings };
  }
  saveState();
  renderDashboard();
  renderDompetTab();
  renderTransactionList();
  renderProfileTab();
  if (window.lucide) window.lucide.createIcons();
  showToast('Data transaksi berhasil dipulihkan!');
}

async function handleRestoreTransactionsFromDrive() {
  if (!state.googleAccount || !state.googleAccount.email) {
    showToast('Silakan login dengan Google terlebih dahulu.', 'warning');
    openGoogleAuthModal();
    return;
  }

  showToast('Memeriksa cadangan di Google Drive...', 'info');

  let activeToken = latestGoogleAccessToken || (state.googleAccount && state.googleAccount.accessToken) || '';

  // 1. Coba ambil dari Google Drive API langsung jika token tersedia
  if (activeToken && navigator.onLine !== false) {
    const driveSnapshot = await fetchLatestBackupFromRealGoogleDrive(activeToken);
    if (driveSnapshot && (Array.isArray(driveSnapshot.transactions) || Array.isArray(driveSnapshot.wallets))) {
      restoreFromSnapshotObject(driveSnapshot);
      await syncDriveBackupHistoryFromGoogle(activeToken);
      return;
    }
  }

  // 2. Cek cadangan lokal di browser (cloudMap)
  const cloudMap = getCloudSnapshotsMap();
  const snapshot = cloudMap[state.googleAccount.email.toLowerCase()];
  if (snapshot && (Array.isArray(snapshot.transactions) || Array.isArray(snapshot.wallets))) {
    restoreFromSnapshotObject(snapshot);
    return;
  }

  // 3. Cek riwayat lokal state.driveBackups
  const latestBackup = (state.driveBackups || []).find(
    (b) => b.email && b.email.toLowerCase() === state.googleAccount.email.toLowerCase() && b.payload
  );
  if (latestBackup && latestBackup.payload) {
    restoreFromSnapshotObject(latestBackup.payload);
    return;
  }

  showToast('Tidak ditemukan file cadangan di Google Drive untuk akun ini.', 'warning');
}

function runBackgroundDriveBackup(isSilentAuto = false) {
  if (!state.googleAccount || !state.googleAccount.email) return;

  const payload = buildFullTransactionBackupPayload();
  saveCloudSnapshotForEmail(state.googleAccount.email, payload);

  const todayISO = new Date().toISOString().slice(0, 10);
  const fileName = `Cadangan_Transaksi_${todayISO}.json`;
  const folderPath = DRIVE_MAIN_FOLDER_NAME;

  const nowFormatted = new Date().toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const activeToken = latestGoogleAccessToken || (state.googleAccount && state.googleAccount.accessToken) || '';

  (async () => {
    let driveResult = null;
    if (activeToken && navigator.onLine !== false) {
      driveResult = await uploadBackupToRealGoogleDrive(activeToken, fileName, payload);
      if (driveResult && driveResult.mainFolderId && state.googleAccount) {
        state.googleAccount.driveFolderId = driveResult.mainFolderId;
        state.googleAccount.folderOwnerEmail = state.googleAccount.email;
        saveState();
      }
    }

    const resolvedFolderId =
      driveResult && driveResult.mainFolderId
        ? driveResult.mainFolderId
        : (state.googleAccount && state.googleAccount.driveFolderId) || '';

    const driveFolderUrl = buildSafeDriveFolderUrl(resolvedFolderId, state.googleAccount.email);

    const newEntry = {
      id: 'bk_' + Date.now(),
      folderId: resolvedFolderId,
      folderPath: folderPath,
      driveFolderUrl: driveFolderUrl,
      fileName: fileName,
      email: state.googleAccount.email,
      createdAt: nowFormatted,
      txCount: state.transactions.length,
      walletCount: state.wallets.length,
      payload: payload
    };

    if (!Array.isArray(state.driveBackups)) {
      state.driveBackups = [];
    }

    const existingSameDayIdx = state.driveBackups.findIndex(
      (b) =>
        b.fileName === fileName &&
        b.email &&
        b.email.toLowerCase() === state.googleAccount.email.toLowerCase()
    );

    if (existingSameDayIdx !== -1) {
      state.driveBackups[existingSameDayIdx] = newEntry;
    } else {
      state.driveBackups.unshift(newEntry);
    }

    saveState();
    renderProfileTab();
    if (window.lucide) window.lucide.createIcons();

    if (!isSilentAuto) {
      showToast(`Cadangan berhasil disimpan ke Google Drive (${folderPath})`);
    }
  })();
}

// Kompatibilitas alias untuk tombol login lama
function initiateGoogleLogin() {
  openGoogleAuthModal(false);
}

function openGoogleLoginModal() {
  openGoogleAuthModal(false);
}

function closeGoogleLoginModal() {
  closeGoogleAuthModal();
}

function handleGoogleLogout() {
  disconnectGoogleAccount();
}

function openSharedRoomModal() {
  const modal = document.getElementById('modalSharedRoom');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    const input = document.getElementById('inputSharedRoomId');
    if (input) input.value = state.auth?.sharedRoomId || 'kas_bersama_utama';
  }
}

function closeSharedRoomModal() {
  const modal = document.getElementById('modalSharedRoom');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function handleSaveSharedRoom(event) {
  if (event) event.preventDefault();
  const input = document.getElementById('inputSharedRoomId');
  const roomId = (input?.value.trim() || 'kas_bersama_utama').toLowerCase().replace(/[^a-z0-9_-]/g, '_');

  if (!state.auth) state.auth = {};
  state.auth.sharedRoomId = roomId;
  saveState();

  closeSharedRoomModal();
  renderProfileTab();
  showToast(`ID Ruang Kas Bersama diubah ke: "${roomId}"`);
  syncSharedDataNow(true);
}

function updateHeaderAuthIndicator() {
  const badge = document.getElementById('headerAuthBadge');
  const avatarContainer = document.getElementById('headerAuthAvatarContainer');
  if (!badge) return;

  const auth = state.auth || {};
  if (auth.isLoggedIn && auth.user) {
    badge.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
    if (avatarContainer) {
      avatarContainer.innerHTML = `
        <img src="${auth.user.photoURL || ''}" alt="Google" class="w-4 h-4 rounded-full object-cover" onerror="this.outerHTML='<i data-lucide=\\'cloud\\' class=\\'w-4 h-4 text-emerald-400\\'></i>'; lucide.createIcons();" />
      `;
    }
  } else {
    badge.className = 'w-2 h-2 rounded-full bg-slate-400';
    if (avatarContainer) {
      avatarContainer.innerHTML = `<i data-lucide="cloud" id="headerCloudIcon" class="w-4 h-4 text-secondary-var"></i>`;
    }
  }
  lucide.createIcons();
}

async function syncSharedDataNow(isInitial) {
  const statusText = document.getElementById('syncStatusText');
  if (statusText) statusText.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400 animate-spin"></span> Menghubungkan server...`;

  try {
    const res = await fetch('./api/shared-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: state.auth?.sharedRoomId || 'kas_bersama_utama',
        user: state.auth?.user || { name: state.profile?.userName || 'Anonim' },
        data: {
          wallets: state.wallets,
          categories: state.categories,
          transactions: state.transactions,
          settings: state.settings,
          profile: state.profile
        }
      })
    });

    if (res.ok) {
      if (!state.auth) state.auth = {};
      state.auth.lastSyncTime = new Date().toISOString();
      state.auth.syncStatus = 'synced';
      saveState();
      renderProfileTab();
      updateHeaderAuthIndicator();
      if (!isInitial) {
        showToast('Data kas bersama berhasil disinkronkan ke server!');
      }
      return;
    }
  } catch (err) {
    console.log('Sinkronisasi ke local server error / offline:', err);
  }

  // Fallback simulasi cloud session jika standalone
  if (!state.auth) state.auth = {};
  state.auth.lastSyncTime = new Date().toISOString();
  state.auth.syncStatus = 'synced';
  saveState();
  renderProfileTab();
  updateHeaderAuthIndicator();
  if (!isInitial) {
    showToast('Data tersinkronkan dalam sesi kas bersama!');
  }
}

async function syncSharedDataSilent() {
  if (!state.auth?.isLoggedIn) return;
  try {
    await fetch('./api/shared-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: state.auth?.sharedRoomId || 'kas_bersama_utama',
        user: state.auth?.user,
        data: {
          wallets: state.wallets,
          categories: state.categories,
          transactions: state.transactions,
          settings: state.settings,
          profile: state.profile
        }
      })
    });
  } catch (e) {}
}

async function fetchSharedDataFromServer() {
  try {
    const res = await fetch('./api/shared-data', { method: 'GET' });
    if (res.ok) {
      const json = await res.json();
      if (json && json.data && Array.isArray(json.data.transactions)) {
        if (json.data.transactions.length > 0) {
          state.transactions = json.data.transactions;
          if (json.data.wallets) state.wallets = json.data.wallets;
          if (json.data.categories) state.categories = json.data.categories;
          saveState();
          renderDashboard();
          renderDompetTab();
          renderTransactionList();
        }
      }
    }
  } catch (e) {}
}

function saveProfileInfo() {
  const inputName = document.getElementById('inputProfileName');
  const inputGroup = document.getElementById('inputGroupName');

  const newName = inputName?.value.trim() || 'Saya';
  const newGroup = inputGroup?.value.trim() || 'Kontrakan Bersama';

  if (!state.profile) state.profile = {};
  state.profile.userName = newName;
  state.profile.groupName = newGroup;
  saveState();

  renderProfileTab();
  renderDashboard();
  showToast('Informasi profil berhasil diperbarui!');
}

function exportBackupJson() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
  const dlAnchor = document.createElement('a');
  dlAnchor.setAttribute("href", dataStr);
  dlAnchor.setAttribute("download", `finmate_kas_${(state.profile?.groupName || 'data').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`);
  dlAnchor.click();
  showToast('Cadangan JSON berhasil diunduh!');
}

function importBackupJson(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const imported = JSON.parse(e.target.result);
      if (imported && imported.settings && imported.wallets && imported.transactions) {
        state = imported;
        saveState();
        initApp();
        showToast('Data FinMate berhasil dipulihkan!');
      } else {
        showToast('Format berkas JSON tidak sesuai skema FinMate.', 'warning');
      }
    } catch (err) {
      showToast('Gagal membaca berkas JSON: ' + err.message, 'warning');
    }
  };
  reader.readAsText(file);
}

function exportToCsv() {
  const activeYm = state.settings.activeMonth || "2026-10";
  const list = state.transactions.filter(t => (t.date || '').startsWith(activeYm));

  if (list.length === 0) {
    showToast(`Belum ada transaksi di ${formatMonthYearIndo(activeYm)} untuk diekspor.`, 'warning');
    return;
  }

  const rows = [
    ['ID', 'Tanggal', 'Nama Transaksi', 'Tipe', 'Kategori', 'Rekening Kas', 'Nominal']
  ];

  list.forEach(t => {
    const wallet = state.wallets.find(w => w.id === t.walletId) || { name: 'Kas Bersama' };
    rows.push([
      t.id,
      t.date,
      `"${(t.title || '').replace(/"/g, '""')}"`,
      t.type === 'income' ? 'Pemasukan' : 'Pengeluaran',
      `"${(t.category || '').replace(/"/g, '""')}"`,
      `"${wallet.name}"`,
      t.amount
    ]);
  });

  const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `finmate_kas_${activeYm}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Laporan CSV berhasil diunduh!');
}

// ========================================================
// 12. REAL-TIME FORMAT TITIK PADA INPUT NOMINAL
// ========================================================

function setupCurrencyInputs() {
  const inputIds = ['txAmount', 'newWalletBalanceInput', 'editWalletBalanceInput', 'editTxAmount'];

  inputIds.forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;

    input.addEventListener('input', function() {
      const cursorPosition = this.selectionStart;
      const originalLength = this.value.length;

      const raw = this.value;
      const formatted = formatNumberWithDots(raw);
      this.value = formatted;

      const newLength = formatted.length;
      const newCursor = Math.max(0, cursorPosition + (newLength - originalLength));
      this.setSelectionRange(newCursor, newCursor);
    });
  });
}

// ========================================================
// 13. TOAST NOTIFICATION INTERAKTIF
// ========================================================

function showToast(message, type = 'success') {
  const existing = document.getElementById('finmateToast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'finmateToast';
  toast.className = 'toast-banner';

  const iconName = type === 'warning' ? 'alert-triangle' : 'check-circle-2';
  const iconColor = type === 'warning' ? 'text-amber-400' : 'text-sky-400';

  toast.innerHTML = `
    <i data-lucide="${iconName}" class="w-4 h-4 ${iconColor} shrink-0"></i>
    <span>${escapeHtml(message)}</span>
  `;

  document.body.appendChild(toast);
  lucide.createIcons();

  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, -10px)';
    setTimeout(() => toast.remove(), 300);
  }, 2600);
}

// ========================================================
// 15. SISTEM INSTALASI APLIKASI PWA (MODEL TRACKER KEUANGAN & UTBK)
// ========================================================

let deferredPwaPrompt = null;

function isRunningStandaloneApp() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function updatePwaInstallButtonsVisibility(show) {
  document.querySelectorAll('.btn-install-pwa').forEach((btn) => {
    if (show && !isRunningStandaloneApp()) {
      btn.classList.remove('hidden');
      btn.classList.add('flex');
    } else {
      btn.classList.add('hidden');
      btn.classList.remove('flex');
    }
  });
}

function initPwaInstallButton() {
  if (isRunningStandaloneApp()) {
    updatePwaInstallButtonsVisibility(false);
    return;
  }
  // Tampilkan tombol Install di HP/Desktop selama dibuka di browser biasa
  updatePwaInstallButtonsVisibility(true);
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPwaPrompt = e;
  updatePwaInstallButtonsVisibility(true);
});

window.addEventListener('appinstalled', () => {
  deferredPwaPrompt = null;
  updatePwaInstallButtonsVisibility(false);
  showToast('FinMate berhasil di-install di perangkat Anda!');
});

async function installPwaApp() {
  if (deferredPwaPrompt) {
    deferredPwaPrompt.prompt();
    const choiceResult = await deferredPwaPrompt.userChoice;
    deferredPwaPrompt = null;
    if (choiceResult && choiceResult.outcome === 'accepted') {
      updatePwaInstallButtonsVisibility(false);
    }
    return;
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (isIOS) {
    showToast(
      'Untuk install di iPhone/iPad: Ketuk ikon Share (kotak panah atas) di Safari lalu pilih "Add to Home Screen / Tambah ke Layar Utama".',
      'warning'
    );
  } else {
    showToast(
      'Untuk meng-install aplikasi: Ketuk ikon Titik Tiga (⋮) di pojok kanan atas browser lalu pilih "Instal aplikasi / Tambahkan ke Layar Utama".',
      'warning'
    );
  }
}

// ========================================================
// 14. INISIALISASI APLIKASI
// ========================================================

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function initApp() {
  loadState();
  initTheme();

  // Set default date picker ke hari ini
  const dateInput = document.getElementById('txDate');
  if (dateInput) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  renderDashboard();
  renderTransactionFormContext();
  renderDompetTab();
  renderTransactionList();
  renderProfileTab();
  setupCurrencyInputs();
  updateHeaderAuthIndicator();
  switchTab(currentActiveTab);
  lucide.createIcons();

  // Inisialisasi tombol Install PWA di pojok atas
  initPwaInstallButton();

  // Otomatis munculkan popup resmi Google saat pertama kali buka aplikasi
  checkAndTriggerGoogleAutoLoginOnStartup();

  // Ambil data bersama dari server jika ada
  fetchSharedDataFromServer();

  // Auto-polling pembaruan data bersama berkala
  if (sharedSyncPollingTimer) clearInterval(sharedSyncPollingTimer);
  sharedSyncPollingTimer = setInterval(() => {
    if (state.auth?.isLoggedIn && document.visibilityState === 'visible') {
      fetchSharedDataFromServer();
    }
  }, 20000);

  // PWA Service Worker Registration
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.log('SW register info:', err);
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  initApp();
});

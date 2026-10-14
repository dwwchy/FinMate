/**
 * FinMate — Data Model Keuangan Bersama & Multi-Rekening
 * Sistem Rollover Saldo Bulanan & Kategori Terpisah
 */

const initialData = {
  profile: {
    userName: "Saya",
    userRole: "Pengelola Kas",
    userAvatar: "👤",
    groupName: "Kontrakan Bersama"
  },
  auth: {
    isLoggedIn: false,
    provider: null,
    user: null, // { name: "", email: "", photoURL: "", id: "" }
    lastSyncTime: null,
    syncStatus: "idle", // "idle" | "syncing" | "synced" | "error"
    sharedRoomId: "kas_kontrakan_bersama"
  },
  googleAccount: null, // { name, email, picture, accessToken, driveFolderId, connectedAt, autoBackup }
  deviceGoogleAccounts: [],
  driveBackups: [],
  settings: {
    activeMonth: "2026-10",       // YYYY-MM yang sedang aktif dilihat
    theme: "dark",               // "dark" | "light"
    currency: "IDR",
    firstOpenedDate: "2026-10-13", // Tanggal awal buka aplikasi
    cloudSyncEnabled: true
  },
  // Rekening / Sumber Dana Kas (Bank dan Cash dengan saldo awal 0)
  wallets: [
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
  ],
  // Kategori Transaksi (Dikosongkan agar diisi sendiri oleh pengguna)
  categories: {
    income: [],
    expense: []
  },
  // Transaksi Kosongan (Tanpa data awal kecuali ditambah oleh pengguna)
  transactions: []
};

// Format Rupiah Tampilan (e.g. "Rp 150.000")
function formatRp(amount) {
  const num = Number(amount) || 0;
  return 'Rp ' + Math.round(num).toLocaleString('id-ID');
}

// Format Angka Ribuan dengan Titik (e.g. "150.000")
function formatNumberWithDots(val) {
  if (val === null || val === undefined || val === '') return '';
  const clean = val.toString().replace(/\D/g, '');
  if (!clean) return '';
  return new Intl.NumberFormat('id-ID').format(clean);
}

// Parse String Ribuan ke Integer Bersih
function parseNumberFromDots(val) {
  if (!val) return 0;
  const clean = val.toString().replace(/\D/g, '');
  return parseInt(clean, 10) || 0;
}

// Format Tanggal Bahasa Indonesia (e.g. "13 Oktober 2026")
function formatDateIndo(dateStr) {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parts[0];
    const monthIdx = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const months = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    return `${day} ${months[monthIdx] || ''} ${year}`;
  }
  return dateStr;
}

// Format Bulan & Tahun (e.g. "2026-10" -> "Oktober 2026")
function formatMonthYearIndo(ymStr) {
  if (!ymStr) return '-';
  const parts = ymStr.split('-');
  if (parts.length === 2) {
    const year = parts[0];
    const monthIdx = parseInt(parts[1], 10) - 1;
    const months = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    return `${months[monthIdx] || ''} ${year}`;
  }
  return ymStr;
}

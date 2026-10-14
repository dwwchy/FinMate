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
  // Rekening / Sumber Dana Kas (Bisa ditambah oleh user di Tab Dompet)
  wallets: [
    {
      id: "kas_bersama",
      name: "Kas Bersama",
      initialBalance: 1500000,
      color: "#38BDF8",
      isDefault: true
    },
    {
      id: "jatah_bulanan",
      name: "Jatah Bulanan",
      initialBalance: 500000,
      color: "#818CF8",
      isDefault: false
    },
    {
      id: "sumber_lain",
      name: "Sumber Lainnya",
      initialBalance: 200000,
      color: "#34D399",
      isDefault: false
    }
  ],
  // Kategori Terpisah: Pemasukan (2 sumber) vs Pengeluaran (Bisa ditambah user)
  categories: {
    income: [
      "Gaji / Jatah Bulanan",
      "Sumber Lainnya"
    ],
    expense: [
      "Air dan Galon",
      "Token Listrik",
      "Dapur Umum & Beras",
      "WiFi & Internet",
      "Sewa / Kontrakan",
      "Lain-lain"
    ]
  },
  transactions: [
    {
      id: "trx-1",
      title: "Token Listrik Rumah",
      amount: 100000,
      type: "expense",
      category: "Token Listrik",
      walletId: "kas_bersama",
      date: "2026-10-13",
      notes: "• Token PLN Prabayar 50kWh: Rp 100.000\n• No Meter: 3201-9981-4451\n• Kode Stroom: 4521-8790-2341-9988\n• Bukti pembelian via m-Banking",
      receiptImage: ""
    },
    {
      id: "trx-2",
      title: "Jatah Bulanan Anggota",
      amount: 500000,
      type: "income",
      category: "Gaji / Jatah Bulanan",
      walletId: "jatah_bulanan",
      date: "2026-10-12",
      notes: "• Setoran kas jatah bulanan kontrakan periode Oktober 2026",
      receiptImage: ""
    },
    {
      id: "trx-3",
      title: "Isi Ulang Air & Galon",
      amount: 40000,
      type: "expense",
      category: "Air dan Galon",
      walletId: "kas_bersama",
      date: "2026-10-11",
      notes: "• Isi ulang air mineral 2 galon @ Rp 20.000 = Rp 40.000\n• Pembelian di Depot Air Berkah Jl. Melati",
      receiptImage: ""
    },
    {
      id: "trx-4",
      title: "Setoran Kas Sumber Lain",
      amount: 200000,
      type: "income",
      category: "Sumber Lainnya",
      walletId: "sumber_lain",
      date: "2026-10-10",
      notes: "• Pengembalian uang sisa belanja konsumsi rapat bulan lalu",
      receiptImage: ""
    }
  ]
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

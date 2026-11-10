const API_URL = (typeof CONFIG !== 'undefined' && CONFIG.API_URL)
  ? CONFIG.API_URL
  : "https://script.google.com/macros/s/AKfycbz3LraveIpKMeajlIpnf5KcG4vGffBtdkY9LtFucyhwbTUVEWPKWLW8vDlwdVbmJ0REMg/exec";

let currentUser = null;
let cardPool = [];
let cardMap = new Map(); // O(1) lookup
let userInventory = [];
let inventoryCardIndexMap = new Map(); // O(1) last index lookup for recent sort
let currentFilter = 'ALL';
let currentSort = 'recent';
let activeSelectedCard = null;
let pollingTimer = null;

// ==========================================
// 1. SERVICE WORKER & SISTEM NOTIFIKASI
// ==========================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    reg.update();
  }).catch(console.error);
}

// Kirim Perintah Tampilkan Notifikasi ke Service Worker
function sendSWNotification(title, bodyText) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'TRIGGER_NOTIFICATION',
      title: title,
      options: {
        body: bodyText,
        vibrate: [200, 100, 200]
      }
    });
  } else if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then((reg) => {
      reg.showNotification(title, {
        body: bodyText,
        icon: '/icon.png',
        badge: '/icon.png',
        vibrate: [200, 100, 200]
      });
    });
  }
}

// Pemicu Izin Notifikasi Langsung (User Gesture)
async function triggerDirectNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        updateNotifStatusUI(true);
        sendSWNotification('AnimeGacha Aktif! ✨', 'Izin notifikasi berhasil diaktifkan di perangkatmu.');
      }
    } catch (e) {
      console.error(e);
    }
  }
}

function updateNotifStatusUI(isEnabled) {
  const container = document.getElementById('notifBadgeContainer');
  const text = document.getElementById('notifStatusText');
  if (!container || !text) return;

  if (isEnabled) {
    container.innerHTML = `
      <span class="badge-notif-active">✅ Notifikasi Aktif</span>
      <button id="btnTestNotif" class="btn-secondary" style="font-size:0.75rem; padding:4px 8px; margin-top:4px;">🔔 Tes Notif HP</button>
    `;
    text.textContent = 'Pengingat tiket otomatis setiap pukul 00:00 WIB.';
  } else {
    container.innerHTML = '<button id="btnManualNotif" class="btn-secondary">Aktifkan</button>';
    text.textContent = 'Izin notifikasi belum diaktifkan di peramban.';
    const btn = document.getElementById('btnManualNotif');
    if (btn) {
      btn.addEventListener('click', async () => {
        const p = await Notification.requestPermission();
        if (p === 'granted') {
          updateNotifStatusUI(true);
          sendSWNotification('AnimeGacha Aktif! ✨', 'Notifikasi berhasil diaktifkan!');
        }
      });
    }
  }
}

// Timer Pengingat Reset Tiket Jam 00:00 WIB
function scheduleMidnightResetNotification() {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  setTimeout(() => {
    sendSWNotification(
      'AnimeGacha - Tiket Direset! 🎟️',
      '10 Tiket harian gratis kamu sudah diisi ulang. Ayo tarik kartu baru hari ini!'
    );
    refreshCurrentUserData();
    scheduleMidnightResetNotification();
  }, msUntilMidnight);
}

// Pengecek Notifikasi Personal & Broadcast Admin
async function checkPendingNotifications() {
  if (!currentUser || !('Notification' in window) || Notification.permission !== 'granted') return;
  // Jangan buang resource jaringan jika tab sedang diminimalkan/tidak aktif
  if (document.hidden) return;

  try {
    const res = await fetch(`${API_URL}?action=check_notifications&username=${encodeURIComponent(currentUser.username)}`);
    const data = await res.json();

    if (data.status === 'success') {
      // 1. Notifikasi Tiket Diubah Admin
      if (data.user_notif) {
        sendSWNotification('AnimeGacha - Tiket Diperbarui! 🎟️', data.user_notif);
        refreshCurrentUserData();
      }

      // 2. Notifikasi Broadcast Pengumuman
      if (data.announcement) {
        const lastSeen = localStorage.getItem('last_seen_announcement');
        if (lastSeen !== data.announcement.id) {
          sendSWNotification(data.announcement.title, data.announcement.message);
          localStorage.setItem('last_seen_announcement', data.announcement.id);
        }
      }
    }
  } catch (err) {
    console.error('Gagal mengecek notifikasi:', err);
  }
}

async function refreshCurrentUserData() {
  const pin = localStorage.getItem('gacha_pin');
  if (currentUser && pin) {
    const res = await callAPI({ action: 'login', username: currentUser.username, pin: pin });
    if (res.status === 'success') {
      applyUserData(res.user, res.inventory);
    }
  }
}

// Event Delegation Tombol Tes Notifikasi
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'btnTestNotif') {
    sendSWNotification('AnimeGacha Berhasil! 🎟️', 'Sistem notifikasi di HP Android kamu sudah aktif sempurna!');
  }
});

// Helper Request POST Google Apps Script
async function callAPI(payload) {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    return { status: 'error', message: 'Koneksi ke backend gagal!' };
  }
}

function rebuildCardMap() {
  cardMap.clear();
  for (let i = 0; i < cardPool.length; i++) {
    cardMap.set(cardPool[i].id, cardPool[i]);
  }
}

function rebuildInventoryIndexMap() {
  inventoryCardIndexMap.clear();
  for (let i = 0; i < userInventory.length; i++) {
    inventoryCardIndexMap.set(userInventory[i].card_id, i);
  }
}

// Ambil Card Pool dengan strategi Stale-While-Revalidate
async function loadCardPool() {
  const cacheKey = (typeof CONFIG !== 'undefined' && CONFIG.CACHE_KEYS.CARD_POOL) || 'animegacha_card_pool_cache';

  // 1. Render instan dari cache lokal (0ms)
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cardPool = parsed;
        rebuildCardMap();
        renderSSRPoolPreview();
        if (currentUser) {
          updateStats();
          updateAlbumCounts();
          renderAlbum();
        }
      }
    }
  } catch (e) {
    console.warn("Gagal membaca cache lokal:", e);
  }

  // 2. Fetch data terbaru di latar belakang
  try {
    const poolRes = await fetch(`${API_URL}?action=get_pool`);
    const poolJson = await poolRes.json();
    if (poolJson.status === 'success' && Array.isArray(poolJson.cards)) {
      cardPool = poolJson.cards;
      rebuildCardMap();
      renderSSRPoolPreview();
      try {
        localStorage.setItem(cacheKey, JSON.stringify(cardPool));
      } catch (e) {}

      if (currentUser) {
        updateStats();
        updateAlbumCounts();
        renderAlbum();
      }
    }
  } catch (e) {
    console.error("Gagal load kartu terbaru:", e);
  }
}

// Inisialisasi Lifecycle & Visibility Listener
function setupVisibilityAwarePolling() {
  const intervalTime = (typeof CONFIG !== 'undefined' && CONFIG.POLLING_INTERVAL_MS) || 45000;

  if (pollingTimer) clearInterval(pollingTimer);
  pollingTimer = setInterval(checkPendingNotifications, intervalTime);

  // Jika tab kembali aktif, langsung cek notifikasi pending
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentUser) {
      checkPendingNotifications();
    }
  });
}

// ==========================================
// 2. INISIALISASI APLIKASI
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupFilters();
  setupSort();
  setupRulesModal();

  if ('Notification' in window) {
    updateNotifStatusUI(Notification.permission === 'granted');
  }

  // Load pool kartu secara instan via cache lalu background update
  loadCardPool();

  // Cek Status Sesi Login dengan Instant Cache Resume (0 ms)
  const savedUser = localStorage.getItem('gacha_user');
  const savedPin = localStorage.getItem('gacha_pin');
  const userCacheKey = (typeof CONFIG !== 'undefined' && CONFIG.CACHE_KEYS.USER_DATA) || 'animegacha_user_data_cache';

  if (savedUser && savedPin) {
    // 1. Langsung tutup modal login dan tampilkan data terakhir jika ada
    document.getElementById('authModal').classList.add('hidden');
    try {
      const cachedUserData = localStorage.getItem(userCacheKey);
      if (cachedUserData) {
        const parsed = JSON.parse(cachedUserData);
        if (parsed.user && parsed.user.username === savedUser) {
          applyUserData(parsed.user, parsed.inventory || []);
        }
      } else {
        // Fallback cepat: tampilkan username di navbar
        document.getElementById('navUsername').textContent = savedUser;
        document.getElementById('profileUsername').textContent = savedUser;
      }
    } catch (e) {
      console.warn("Gagal membaca cache user data:", e);
    }

    // 2. Verifikasi dan sinkronisasi data terbaru di latar belakang
    loginUser(savedUser, savedPin);
  } else {
    document.getElementById('authModal').classList.remove('hidden');
  }

  setupVisibilityAwarePolling();
});

// ==========================================
// 3. LOGIN & MANAJEMEN USER
// ==========================================
document.getElementById('btnLogin').addEventListener('click', async () => {
  triggerDirectNotificationPermission();

  const username = document.getElementById('authUsername').value.trim();
  const pin = document.getElementById('authPin').value.trim();
  const errBox = document.getElementById('authError');

  if (!username || pin.length !== 4) {
    errBox.textContent = 'Isi username dan 4 digit PIN!';
    return;
  }

  errBox.textContent = 'Menghubungkan...';
  const res = await callAPI({ action: 'login', username, pin });

  if (res.status === 'success') {
    localStorage.setItem('gacha_user', username);
    localStorage.setItem('gacha_pin', pin);
    const userCacheKey = (typeof CONFIG !== 'undefined' && CONFIG.CACHE_KEYS.USER_DATA) || 'animegacha_user_data_cache';
    try {
      localStorage.setItem(userCacheKey, JSON.stringify({ user: res.user, inventory: res.inventory }));
    } catch (e) {}

    applyUserData(res.user, res.inventory);
    document.getElementById('authModal').classList.add('hidden');
    errBox.textContent = '';

    scheduleMidnightResetNotification();
    setTimeout(checkPendingNotifications, 1500);
  } else {
    errBox.textContent = res.message;
  }
});

async function loginUser(username, pin) {
  const res = await callAPI({ action: 'login', username, pin });
  if (res.status === 'success') {
    const userCacheKey = (typeof CONFIG !== 'undefined' && CONFIG.CACHE_KEYS.USER_DATA) || 'animegacha_user_data_cache';
    try {
      localStorage.setItem(userCacheKey, JSON.stringify({ user: res.user, inventory: res.inventory }));
    } catch (e) {}

    applyUserData(res.user, res.inventory);
    document.getElementById('authModal').classList.add('hidden');
    scheduleMidnightResetNotification();
    setTimeout(checkPendingNotifications, 1500);
  } else {
    // Jika PIN salah atau akun bermasalah di backend, baru bersihkan sesi dan buka modal
    localStorage.clear();
    currentUser = null;
    document.getElementById('authModal').classList.remove('hidden');
  }
}

function applyUserData(user, inventory) {
  currentUser = user;
  userInventory = inventory || [];
  rebuildInventoryIndexMap();

  const userCacheKey = (typeof CONFIG !== 'undefined' && CONFIG.CACHE_KEYS.USER_DATA) || 'animegacha_user_data_cache';
  try {
    localStorage.setItem(userCacheKey, JSON.stringify({ user: currentUser, inventory: userInventory }));
  } catch (e) {}

  document.getElementById('navUsername').textContent = user.username;
  document.getElementById('profileUsername').textContent = user.username;
  document.getElementById('ticketCount').textContent = user.tickets;
  document.getElementById('shardCount').textContent = user.shards;
  document.getElementById('pityText').textContent = `${user.pity_count} / 30`;
  document.getElementById('pityFill').style.width = `${(user.pity_count / 30) * 100}%`;

  updateStats();
  updateAlbumCounts();
  renderAlbum();
}

// ==========================================
// 4. SISTEM TARIK GACHA & ANIMASI 3D
// ==========================================
const btnPull = document.getElementById('btnPull');
const gachaCard = document.getElementById('gachaCard');

btnPull.addEventListener('click', async () => {
  if (currentUser.tickets < 1) {
    alert('Tiket harianmu sudah habis!');
    return;
  }

  btnPull.disabled = true;
  btnPull.textContent = 'Menarik Kartu...';
  gachaCard.classList.remove('flipped');

  const res = await callAPI({
    action: 'pull',
    username: currentUser.username,
    pin: localStorage.getItem('gacha_pin')
  });

  btnPull.disabled = false;
  btnPull.textContent = '✨ Tarik Gacha (1 Tiket)';

  if (res.status === 'success') {
    currentUser.tickets = res.stats.tickets;
    currentUser.shards = res.stats.shards;
    currentUser.pity_count = res.stats.pity_count;
    currentUser.total_pulls = res.stats.total_pulls;

    const backBadge = document.getElementById('backRarity');
    backBadge.textContent = res.card.rarity;
    backBadge.className = `rarity-badge ${res.card.rarity}`;
    document.getElementById('backImg').src = res.card.image_url;
    document.getElementById('backName').textContent = res.card.name;
    document.getElementById('backAnime').textContent = res.card.anime;

    setTimeout(() => {
      gachaCard.classList.add('flipped');
    }, 200);

    userInventory.push({ card_id: res.card.id, obtained_at: new Date().toISOString() });
    if (!cardMap.has(res.card.id)) {
      cardMap.set(res.card.id, res.card);
      cardPool.push(res.card);
    }
    applyUserData(currentUser, userInventory);

    if (res.is_duplicate) {
      setTimeout(() => alert('Kartu kembar! Kamu dapat +1 Star Shard ⭐'), 850);
    }
  } else {
    alert(res.message);
  }
});

gachaCard.addEventListener('click', () => {
  gachaCard.classList.toggle('flipped');
});

// ==========================================
// 5. ALBUM KOLEKSI (FILTER & SORTING)
// ==========================================
function updateAlbumCounts() {
  const ownedIdSet = new Set();
  for (let i = 0; i < userInventory.length; i++) {
    ownedIdSet.add(userInventory[i].card_id);
  }

  let totalAll = 0;
  let countSSR = 0;
  let countSR = 0;
  let countR = 0;

  ownedIdSet.forEach(id => {
    const card = cardMap.get(id);
    if (card) {
      totalAll++;
      if (card.rarity === 'SSR') countSSR++;
      else if (card.rarity === 'SR') countSR++;
      else if (card.rarity === 'R') countR++;
    }
  });

  document.getElementById('albumTotalCountBadge').textContent = `${totalAll} Kartu`;
  document.getElementById('countFilterALL').textContent = `(${totalAll})`;
  document.getElementById('countFilterSSR').textContent = `(${countSSR})`;
  document.getElementById('countFilterSR').textContent = `(${countSR})`;
  document.getElementById('countFilterR').textContent = `(${countR})`;
}

function renderAlbum() {
  const grid = document.getElementById('albumGrid');
  grid.innerHTML = '';

  const ownedIdSet = new Set();
  for (let i = 0; i < userInventory.length; i++) {
    ownedIdSet.add(userInventory[i].card_id);
  }

  let cardsToDisplay = [];
  ownedIdSet.forEach(id => {
    const card = cardMap.get(id);
    if (card) {
      if (currentFilter === 'ALL' || card.rarity === currentFilter) {
        cardsToDisplay.push(card);
      }
    }
  });

  if (currentSort === 'recent') {
    cardsToDisplay.sort((a, b) => {
      const idxA = inventoryCardIndexMap.get(a.id) ?? -1;
      const idxB = inventoryCardIndexMap.get(b.id) ?? -1;
      return idxB - idxA;
    });
  } else if (currentSort === 'name') {
    cardsToDisplay.sort((a, b) => a.name.localeCompare(b.name));
  } else if (currentSort === 'rarity') {
    const weight = { 'SSR': 3, 'SR': 2, 'R': 1 };
    cardsToDisplay.sort((a, b) => (weight[b.rarity] || 0) - (weight[a.rarity] || 0));
  }

  document.getElementById('albumStatusText').textContent =
    `Menampilkan ${cardsToDisplay.length} dari ${ownedIdSet.size} koleksi`;
  document.getElementById('emptyAlbumMsg').classList.toggle('hidden', cardsToDisplay.length > 0);

  const fragment = document.createDocumentFragment();
  cardsToDisplay.forEach(card => {
    const item = document.createElement('div');
    item.className = 'album-card-item';
    item.innerHTML = `
      <div class="rarity-badge ${card.rarity}">${card.rarity}</div>
      <img src="${card.image_url}" loading="lazy" alt="${card.name}">
    `;
    item.addEventListener('click', () => openCardDetail(card));
    fragment.appendChild(item);
  });
  grid.appendChild(fragment);
}

function setupSort() {
  const sortSelect = document.getElementById('albumSort');
  sortSelect.addEventListener('change', (e) => {
    currentSort = e.target.value;
    renderAlbum();
  });
}

function setupFilters() {
  const filterBtns = document.querySelectorAll('.btn-filter');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderAlbum();
    });
  });
}

// ==========================================
// 6. DETAIL MODAL & UNDUH MULTI-LAPIS
// ==========================================
function openCardDetail(card) {
  activeSelectedCard = card;
  document.getElementById('modalRarityBadge').textContent = card.rarity;
  document.getElementById('modalRarityBadge').className = `rarity-badge ${card.rarity}`;
  document.getElementById('modalCardImg').src = card.image_url;
  document.getElementById('modalCardName').textContent = card.name;
  document.getElementById('modalCardAnime').textContent = card.anime;
  document.getElementById('modalCardArtist').textContent = `Artist: ${card.artist || 'AniList'}`;
  document.getElementById('cardModal').classList.remove('hidden');
}

document.getElementById('btnCloseModal').addEventListener('click', () => {
  document.getElementById('cardModal').classList.add('hidden');
});

document.getElementById('btnDownloadCard').addEventListener('click', async () => {
  if (!activeSelectedCard) return;

  const btn = document.getElementById('btnDownloadCard');
  const originalText = '📥 Unduh Kartu ke Perangkat';
  btn.textContent = '⏳ Mengunduh...';
  btn.disabled = true;

  const cleanName = activeSelectedCard.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${cleanName}_${activeSelectedCard.rarity}.jpg`;
  const rawUrl = activeSelectedCard.image_url;

  function triggerBlobDownload(blob) {
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    }, 1500);
  }

  // Lapisan 1: Fresh Direct Fetch
  async function tryDirectFetch() {
    const fetchUrl = rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'download=1';
    const res = await fetch(fetchUrl, { mode: 'cors' });
    if (!res.ok) throw new Error('Direct fetch failed');
    const blob = await res.blob();
    triggerBlobDownload(blob);
    return true;
  }

  // Lapisan 2: HTML5 Canvas Export
  function tryCanvasDownload() {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          canvas.toBlob((blob) => {
            if (blob) {
              triggerBlobDownload(blob);
              resolve(true);
            } else {
              reject(new Error('Canvas export failed'));
            }
          }, 'image/jpeg', 0.95);
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('Image failed to load on canvas'));
      img.src = rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'cv=1';
    });
  }

  // Lapisan 3: Multi CORS Proxies
  async function tryProxyFetch() {
    const proxies = [
      `https://corsproxy.io/?url=${encodeURIComponent(rawUrl)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`,
      `https://wsrv.nl/?url=${encodeURIComponent(rawUrl)}&output=jpg`
    ];

    for (const proxy of proxies) {
      try {
        const res = await fetch(proxy);
        if (res.ok) {
          const blob = await res.blob();
          triggerBlobDownload(blob);
          return true;
        }
      } catch (e) {}
    }
    throw new Error('All proxies failed');
  }

  try {
    let success = false;
    try { success = await tryDirectFetch(); } catch (e) {}
    if (!success) {
      try { success = await tryCanvasDownload(); } catch (e) {}
    }
    if (!success) {
      success = await tryProxyFetch();
    }

    if (success) {
      btn.textContent = '✅ Berhasil Diunduh!';
    } else {
      throw new Error('Gagal');
    }
  } catch (err) {
    const a = document.createElement('a');
    a.href = rawUrl;
    a.target = '_blank';
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    btn.textContent = '↗️ Dibuka di Tab Baru';
  } finally {
    btn.disabled = false;
    setTimeout(() => {
      btn.textContent = originalText;
    }, 2500);
  }
});

// ==========================================
// 7. MODAL ATURAN & PREVIEW SSR
// ==========================================
function setupRulesModal() {
  document.getElementById('btnOpenRules').addEventListener('click', () => {
    document.getElementById('rulesModal').classList.remove('hidden');
  });

  document.getElementById('btnCloseRules').addEventListener('click', () => {
    document.getElementById('rulesModal').classList.add('hidden');
  });
}

function renderSSRPoolPreview() {
  const ssrGrid = document.getElementById('ssrPoolGrid');
  if (!ssrGrid) return;
  ssrGrid.innerHTML = '';

  const ssrCards = cardPool.filter(c => c.rarity === 'SSR').slice(0, 8);
  const fragment = document.createDocumentFragment();
  ssrCards.forEach(c => {
    const thumb = document.createElement('div');
    thumb.className = 'ssr-pool-thumb';
    thumb.title = `${c.name} (${c.anime})`;
    thumb.innerHTML = `<img src="${c.image_url}" loading="lazy" alt="${c.name}">`;
    fragment.appendChild(thumb);
  });
  ssrGrid.appendChild(fragment);
}

// ==========================================
// 8. TUKAR STAR SHARD & PROFIL
// ==========================================
document.getElementById('btnTradeShard').addEventListener('click', async () => {
  if (currentUser.shards < 5) {
    alert('Star Shard tidak cukup (minimal 5).');
    return;
  }

  const res = await callAPI({
    action: 'trade_shard',
    username: currentUser.username,
    pin: localStorage.getItem('gacha_pin')
  });

  if (res.status === 'success') {
    currentUser.tickets = res.tickets;
    currentUser.shards = res.shards;
    document.getElementById('ticketCount').textContent = res.tickets;
    document.getElementById('shardCount').textContent = res.shards;
    alert('Berhasil menukar 5 Star Shards jadi 1 Tiket!');
  } else {
    alert(res.message);
  }
});

function updateStats() {
  const total = currentUser.total_pulls || 0;
  const ownedIdSet = new Set();
  let countSSR = 0;
  let countSR = 0;

  for (let i = 0; i < userInventory.length; i++) {
    const inv = userInventory[i];
    ownedIdSet.add(inv.card_id);
    const card = cardMap.get(inv.card_id);
    if (card) {
      if (card.rarity === 'SSR') countSSR++;
      else if (card.rarity === 'SR') countSR++;
    }
  }

  document.getElementById('statTotalPulls').textContent = total;
  document.getElementById('statUniqueCards').textContent = ownedIdSet.size;
  document.getElementById('statRateSSR').textContent = total > 0 ? `${((countSSR / total) * 100).toFixed(1)}%` : '0%';
  document.getElementById('statRateSR').textContent = total > 0 ? `${((countSR / total) * 100).toFixed(1)}%` : '0%';
}

function setupTabs() {
  const navBtns = document.querySelectorAll('.bottom-nav .nav-item');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      navBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
}

document.getElementById('btnLogout').addEventListener('click', () => {
  localStorage.clear();
  location.reload();
});

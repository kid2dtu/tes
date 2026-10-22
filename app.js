const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz3LraveIpKMeajlIpnf5KcG4vGffBtdkY9LtFucyhwbTUVEWPKWLW8vDlwdVbmJ0REMg/exec";

let currentUser = JSON.parse(localStorage.getItem('gacha_user') || 'null');
let deferredPrompt = null;
let isFlipping = false;
let currentFilter = 'all';
let currentSort = 'date';
let lastKnownTickets = currentUser ? Number(currentUser.tickets || 0) : 0;
const syncChannel = new BroadcastChannel('gacha_sync');

// Database Karakter & Seri Anime
const ANIME_CHARACTER_DATABASE = [
  { char: 'Shirakami Fubuki', anime: 'Hololive' },
  { char: 'Rem', anime: 'Re:Zero' },
  { char: 'Emilia', anime: 'Re:Zero' },
  { char: 'Megumin', anime: 'KonoSuba' },
  { char: 'Aqua', anime: 'KonoSuba' },
  { char: 'Kurumi Tokisaki', anime: 'Date A Live' },
  { char: 'Marin Kitagawa', anime: 'My Dress-Up Darling' },
  { char: 'Yor Forger', anime: 'Spy × Family' },
  { char: 'Anya Forger', anime: 'Spy × Family' },
  { char: 'Raiden Shogun', anime: 'Genshin Impact' },
  { char: 'Hu Tao', anime: 'Genshin Impact' },
  { char: 'Furina', anime: 'Genshin Impact' },
  { char: 'Ganyu', anime: 'Genshin Impact' },
  { char: 'Firefly', anime: 'Honkai: Star Rail' },
  { char: 'Kafka', anime: 'Honkai: Star Rail' },
  { char: 'Sparkle', anime: 'Honkai: Star Rail' },
  { char: 'March 7th', anime: 'Honkai: Star Rail' },
  { char: 'Asuna Yuuki', anime: 'Sword Art Online' },
  { char: 'Sinon', anime: 'Sword Art Online' },
  { char: 'Zero Two', anime: 'Darling in the Franxx' },
  { char: 'Makima', anime: 'Chainsaw Man' },
  { char: 'Power', anime: 'Chainsaw Man' },
  { char: 'Chisato Nishikigi', anime: 'Lycoris Recoil' },
  { char: 'Takina Inoue', anime: 'Lycoris Recoil' },
  { char: 'Hitori Gotoh', anime: 'Bocchi the Rock!' },
  { char: 'Kita Ikuyo', anime: 'Bocchi the Rock!' },
  { char: 'Frieren', anime: 'Sousou no Frieren' },
  { char: 'Fern', anime: 'Sousou no Frieren' },
  { char: 'Kaguya Shinomiya', anime: 'Kaguya-sama: Love is War' },
  { char: 'Chika Fujiwara', anime: 'Kaguya-sama: Love is War' },
  { char: 'Saber', anime: 'Fate/stay night' },
  { char: 'Rin Tohsaka', anime: 'Fate/stay night' },
  { char: 'Mash Kyrielight', anime: 'Fate/Grand Order' },
  { char: 'Roxy Migurdia', anime: 'Mushoku Tensei' },
  { char: 'Sylphiette', anime: 'Mushoku Tensei' },
  { char: 'Eris Boreas', anime: 'Mushoku Tensei' },
  { char: 'Holo', anime: 'Spice and Wolf' },
  { char: 'Senko-san', anime: 'Sewayaki Kitsune no Senko-san' },
  { char: 'Raphtalia', anime: 'The Rising of the Shield Hero' },
  { char: 'Nezuko Kamado', anime: 'Demon Slayer' },
  { char: 'Shinobu Kocho', anime: 'Demon Slayer' },
  { char: 'Hatsune Miku', anime: 'Vocaloid' },
  { char: 'Kanna Kamui', anime: "Miss Kobayashi's Dragon Maid" },
  { char: 'Tohru', anime: "Miss Kobayashi's Dragon Maid" },
  { char: 'Shiroko', anime: 'Blue Archive' },
  { char: 'Hina', anime: 'Blue Archive' }
];

function resolveCardIdentity(card) {
  if (card.character_name && card.character_name !== 'Original Character') {
    return {
      char: card.character_name,
      anime: card.anime_name || 'Anime Series'
    };
  }
  if (card.anime_name && card.anime_name !== 'Original Character' && card.anime_name !== 'Anime Special') {
    return {
      char: card.anime_name,
      anime: 'Anime Series'
    };
  }

  let hash = 0;
  const str = card.url || '';
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return ANIME_CHARACTER_DATABASE[Math.abs(hash) % ANIME_CHARACTER_DATABASE.length];
}

window.addEventListener('DOMContentLoaded', () => {
  const modalAuth = document.getElementById('modalAuth');
  if (!currentUser) {
    if (modalAuth) modalAuth.style.display = 'flex';
  } else {
    if (modalAuth) modalAuth.style.display = 'none';
    renderUI();
    syncUserData();
  }

  initPWA();
  initTabs();
  initCountdown();
  initSyncListener();
  initCardDetailModal();
  initSortListener();
});

// 1. Sinkronisasi Realtime dengan Admin
function initSyncListener() {
  syncChannel.onmessage = (event) => {
    if (event.data && event.data.type === 'TICKET_UPDATED') {
      if (currentUser && currentUser.username === event.data.targetUser) {
        currentUser.tickets = event.data.newTicket;
        localStorage.setItem('gacha_user', JSON.stringify(currentUser));
        renderUI();
        if (event.data.newTicket === 10) {
          fireTicketNotification('Tiket Diisi Ulang! 🎟️', 'Admin baru saja menambahkan 10 tiket gacha untukmu!');
        }
      }
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentUser) {
      syncUserData();
    }
  });
}

// 2. Inisialisasi PWA & Notifikasi
function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const pwaBox = document.getElementById('pwaInstallContainer');
    if (pwaBox) pwaBox.style.display = 'flex';
  });

  const btnInstall = document.getElementById('btnInstallPwa');
  if (btnInstall) {
    btnInstall.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          const pwaBox = document.getElementById('pwaInstallContainer');
          if (pwaBox) pwaBox.style.display = 'none';
        }
        deferredPrompt = null;
      } else {
        showToast('Buka menu browser (titik 3) -> Tambahkan ke Layar Utama');
      }
    });
  }

  const btnNotif = document.getElementById('btnIzinNotif');
  if (btnNotif) {
    btnNotif.addEventListener('click', async () => {
      await requestNotificationDirect();
    });
  }
}

async function requestNotificationDirect() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') return;

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      showToast('Notifikasi tiket & gacha aktif! 🔔');
      fireTicketNotification('Notifikasi Aktif! 🔔', 'Pemberitahuan tiket harian & kartu langka siap dikirim!');
    }
  } catch (err) {
    console.warn('Izin notifikasi ditolak/gagal:', err);
  }
}

function fireTicketNotification(title, body) {
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'NOTIF_RESET', title, body });
  } else if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body: body,
      icon: '/icon.png'
    });
  }
}

// 3. Hitung Mundur Reset 00:00 WIB
function initCountdown() {
  let hasTriggeredMidnight = false;

  function updateTimer() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const diff = tomorrow - now;

    if (diff <= 2000 && !hasTriggeredMidnight) {
      hasTriggeredMidnight = true;
      fireTicketNotification('Tiket Harian Siap! 🎟️', 'Sudah jam 00:00 WIB! 10 Tiket barumu sudah masuk, yuk gacha!');
      if (currentUser) syncUserData();
      setTimeout(() => { hasTriggeredMidnight = false; }, 5000);
    }

    const jam = String(Math.floor((diff / (1000 * 60 * 60)) % 24)).padStart(2, '0');
    const mnt = String(Math.floor((diff / (1000 * 60)) % 60)).padStart(2, '0');
    const dtk = String(Math.floor((diff / 1000) % 60)).padStart(2, '0');
    const el = document.getElementById('txtCountdown');
    if (el) el.innerText = `${jam}:${mnt}:${dtk}`;
  }
  updateTimer();
  setInterval(updateTimer, 1000);
}

// 4. Autentikasi Akun
const btnAuth = document.getElementById('btnAuthSubmit');
if (btnAuth) {
  btnAuth.addEventListener('click', async () => {
    const username = document.getElementById('authUsername').value.trim().toLowerCase();
    const pin = document.getElementById('authPin').value.trim();
    const errBox = document.getElementById('authError');

    if (!username || pin.length !== 4) {
      errBox.innerText = 'Username wajib diisi & PIN harus 4 digit angka!';
      return;
    }

    requestNotificationDirect();

    errBox.innerText = '';
    btnAuth.disabled = true;
    btnAuth.innerText = 'Memeriksa akun...';

    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'login', username, pin })
      });
      const result = await res.json();

      if (result.success) {
        currentUser = {
          username: result.username,
          pin: pin,
          tickets: result.tickets,
          koleksi: result.koleksi || []
        };
        lastKnownTickets = result.tickets;
        localStorage.setItem('gacha_user', JSON.stringify(currentUser));
        document.getElementById('modalAuth').style.display = 'none';
        renderUI();
        showToast(result.isNew ? 'Akun baru berhasil dibuat! 🎟️' : 'Selamat datang kembali!');
      } else {
        errBox.innerText = result.message || 'Login gagal';
      }
    } catch (err) {
      errBox.innerText = 'Gagal terhubung ke database. Coba lagi.';
    } finally {
      btnAuth.disabled = false;
      btnAuth.innerText = 'Masuk / Daftar';
    }
  });
}

// 5. Sinkronisasi Data & Sensor Reset Tiket
async function syncUserData() {
  if (!currentUser) return;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'login', username: currentUser.username, pin: currentUser.pin })
    });
    const result = await res.json();
    if (result.success) {
      if (lastKnownTickets < 10 && result.tickets === 10) {
        fireTicketNotification('Tiket Harian Siap! 🎟️', 'Tiket kamu sudah terisi ulang jadi 10! Ayo gacha lagi!');
      }
      lastKnownTickets = result.tickets;
      currentUser.tickets = result.tickets;
      currentUser.koleksi = result.koleksi || [];
      localStorage.setItem('gacha_user', JSON.stringify(currentUser));
      renderUI();
    }
  } catch (e) {
    console.warn('Gagal sinkron server, memakai data lokal:', e);
  }
}

function renderUI() {
  if (!currentUser) return;
  const headerUser = document.getElementById('headerUsername');
  const profileUser = document.getElementById('profileUsername');
  const txtTiket = document.getElementById('txtTiket');

  if (headerUser) headerUser.innerText = `@${currentUser.username}`;
  if (profileUser) profileUser.innerText = `@${currentUser.username}`;
  if (txtTiket) txtTiket.innerText = currentUser.tickets;
  renderGallery(currentFilter);
}

// 6. Tarik Gacha + Notifikasi Khusus SR / SSR
const btnGacha = document.getElementById('btnTarikGacha');
if (btnGacha) {
  btnGacha.addEventListener('click', async () => {
    if (isFlipping) return;
    if (!currentUser || currentUser.tickets <= 0) {
      return showToast('Tiket harian habis! Balik lagi besok jam 00:00 WIB.');
    }

    const cardWrapper = document.getElementById('kartuWrapper');
    const cardFront = document.getElementById('kartuDepan');

    isFlipping = true;
    btnGacha.disabled = true;

    cardWrapper.classList.remove('flipped');
    await new Promise(r => setTimeout(r, 350));
    showToast('Memanggil kartu anime...');

    const roll = Math.random() * 100;
    let rarity = 'R';
    let endpoint = 'neko';

    if (roll <= 5) {
      rarity = 'SSR';
      endpoint = 'smug';
    } else if (roll <= 30) {
      rarity = 'SR';
      endpoint = 'kitsune';
    } else {
      rarity = 'R';
      endpoint = 'waifu';
    }

    try {
      const res = await fetch(`https://nekos.best/api/v2/${endpoint}`);
      const data = await res.json();
      const item = data.results[0];

      const identity = resolveCardIdentity({ url: item.url, anime_name: item.anime_name });
      const charName = (item.anime_name && item.anime_name !== 'Original Character') ? item.anime_name : identity.char;
      const animeName = identity.anime;

      const newCard = {
        url: item.url,
        artist_name: item.artist_name || 'Artis Komunitas',
        character_name: charName,
        anime_name: animeName,
        rarity: rarity,
        date: new Date().toLocaleDateString('id-ID')
      };

      cardFront.className = `card-face card-front rarity-${rarity}`;
      document.getElementById('kartuRarity').innerText = rarity;
      document.getElementById('kartuImg').src = newCard.url;
      document.getElementById('kartuAnime').innerText = newCard.character_name;
      document.getElementById('kartuArtist').innerText = `Artis: ${newCard.artist_name}`;

      currentUser.tickets = Math.max(0, currentUser.tickets - 1);
      lastKnownTickets = currentUser.tickets;
      currentUser.koleksi.unshift(newCard);
      localStorage.setItem('gacha_user', JSON.stringify(currentUser));
      document.getElementById('txtTiket').innerText = currentUser.tickets;

      document.getElementById('kartuImg').onload = () => {
        cardWrapper.classList.add('flipped');
        isFlipping = false;
        btnGacha.disabled = false;

        if (rarity === 'SSR') {
          fireTicketNotification('✨ DAPAT KARTU SSR! ✨', `Luar biasa! Kamu baru saja mendapatkan ${newCard.character_name} (${newCard.anime_name}) dengan kelangkaan SSR!`);
        } else if (rarity === 'SR') {
          fireTicketNotification('🌟 DAPAT KARTU SR! 🌟', `Keren! Kamu berhasil mendapatkan ${newCard.character_name} (${newCard.anime_name}) dengan kelangkaan SR!`);
        }
      };

      fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'gacha',
          username: currentUser.username,
          pin: currentUser.pin,
          kartu: newCard
        })
      }).catch(console.error);

    } catch (err) {
      showToast('Koneksi lambat. Coba lagi.');
      isFlipping = false;
      btnGacha.disabled = false;
    }
  });
}

const cardWrapper = document.getElementById('kartuWrapper');
if (cardWrapper) {
  cardWrapper.addEventListener('click', () => {
    const img = document.getElementById('kartuImg');
    if (img && img.src) {
      cardWrapper.classList.toggle('flipped');
    }
  });
}

// 7. Album Galeri Koleksi (Filter & Sortir Dinamis)
function renderGallery(filter = 'all') {
  currentFilter = filter;
  const container = document.getElementById('gridGaleri');
  const emptyBox = document.getElementById('galeriKosong');
  const countBadge = document.getElementById('txtKoleksiCount');
  if (!container || !emptyBox) return;

  container.innerHTML = '';
  
  // Beri penanda urutan asli index agar sortir tanggal tetap konsisten (0 = terbaru)
  const cards = (currentUser && currentUser.koleksi) 
    ? currentUser.koleksi.map((c, idx) => ({ ...c, _origIdx: idx })) 
    : [];

  // Filter Kelangkaan
  let filtered = filter === 'all' ? [...cards] : cards.filter(c => c.rarity === filter);

  // Perbarui Angka Jumlah Koleksi
  if (countBadge) {
    countBadge.innerText = `${filtered.length} Kartu`;
  }

  if (filtered.length === 0) {
    emptyBox.style.display = 'block';
    return;
  }
  emptyBox.style.display = 'none';

  // Logika Pengurutan
  const rarityRank = { 'SSR': 3, 'SR': 2, 'R': 1 };
  filtered.sort((a, b) => {
    if (currentSort === 'name') {
      const nameA = resolveCardIdentity(a).char;
      const nameB = resolveCardIdentity(b).char;
      return nameA.localeCompare(nameB);
    } else if (currentSort === 'rarity') {
      const rankDiff = (rarityRank[b.rarity] || 0) - (rarityRank[a.rarity] || 0);
      if (rankDiff !== 0) return rankDiff;
      return a._origIdx - b._origIdx;
    } else {
      // Default: Tanggal / Urutan dapat terbaru
      return a._origIdx - b._origIdx;
    }
  });

  filtered.forEach(c => {
    const identity = resolveCardIdentity(c);
    const charName = identity.char;

    const el = document.createElement('div');
    el.className = `mini-card rarity-${c.rarity}`;
    el.innerHTML = `
      <img src="${c.url}" loading="lazy" alt="${charName}">
      <div class="mini-card-info">
        <span class="m-rarity" style="color: var(--rarity-${c.rarity.toLowerCase()})">${c.rarity}</span>
        <h4>${charName}</h4>
      </div>
    `;

    el.addEventListener('click', () => {
      openCardDetail({
        url: c.url,
        rarity: c.rarity,
        character_name: charName,
        anime_name: identity.anime,
        artist_name: c.artist_name || 'Artis Komunitas',
        date: c.date || 'Hari ini'
      });
    });

    container.appendChild(el);
  });
}

// 8. Event Listener Pengurutan Dropdown
function initSortListener() {
  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      currentSort = e.target.value;
      renderGallery(currentFilter);
    });
  }
}

// 9. Logika Modal Pratinjau Penuh Kartu
function initCardDetailModal() {
  const modal = document.getElementById('modalCardDetail');
  const btnClose = document.getElementById('btnCloseDetail');
  const modalBox = modal ? modal.querySelector('.modal-detail-card') : null;

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }

  if (modal) {
    modal.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }

  if (modalBox) {
    modalBox.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }
}

function openCardDetail(card) {
  const modal = document.getElementById('modalCardDetail');
  const modalBox = modal ? modal.querySelector('.modal-detail-card') : null;
  if (!modal || !modalBox) return;

  modalBox.className = `modal-card modal-detail-card rarity-${card.rarity}`;
  document.getElementById('detailRarity').innerText = card.rarity;
  document.getElementById('detailRarity').style.color = `var(--rarity-${card.rarity.toLowerCase()})`;
  document.getElementById('detailImg').src = card.url;
  document.getElementById('detailCharacter').innerText = card.character_name;
  document.getElementById('detailAnime').innerText = `Seri: ${card.anime_name}`;
  document.getElementById('detailArtist').innerText = card.artist_name;
  document.getElementById('detailDate').innerText = card.date;

  modal.style.display = 'flex';
}

// 10. Navigasi Bawah & Logout
function initTabs() {
  const navItems = document.querySelectorAll('.nav-item');
  const panes = document.querySelectorAll('.tab-pane');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.dataset.target;
      navItems.forEach(n => n.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      item.classList.add('active');
      const pane = document.getElementById(target);
      if (pane) pane.classList.add('active');

      if (target === 'tabGaleri') renderGallery(currentFilter);
    });
  });

  const btnBukaAkun = document.getElementById('btnBukaAkun');
  if (btnBukaAkun) {
    btnBukaAkun.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      const navAkun = document.querySelector('[data-target="tabAkun"]');
      if (navAkun) navAkun.classList.add('active');
      const tabAkun = document.getElementById('tabAkun');
      if (tabAkun) tabAkun.classList.add('active');
    });
  }

  document.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderGallery(btn.dataset.filter);
    });
  });

  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      localStorage.removeItem('gacha_user');
      currentUser = null;
      location.reload();
    });
  }
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerText = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

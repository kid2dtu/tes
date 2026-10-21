const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz3LraveIpKMeajlIpnf5KcG4vGffBtdkY9LtFucyhwbTUVEWPKWLW8vDlwdVbmJ0REMg/exec";

let currentUser = JSON.parse(localStorage.getItem('gacha_user') || 'null');
let deferredPrompt = null;
let isFlipping = false;
let lastKnownTickets = currentUser ? Number(currentUser.tickets || 0) : 0;
const syncChannel = new BroadcastChannel('gacha_sync');

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
});

// 1. Saluran Sinkronisasi Admin Realtime
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

  // Cek server otomatis tiap kali tab web dibuka kembali dari latar belakang
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
      if (!('Notification' in window)) return showToast('Browser tidak mendukung notifikasi');
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        showToast('Notifikasi tiket harian aktif! 🔔');
        fireTicketNotification('Notifikasi Aktif! 🔔', 'Kamu akan menerima pemberitahuan saat tiket gacha terisi ulang.');
      } else {
        showToast('Izin notifikasi ditolak.');
      }
    });
  }

  const btnReset = document.getElementById('btnResetManual');
  if (btnReset) {
    btnReset.addEventListener('click', async () => {
      if (!currentUser) return;
      btnReset.disabled = true;
      btnReset.innerText = 'Mereset...';

      try {
        const res = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify({
            action: 'reset_manual',
            username: currentUser.username,
            pin: currentUser.pin
          })
        });
        const result = await res.json();
        if (result.success) {
          currentUser.tickets = 10;
          localStorage.setItem('gacha_user', JSON.stringify(currentUser));
          renderUI();
          fireTicketNotification('Tiket Harian Siap! 🎟️', '10 Tiket kamu sudah berhasil di-reset manual!');
          showToast('Tiket berhasil direset jadi 10! 🔔');
        }
      } catch (e) {
        showToast('Gagal mereset tiket server.');
      } finally {
        btnReset.disabled = false;
        btnReset.innerText = 'Reset & Notif';
      }
    });
  }
}

function fireTicketNotification(title, body) {
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'NOTIF_RESET', title, body });
  } else if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body: body,
      icon: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png'
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

    // Deteksi pergantian hari jam 00:00 WIB
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
      // Jika tiket sebelumnya habis/kurang dan di server sudah jadi 10, bunyikan notifikasi!
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
  renderGallery('all');
}

// 6. Tarik Gacha
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

      const newCard = {
        url: item.url,
        artist_name: item.artist_name || 'Artis Komunitas',
        anime_name: item.anime_name || (rarity === 'SSR' ? 'Anime Special' : 'Original Character'),
        rarity: rarity,
        date: new Date().toLocaleDateString('id-ID')
      };

      cardFront.className = `card-face card-front rarity-${rarity}`;
      document.getElementById('kartuRarity').innerText = rarity;
      document.getElementById('kartuImg').src = newCard.url;
      document.getElementById('kartuAnime').innerText = newCard.anime_name;
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

// 7. Album Galeri
function renderGallery(filter = 'all') {
  const container = document.getElementById('gridGaleri');
  const emptyBox = document.getElementById('galeriKosong');
  if (!container || !emptyBox) return;

  container.innerHTML = '';
  const cards = (currentUser && currentUser.koleksi) ? currentUser.koleksi : [];
  const filtered = filter === 'all' ? cards : cards.filter(c => c.rarity === filter);

  if (filtered.length === 0) {
    emptyBox.style.display = 'block';
    return;
  }
  emptyBox.style.display = 'none';

  filtered.forEach(c => {
    const el = document.createElement('div');
    el.className = `mini-card rarity-${c.rarity}`;
    el.innerHTML = `
      <img src="${c.url}" loading="lazy">
      <div class="mini-card-info">
        <span class="m-rarity" style="color: var(--rarity-${c.rarity.toLowerCase()})">${c.rarity}</span>
        <h4>${c.anime_name}</h4>
      </div>
    `;
    container.appendChild(el);
  });
}

// 8. Navigasi Bawah & Logout
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

      if (target === 'tabGaleri') renderGallery('all');
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

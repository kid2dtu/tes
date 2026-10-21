const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz3LraveIpKMeajlIpnf5KcG4vGffBtdkY9LtFucyhwbTUVEWPKWLW8vDlwdVbmJ0REMg/exec";

let currentUser = JSON.parse(localStorage.getItem('gacha_user') || 'null');
let deferredPrompt = null;
let isFlipping = false;
let currentAdminPin = "";

window.addEventListener('DOMContentLoaded', () => {
  initPWA();
  initTabs();
  initCountdown();
  initAdmin();

  if (!currentUser) {
    document.getElementById('modalAuth').style.display = 'flex';
  } else {
    document.getElementById('modalAuth').style.display = 'none';
    syncUserData();
  }
});

// 1. Inisialisasi PWA & Notifikasi
function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('pwaInstallContainer').style.display = 'flex';
  });

  document.getElementById('btnInstallPwa').addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        document.getElementById('pwaInstallContainer').style.display = 'none';
      }
      deferredPrompt = null;
    } else {
      showToast('Buka menu Chrome (titik 3) -> pilih Tambahkan ke Layar Utama');
    }
  });

  document.getElementById('btnIzinNotif').addEventListener('click', async () => {
    if (!('Notification' in window)) return showToast('Browser tidak mendukung notifikasi');
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      showToast('Notifikasi tiket harian aktif! 🔔');
    } else {
      showToast('Izin notifikasi ditolak.');
    }
  });

  // Tombol Reset Manual Cepat + Pemicu Notifikasi Instan
  document.getElementById('btnResetManual').addEventListener('click', async () => {
    if (!currentUser) return;
    const btn = document.getElementById('btnResetManual');
    btn.disabled = true;
    btn.innerText = 'Mereset...';

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
        document.getElementById('txtTiket').innerText = 10;
        
        // Picu Notifikasi di HP / Layar
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'NOTIF_RESET' });
        } else if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Tiket Harian Siap! 🎟️', {
            body: '10 Tiket kamu sudah berhasil di-reset manual!',
            icon: 'https://nekos.best/logo.png'
          });
        }
        showToast('Tiket berhasil direset jadi 10! Notifikasi dikirim 🔔');
      }
    } catch (e) {
      showToast('Gagal mereset tiket server.');
    } finally {
      btn.disabled = false;
      btn.innerText = 'Reset & Notif';
    }
  });
}

// 2. Hitung Mundur Menuju Reset 00:00 WIB
function initCountdown() {
  function updateTimer() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const diff = tomorrow - now;
    if (diff <= 1000) {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'NOTIF_RESET' });
      }
      if (currentUser) syncUserData();
    }

    const jam = String(Math.floor((diff / (1000 * 60 * 60)) % 24)).padStart(2, '0');
    const mnt = String(Math.floor((diff / (1000 * 60)) % 60)).padStart(2, '0');
    const dtk = String(Math.floor((diff / 1000) % 60)).padStart(2, '0');
    document.getElementById('txtCountdown').innerText = `${jam}:${mnt}:${dtk}`;
  }
  updateTimer();
  setInterval(updateTimer, 1000);
}

// 3. Autentikasi Akun
document.getElementById('btnAuthSubmit').addEventListener('click', async () => {
  const username = document.getElementById('authUsername').value.trim().toLowerCase();
  const pin = document.getElementById('authPin').value.trim();
  const errBox = document.getElementById('authError');
  const btn = document.getElementById('btnAuthSubmit');

  if (!username || pin.length !== 4) {
    errBox.innerText = 'Username wajib diisi & PIN harus 4 digit angka!';
    return;
  }

  errBox.innerText = '';
  btn.disabled = true;
  btn.innerText = 'Memeriksa akun...';

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
    btn.disabled = false;
    btn.innerText = 'Masuk / Daftar';
  }
});

// Sinkronisasi Data dari Server
async function syncUserData() {
  renderUI();
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'login', username: currentUser.username, pin: currentUser.pin })
    });
    const result = await res.json();
    if (result.success) {
      currentUser.tickets = result.tickets;
      currentUser.koleksi = result.koleksi || [];
      localStorage.setItem('gacha_user', JSON.stringify(currentUser));
      renderUI();
    }
  } catch (e) {
    console.warn('Gagal sinkron:', e);
  }
}

function renderUI() {
  if (!currentUser) return;
  document.getElementById('headerUsername').innerText = `@${currentUser.username}`;
  document.getElementById('profileUsername').innerText = `@${currentUser.username}`;
  document.getElementById('txtTiket').innerText = currentUser.tickets;
  renderGallery('all');
}

// 4. Logika Gacha & Animasi Kartu
document.getElementById('btnTarikGacha').addEventListener('click', async () => {
  if (isFlipping) return;
  if (!currentUser || currentUser.tickets <= 0) {
    return showToast('Tiket harian habis! Balik lagi besok jam 00:00 WIB.');
  }

  const btn = document.getElementById('btnTarikGacha');
  const cardWrapper = document.getElementById('kartuWrapper');
  const cardFront = document.getElementById('kartuDepan');

  isFlipping = true;
  btn.disabled = true;

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
    currentUser.koleksi.unshift(newCard);
    localStorage.setItem('gacha_user', JSON.stringify(currentUser));
    document.getElementById('txtTiket').innerText = currentUser.tickets;

    document.getElementById('kartuImg').onload = () => {
      cardWrapper.classList.add('flipped');
      isFlipping = false;
      btn.disabled = false;
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
    btn.disabled = false;
  }
});

document.getElementById('kartuWrapper').addEventListener('click', () => {
  if (document.getElementById('kartuImg').src) {
    document.getElementById('kartuWrapper').classList.toggle('flipped');
  }
});

// 5. Galeri
function renderGallery(filter = 'all') {
  const container = document.getElementById('gridGaleri');
  const emptyBox = document.getElementById('galeriKosong');
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

// 6. Logika Panel Admin
function initAdmin() {
  document.getElementById('btnBukaAdmin').addEventListener('click', async () => {
    const pin = document.getElementById('inputAdminPin').value.trim();
    if (!pin) return showToast('Masukkan PIN Admin');

    currentAdminPin = pin;
    await loadAdminUsers();
  });

  document.getElementById('btnRefreshAdmin').addEventListener('click', loadAdminUsers);
}

async function loadAdminUsers() {
  const listContainer = document.getElementById('adminUserList');
  listContainer.innerHTML = '<p style="font-size:12px; color:#94a3b8;">Memuat user...</p>';

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'admin_get_users', adminPin: currentAdminPin })
    });
    const result = await res.json();

    if (!result.success) {
      showToast(result.message);
      return;
    }

    document.getElementById('adminLockedArea').style.display = 'none';
    document.getElementById('adminPanelArea').style.display = 'block';
    listContainer.innerHTML = '';

    result.users.forEach(u => {
      const row = document.createElement('div');
      row.className = 'admin-user-row';
      row.innerHTML = `
        <div>
          <strong>@${u.username}</strong> (PIN: ${u.pin})<br>
          <small style="color:#94a3b8;">Tiket: ${u.tickets} | Tgl: ${u.lastDate}</small>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn-sm" onclick="ubahTiketAdmin('${u.username}', 10)">+10</button>
          <button class="btn-sm" onclick="ubahTiketAdmin('${u.username}', 0)">0</button>
        </div>
      `;
      listContainer.appendChild(row);
    });
  } catch (e) {
    showToast('Gagal memuat data admin');
  }
}

window.ubahTiketAdmin = async function(targetUser, newTicket) {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'admin_set_ticket',
        adminPin: currentAdminPin,
        targetUser,
        newTicket
      })
    });
    const result = await res.json();
    showToast(result.message);
    if (result.success) {
      loadAdminUsers();
      if (currentUser && currentUser.username === targetUser) {
        currentUser.tickets = newTicket;
        localStorage.setItem('gacha_user', JSON.stringify(currentUser));
        renderUI();
      }
    }
  } catch (e) {
    showToast('Gagal mengubah tiket');
  }
};

// 7. Navigasi & Logout
function initTabs() {
  const navItems = document.querySelectorAll('.nav-item');
  const panes = document.querySelectorAll('.tab-pane');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.dataset.target;
      navItems.forEach(n => n.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      item.classList.add('active');
      document.getElementById(target).classList.add('active');

      if (target === 'tabGaleri') renderGallery('all');
    });
  });

  document.getElementById('btnBukaAkun').addEventListener('click', () => {
    navItems.forEach(n => n.classList.remove('active'));
    panes.forEach(p => p.classList.remove('active'));
    document.querySelector('[data-target="tabAkun"]').classList.add('active');
    document.getElementById('tabAkun').classList.add('active');
  });

  document.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderGallery(btn.dataset.filter);
    });
  });

  document.getElementById('btnLogout').addEventListener('click', () => {
    localStorage.removeItem('gacha_user');
    currentUser = null;
    location.reload();
  });
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.innerText = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

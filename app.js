const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz3LraveIpKMeajlIpnf5KcG4vGffBtdkY9LtFucyhwbTUVEWPKWLW8vDlwdVbmJ0REMg/exec";

// Sesi Pengguna
let currentUser = JSON.parse(localStorage.getItem('gacha_user') || 'null');
let deferredPrompt = null;
let isFlipping = false;

// 1. Inisialisasi Aplikasi & PWA
window.addEventListener('DOMContentLoaded', () => {
  initPWA();
  initTabs();
  initCountdown();

  if (!currentUser) {
    document.getElementById('modalAuth').style.display = 'flex';
  } else {
    document.getElementById('modalAuth').style.display = 'none';
    syncUserData();
  }
});

// 2. Service Worker & PWA Install Banner
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
    }
  });

  document.getElementById('btnIzinNotif').addEventListener('click', async () => {
    if (!('Notification' in window)) return showToast('Browser tidak mendukung notifikasi');
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      showToast('Notifikasi reset jam 00:00 WIB aktif! 🔔');
    } else {
      showToast('Izin notifikasi ditolak.');
    }
  });
}

// 3. Hitung Mundur Menuju Reset 00:00 WIB
function initCountdown() {
  function updateTimer() {
    const now = new Date();
    // Hitung waktu tengah malam berikutnya (Asia/Jakarta)
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const diff = tomorrow - now;
    if (diff <= 1000) {
      // Pemicu tepat jam 00:00 WIB
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

// 4. Autentikasi Username + PIN
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

// Sinkronisasi data akun terbaru dari server
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
    console.warn('Menggunakan cache lokal:', e);
  }
}

function renderUI() {
  if (!currentUser) return;
  document.getElementById('headerUsername').innerText = `@${currentUser.username}`;
  document.getElementById('profileUsername').innerText = `@${currentUser.username}`;
  document.getElementById('txtTiket').innerText = currentUser.tickets;
  renderGallery('all');
}

// 5. Logika Gacha & Nekos.best API
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

  // Tutup kembali kartu jika sedang terbuka
  cardWrapper.classList.remove('flipped');
  await new Promise(r => setTimeout(r, 350));

  showToast('Memanggil kartu anime...');

  // Tentukan Kelangkaan: R 70%, SR 25%, SSR 5%
  const roll = Math.random() * 100;
  let rarity = 'R';
  let endpoint = 'neko';

  if (roll <= 5) {
    rarity = 'SSR';
    endpoint = 'smug'; // Format GIF animasi dari Nekos.best
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

    // Render data ke kartu depan
    cardFront.className = `card-face card-front rarity-${rarity}`;
    document.getElementById('kartuRarity').innerText = rarity;
    document.getElementById('kartuImg').src = newCard.url;
    document.getElementById('kartuAnime').innerText = newCard.anime_name;
    document.getElementById('kartuArtist').innerText = `Artis: ${newCard.artist_name}`;

    // Kurangi tiket lokal instan
    currentUser.tickets = Math.max(0, currentUser.tickets - 1);
    currentUser.koleksi.unshift(newCard);
    localStorage.setItem('gacha_user', JSON.stringify(currentUser));
    document.getElementById('txtTiket').innerText = currentUser.tickets;

    // Tunggu gambar siap lalu putar kartu
    document.getElementById('kartuImg').onload = () => {
      cardWrapper.classList.add('flipped');
      isFlipping = false;
      btn.disabled = false;
    };

    // Sinkronisasi database di latar belakang
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
    showToast('Koneksi ke Nekos.best lambat. Coba tekan lagi.');
    isFlipping = false;
    btn.disabled = false;
  }
});

// Flip kartu jika diklik manual
document.getElementById('kartuWrapper').addEventListener('click', () => {
  if (document.getElementById('kartuImg').src) {
    document.getElementById('kartuWrapper').classList.toggle('flipped');
  }
});

// 6. Galeri Kartu
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

// 7. Navigasi Bawah (SPA Switcher)
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

  // Filter chips galeri
  document.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderGallery(btn.dataset.filter);
    });
  });

  // Logout
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

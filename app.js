const API_URL = "https://script.google.com/macros/s/AKfycbz3LraveIpKMeajlIpnf5KcG4vGffBtdkY9LtFucyhwbTUVEWPKWLW8vDlwdVbmJ0REMg/exec";

let currentUser = null;
let cardPool = [];
let userInventory = [];

// Registrasi Service Worker & Notifikasi
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(console.error);
}

document.getElementById('btnEnableNotif').addEventListener('click', async () => {
  if (!('Notification' in window)) {
    alert('Browser tidak mendukung web push notification.');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    navigator.serviceWorker.ready.then((reg) => {
      reg.showNotification('AnimeGacha Aktif!', {
        body: 'Notifikasi reset tiket jam 00:00 WIB berhasil dinyalakan.',
        icon: '/icon.png',
        badge: '/icon.png'
      });
    });
    alert('Notifikasi berhasil diaktifkan!');
  }
});

// Helper Fetch GAS
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

window.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupFilters();

  try {
    const poolRes = await fetch(`${API_URL}?action=get_pool`);
    const poolJson = await poolRes.json();
    if (poolJson.status === 'success') {
      cardPool = poolJson.cards;
    }
  } catch (e) {
    console.error("Gagal load kartu:", e);
  }

  const savedUser = localStorage.getItem('gacha_user');
  const savedPin = localStorage.getItem('gacha_pin');

  if (savedUser && savedPin) {
    loginUser(savedUser, savedPin);
  } else {
    document.getElementById('authModal').classList.remove('hidden');
  }
});

// Autentikasi Pemain
document.getElementById('btnLogin').addEventListener('click', async () => {
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
    applyUserData(res.user, res.inventory);
    document.getElementById('authModal').classList.add('hidden');
    errBox.textContent = '';
  } else {
    errBox.textContent = res.message;
  }
});

async function loginUser(username, pin) {
  const res = await callAPI({ action: 'login', username, pin });
  if (res.status === 'success') {
    applyUserData(res.user, res.inventory);
    document.getElementById('authModal').classList.add('hidden');
  } else {
    localStorage.clear();
    document.getElementById('authModal').classList.remove('hidden');
  }
}

function applyUserData(user, inventory) {
  currentUser = user;
  userInventory = inventory || [];
  
  document.getElementById('navUsername').textContent = user.username;
  document.getElementById('profileUsername').textContent = user.username;
  document.getElementById('ticketCount').textContent = user.tickets;
  document.getElementById('shardCount').textContent = user.shards;
  document.getElementById('pityText').textContent = `${user.pity_count} / 30`;
  document.getElementById('pityFill').style.width = `${(user.pity_count / 30) * 100}%`;

  updateStats();
  renderAlbum('ALL');
}

// Tarik Gacha
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
    applyUserData(currentUser, userInventory);

    if (res.is_duplicate) {
      setTimeout(() => alert('Kartu kembar! Kamu dapat +1 Star Shard ⭐'), 900);
    }
  } else {
    alert(res.message);
  }
});

gachaCard.addEventListener('click', () => {
  gachaCard.classList.toggle('flipped');
});

// Tukar Star Shards
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

// Album Koleksi
function renderAlbum(filterRarity) {
  const grid = document.getElementById('albumGrid');
  grid.innerHTML = '';

  const ownedCardIds = [...new Set(userInventory.map(i => i.card_id))];
  let filteredCards = cardPool.filter(c => ownedCardIds.includes(c.id));

  if (filterRarity !== 'ALL') {
    filteredCards = filteredCards.filter(c => c.rarity === filterRarity);
  }

  document.getElementById('albumTotalCount').textContent = ownedCardIds.length;
  document.getElementById('emptyAlbumMsg').classList.toggle('hidden', filteredCards.length > 0);

  filteredCards.forEach(card => {
    const item = document.createElement('div');
    item.className = 'album-card-item';
    item.innerHTML = `
      <div class="rarity-badge ${card.rarity}">${card.rarity}</div>
      <img src="${card.image_url}" loading="lazy" alt="${card.name}">
    `;
    item.addEventListener('click', () => openCardDetail(card));
    grid.appendChild(item);
  });
}

function openCardDetail(card) {
  document.getElementById('modalRarityBadge').textContent = card.rarity;
  document.getElementById('modalRarityBadge').className = `rarity-badge ${card.rarity}`;
  document.getElementById('modalCardImg').src = card.image_url;
  document.getElementById('modalCardName').textContent = card.name;
  document.getElementById('modalCardAnime').textContent = card.anime;
  document.getElementById('modalCardArtist').textContent = `Artist: ${card.artist || '-'}`;
  document.getElementById('cardModal').classList.remove('hidden');
}

document.getElementById('btnCloseModal').addEventListener('click', () => {
  document.getElementById('cardModal').classList.add('hidden');
});

// Statistik Profil
function updateStats() {
  const total = currentUser.total_pulls || 0;
  const ownedIds = [...new Set(userInventory.map(i => i.card_id))];
  let countSSR = 0;
  let countSR = 0;

  userInventory.forEach(inv => {
    const card = cardPool.find(c => c.id === inv.card_id);
    if (card) {
      if (card.rarity === 'SSR') countSSR++;
      if (card.rarity === 'SR') countSR++;
    }
  });

  document.getElementById('statTotalPulls').textContent = total;
  document.getElementById('statUniqueCards').textContent = ownedIds.length;
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

function setupFilters() {
  const filterBtns = document.querySelectorAll('.btn-filter');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAlbum(btn.dataset.filter);
    });
  });
}

document.getElementById('btnLogout').addEventListener('click', () => {
  localStorage.clear();
  location.reload();
});

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz3LraveIpKMeajlIpnf5KcG4vGffBtdkY9LtFucyhwbTUVEWPKWLW8vDlwdVbmJ0REMg/exec";

let currentUser = JSON.parse(localStorage.getItem('gacha_user') || 'null');
let seenCards = new Set(JSON.parse(localStorage.getItem('gacha_seen_cards') || '[]'));
let activeModalCard = null;
let isFlipping = false;
let currentFilter = 'all';
let currentSort = 'date';
let currentSearch = '';
let lastKnownTickets = currentUser ? Number(currentUser.tickets || 0) : 0;
const syncChannel = new BroadcastChannel('gacha_sync');

if (currentUser) {
  if (currentUser.pity === undefined) currentUser.pity = 0;
  if (currentUser.shards === undefined) currentUser.shards = 0;
}

// 1. Audio Synthesizer
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playSFX(type) {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    if (type === 'click') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.05);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    } else if (type === 'flip') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.2);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === 'ssr') {
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);
        gain.gain.setValueAtTime(0.3, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.08 + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.4);
      });
    }
  } catch (e) {}
}

// 2. Partikel SSR
function triggerSSRConfetti() {
  const canvas = document.getElementById('fxCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const particles = [];
  const colors = ['#ec4899', '#8b5cf6', '#38bdf8', '#fbbf24', '#ffffff'];

  for (let i = 0; i < 70; i++) {
    particles.push({
      x: canvas.width / 2,
      y: canvas.height * 0.45,
      r: Math.random() * 5 + 3,
      dx: (Math.random() - 0.5) * 12,
      dy: (Math.random() - 0.7) * 14,
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: 1,
      decay: Math.random() * 0.015 + 0.01
    });
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let active = false;
    particles.forEach(p => {
      if (p.alpha > 0) {
        active = true;
        p.x += p.dx;
        p.y += p.dy;
        p.dy += 0.35;
        p.alpha -= p.decay;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });
    if (active) requestAnimationFrame(render);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  render();
}

// 3. Jikan Engine & Fallback Pool
const FALLBACK_POOL = [
  { character_name: 'Lelouch Lamperouge', anime_name: 'Code Geass', rarity: 'SSR', artist_name: 'Sunrise', url: 'https://cdn.myanimelist.net/images/characters/8/406163.jpg' },
  { character_name: 'Levi Ackerman', anime_name: 'Attack on Titan', rarity: 'SSR', artist_name: 'WIT Studio', url: 'https://cdn.myanimelist.net/images/characters/2/241417.jpg' },
  { character_name: 'Rem', anime_name: 'Re:Zero', rarity: 'SSR', artist_name: 'White Fox', url: 'https://cdn.myanimelist.net/images/characters/11/309442.jpg' },
  { character_name: 'Megumin', anime_name: 'KonoSuba', rarity: 'SR', artist_name: 'Studio Deen', url: 'https://cdn.myanimelist.net/images/characters/10/304381.jpg' },
  { character_name: 'Kurisu Makise', anime_name: 'Steins;Gate', rarity: 'SR', artist_name: 'White Fox', url: 'https://cdn.myanimelist.net/images/characters/9/131317.jpg' },
  { character_name: 'Anya Forger', anime_name: 'Spy × Family', rarity: 'R', artist_name: 'CloverWorks', url: 'https://cdn.myanimelist.net/images/characters/11/473809.jpg' },
  { character_name: 'Chika Fujiwara', anime_name: 'Kaguya-sama', rarity: 'R', artist_name: 'A-1 Pictures', url: 'https://cdn.myanimelist.net/images/characters/16/377317.jpg' },
  { character_name: 'Asuna Yuuki', anime_name: 'Sword Art Online', rarity: 'R', artist_name: 'A-1 Pictures', url: 'https://cdn.myanimelist.net/images/characters/15/264079.jpg' },
  { character_name: 'Fern', anime_name: 'Sousou no Frieren', rarity: 'R', artist_name: 'Madhouse', url: 'https://cdn.myanimelist.net/images/characters/13/524854.jpg' }
];

async function fetchJikanPage(pageNumber) {
  const cacheKey = `jikan_page_${pageNumber}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }
  try {
    const res = await fetch(`https://api.jikan.moe/v4/top/characters?page=${pageNumber}`);
    if (!res.ok) throw new Error();
    const json = await res.json();
    if (json.data && Array.isArray(json.data) && json.data.length > 0) {
      localStorage.setItem(cacheKey, JSON.stringify(json.data));
      return json.data;
    }
  } catch (err) {}
  return null;
}

async function rollJikanCard(targetRarity) {
  let pages = targetRarity === 'SSR' ? [1] : (targetRarity === 'SR' ? [2, 3, 4] : [5, 6, 7, 8, 9, 10]);
  const page = pages[Math.floor(Math.random() * pages.length)];
  const pageData = await fetchJikanPage(page);

  if (pageData && pageData.length > 0) {
    const raw = pageData[Math.floor(Math.random() * pageData.length)];
    const imgUrl = raw.images?.jpg?.large_image_url || raw.images?.jpg?.image_url;
    return {
      character_name: raw.name || 'Karakter Anime',
      anime_name: raw.name_kanji ? `${raw.name_kanji} (Top #${raw.mal_id})` : 'Top MyAnimeList',
      rarity: targetRarity,
      artist_name: raw.favorites ? `${Number(raw.favorites).toLocaleString('id-ID')} Favorit` : 'Official MAL',
      url: imgUrl
    };
  }

  const list = FALLBACK_POOL.filter(c => c.rarity === targetRarity);
  return list[Math.floor(Math.random() * list.length)] || FALLBACK_POOL[0];
}

// 4. Inisialisasi
window.addEventListener('DOMContentLoaded', () => {
  const modalAuth = document.getElementById('modalAuth');
  if (!currentUser) {
    if (modalAuth) modalAuth.style.display = 'flex';
  } else {
    if (modalAuth) modalAuth.style.display = 'none';
    renderUI();
    syncUserData();
  }

  fetchJikanPage(1);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  initTabs();
  initCountdown();
  initSyncListener();
  initCardDetailModal();
  initGalleryControls();
  initShardExchange();
  initGachaInfoModal();
});

// 5. Realtime Sync & Countdown
function initSyncListener() {
  syncChannel.onmessage = (event) => {
    if (event.data?.type === 'TICKET_UPDATED' && currentUser?.username === event.data.targetUser) {
      currentUser.tickets = event.data.newTicket;
      localStorage.setItem('gacha_user', JSON.stringify(currentUser));
      renderUI();
    }
  };
  setInterval(() => {
    if (document.visibilityState === 'visible' && currentUser && !isFlipping) syncUserData();
  }, 6000);
}

function initCountdown() {
  function updateTimer() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const diff = tomorrow - now;
    const jam = String(Math.floor((diff / (1000 * 60 * 60)) % 24)).padStart(2, '0');
    const mnt = String(Math.floor((diff / (1000 * 60)) % 60)).padStart(2, '0');
    const dtk = String(Math.floor((diff / 1000) % 60)).padStart(2, '0');
    const el = document.getElementById('txtCountdown');
    if (el) el.innerText = `${jam}:${mnt}:${dtk}`;
  }
  updateTimer();
  setInterval(updateTimer, 1000);
}

// 6. Login & Sync Server
const btnAuth = document.getElementById('btnAuthSubmit');
if (btnAuth) {
  btnAuth.addEventListener('click', async () => {
    playSFX('click');
    const username = document.getElementById('authUsername').value.trim().toLowerCase();
    const pin = document.getElementById('authPin').value.trim();
    const errBox = document.getElementById('authError');

    if (!username || pin.length !== 4) {
      errBox.innerText = 'Username wajib diisi & PIN harus 4 digit angka!';
      return;
    }

    errBox.innerText = '';
    btnAuth.disabled = true;
    btnAuth.innerText = 'Memeriksa...';

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
          pity: 0,
          shards: 0,
          koleksi: result.koleksi || []
        };
        localStorage.setItem('gacha_user', JSON.stringify(currentUser));
        document.getElementById('modalAuth').style.display = 'none';
        renderUI();
        showToast('Berhasil masuk! 🎟️');
      } else {
        errBox.innerText = result.message || 'Login gagal';
      }
    } catch (err) {
      errBox.innerText = 'Koneksi database gagal. Coba lagi.';
    } finally {
      btnAuth.disabled = false;
      btnAuth.innerText = 'Masuk / Daftar';
    }
  });
}

async function syncUserData() {
  if (!currentUser) return;
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
  } catch (e) {}
}

function renderUI() {
  if (!currentUser) return;
  const headerUser = document.getElementById('headerUsername');
  const profileUser = document.getElementById('profileUsername');
  const txtTiket = document.getElementById('txtTiket');
  const txtPity = document.getElementById('txtPityCount');
  const barFill = document.getElementById('pityBarFill');

  if (headerUser) headerUser.innerText = `@${currentUser.username}`;
  if (profileUser) profileUser.innerText = `@${currentUser.username}`;
  if (txtTiket) txtTiket.innerText = currentUser.tickets;

  const currentPity = currentUser.pity || 0;
  if (txtPity) txtPity.innerText = `${currentPity} / 30`;
  if (barFill) barFill.style.width = `${Math.min(100, (currentPity / 30) * 100)}%`;

  renderStats();
  renderGallery();
}

function renderStats() {
  if (!currentUser) return;
  const cards = currentUser.koleksi || [];
  const total = cards.length;
  const ssr = cards.filter(c => c.rarity === 'SSR').length;
  const sr = cards.filter(c => c.rarity === 'SR').length;

  document.getElementById('statTotalTarik').innerText = total;
  document.getElementById('statKarakterUnik').innerText = new Set(cards.map(c => c.character_name)).size;
  document.getElementById('statSSRRate').innerText = total > 0 ? `${((ssr / total) * 100).toFixed(1)}%` : '0%';
  document.getElementById('statSRRate').innerText = total > 0 ? `${((sr / total) * 100).toFixed(1)}%` : '0%';
  document.getElementById('txtShardCount').innerText = currentUser.shards || 0;
}

// 7. Tarik Gacha
const btnGacha = document.getElementById('btnTarikGacha');
if (btnGacha) {
  btnGacha.addEventListener('click', async () => {
    if (isFlipping) return;
    if (!currentUser || currentUser.tickets <= 0) {
      return showToast('Tiket habis! Reset jam 00:00 WIB.');
    }

    playSFX('click');
    const cardWrapper = document.getElementById('kartuWrapper');
    const cardFront = document.getElementById('kartuDepan');
    const cardImg = document.getElementById('kartuImg');

    isFlipping = true;
    btnGacha.disabled = true;
    cardWrapper.classList.remove('flipped');
    await new Promise(r => setTimeout(r, 350));

    showToast('Menghubungkan ke MyAnimeList...');

    let targetRarity = 'R';
    if ((currentUser.pity || 0) >= 29) {
      targetRarity = 'SSR';
      showToast('🌟 JAMINAN SSR TERCAPAI! 🌟');
    } else {
      const roll = Math.random() * 100;
      if (roll <= 5) targetRarity = 'SSR';
      else if (roll <= 30) targetRarity = 'SR';
    }

    const chosen = await rollJikanCard(targetRarity);
    const now = new Date();
    const jam = String(now.getHours()).padStart(2, '0');
    const mnt = String(now.getMinutes()).padStart(2, '0');

    const newCard = {
      url: chosen.url,
      artist_name: chosen.artist_name,
      character_name: chosen.character_name,
      anime_name: chosen.anime_name,
      rarity: chosen.rarity,
      date: `${now.toLocaleDateString('id-ID')} ${jam}:${mnt} WIB`,
      timestamp: now.getTime()
    };

    cardFront.className = `card-face card-front rarity-${newCard.rarity}`;
    document.getElementById('kartuRarity').innerText = newCard.rarity;
    document.getElementById('kartuAnime').innerText = newCard.character_name;
    document.getElementById('kartuArtist').innerText = newCard.artist_name;

    const isDup = currentUser.koleksi.some(c => c.character_name.toLowerCase() === newCard.character_name.toLowerCase());
    if (isDup) {
      currentUser.shards = (currentUser.shards || 0) + 1;
      setTimeout(() => showToast(`Kartu kembar! +1 Star Shard ⭐`), 1200);
    }

    currentUser.tickets = Math.max(0, currentUser.tickets - 1);
    if (newCard.rarity === 'SSR') currentUser.pity = 0;
    else currentUser.pity = (currentUser.pity || 0) + 1;

    currentUser.koleksi.push(newCard);
    localStorage.setItem('gacha_user', JSON.stringify(currentUser));
    renderUI();

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cardWrapper.classList.add('flipped');
      playSFX('flip');
      isFlipping = false;
      btnGacha.disabled = false;
      if (newCard.rarity === 'SSR') {
        setTimeout(() => { playSFX('ssr'); triggerSSRConfetti(); }, 300);
      }
    };

    cardImg.onload = finish;
    cardImg.onerror = finish;
    setTimeout(() => { if (isFlipping) finish(); }, 2500);
    cardImg.src = newCard.url;

    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'gacha', username: currentUser.username, pin: currentUser.pin, kartu: newCard })
    }).catch(() => {});
  });
}

const cardWrapper = document.getElementById('kartuWrapper');
if (cardWrapper) {
  cardWrapper.addEventListener('click', () => {
    if (document.getElementById('kartuImg')?.src) {
      playSFX('flip');
      cardWrapper.classList.toggle('flipped');
    }
  });
}

// 8. Galeri Koleksi
function renderGallery() {
  const container = document.getElementById('gridGaleri');
  const emptyBox = document.getElementById('galeriKosong');
  if (!container || !emptyBox) return;

  container.innerHTML = '';
  const cards = (currentUser?.koleksi || []).map((c, idx) => ({ ...c, _idx: idx }));

  let filtered = cards.filter(c => {
    const matchRarity = currentFilter === 'all' || c.rarity === currentFilter;
    const target = `${c.character_name} ${c.anime_name}`.toLowerCase();
    return matchRarity && (!currentSearch || target.includes(currentSearch));
  });

  document.getElementById('txtKoleksiCount').innerText = `${filtered.length} Kartu`;
  if (filtered.length === 0) {
    emptyBox.style.display = 'block';
    return;
  }
  emptyBox.style.display = 'none';

  const rank = { SSR: 3, SR: 2, R: 1 };
  filtered.sort((a, b) => {
    if (currentSort === 'name') return (a.character_name || '').localeCompare(b.character_name || '');
    if (currentSort === 'rarity') return (rank[b.rarity] || 0) - (rank[a.rarity] || 0);
    return (b.timestamp || b._idx) - (a.timestamp || a._idx);
  });

  filtered.forEach(c => {
    const key = `${c.url}_${c._idx}`;
    const isNew = !seenCards.has(key);
    const el = document.createElement('div');
    el.className = `mini-card rarity-${c.rarity}`;
    el.innerHTML = `
      ${isNew ? '<span class="badge-new">NEW</span>' : ''}
      <img src="${c.url}" loading="lazy" referrerpolicy="no-referrer" alt="${c.character_name}">
      <div class="mini-card-info">
        <span class="m-rarity" style="color: var(--rarity-${c.rarity.toLowerCase()})">${c.rarity}</span>
        <h4>${c.character_name}</h4>
      </div>
    `;
    el.addEventListener('click', () => {
      playSFX('click');
      if (isNew) {
        seenCards.add(key);
        localStorage.setItem('gacha_seen_cards', JSON.stringify(Array.from(seenCards)));
        el.querySelector('.badge-new')?.remove();
      }
      openCardDetail(c);
    });
    container.appendChild(el);
  });
}

function initGalleryControls() {
  document.getElementById('inputSearchGaleri')?.addEventListener('input', (e) => {
    currentSearch = e.target.value.trim().toLowerCase();
    renderGallery();
  });
  document.getElementById('sortSelect')?.addEventListener('change', (e) => {
    playSFX('click');
    currentSort = e.target.value;
    renderGallery();
  });
  document.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      playSFX('click');
      document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderGallery();
    });
  });
}

// 9. Detail Modal & Download
function initCardDetailModal() {
  const modal = document.getElementById('modalCardDetail');
  document.getElementById('btnCloseDetail')?.addEventListener('click', () => {
    playSFX('click');
    modal.style.display = 'none';
  });
  document.getElementById('btnDownloadCard')?.addEventListener('click', () => {
    if (!activeModalCard) return;
    playSFX('click');
    const a = document.createElement('a');
    a.href = activeModalCard.url;
    a.download = `${activeModalCard.character_name}_mal.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Download gambar dimulai! 💾');
  });
}

function openCardDetail(card) {
  activeModalCard = card;
  const modal = document.getElementById('modalCardDetail');
  const box = modal?.querySelector('.modal-detail-card');
  if (!modal || !box) return;

  box.className = `modal-card modal-detail-card rarity-${card.rarity}`;
  document.getElementById('detailRarity').innerText = card.rarity;
  document.getElementById('detailRarity').style.color = `var(--rarity-${card.rarity.toLowerCase()})`;
  document.getElementById('detailImg').src = card.url;
  document.getElementById('detailCharacter').innerText = card.character_name;
  document.getElementById('detailAnime').innerText = card.anime_name;
  document.getElementById('detailArtist').innerText = card.artist_name;
  document.getElementById('detailDate').innerText = card.date;
  modal.style.display = 'flex';
}

// 10. Shards & Info Rate
function initShardExchange() {
  document.getElementById('btnTukarShard')?.addEventListener('click', async () => {
    if (!currentUser) return;
    if ((currentUser.shards || 0) < 5) {
      playSFX('click');
      return showToast('Butuh minimal 5 Star Shards ⭐');
    }
    playSFX('ssr');
    currentUser.shards -= 5;
    currentUser.tickets += 1;
    localStorage.setItem('gacha_user', JSON.stringify(currentUser));
    renderUI();
    showToast('Sukses tukar 5 Shard ➔ +1 Tiket Gacha! 🎟️');

    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'admin_set_ticket', adminPin: '9999', targetUser: currentUser.username, newTicket: currentUser.tickets })
    }).catch(() => {});
  });
}

function initGachaInfoModal() {
  const modal = document.getElementById('modalGachaInfo');
  document.getElementById('btnBukaInfoGacha')?.addEventListener('click', () => {
    playSFX('click');
    modal.style.display = 'flex';
    renderDropList();
  });
  document.getElementById('btnCloseInfo')?.addEventListener('click', () => {
    playSFX('click');
    modal.style.display = 'none';
  });
  document.getElementById('btnSubRate')?.addEventListener('click', () => {
    playSFX('click');
    document.getElementById('btnSubRate').classList.add('active');
    document.getElementById('btnSubDrop').classList.remove('active');
    document.getElementById('infoContentRate').classList.add('active');
    document.getElementById('infoContentDrop').classList.remove('active');
  });
  document.getElementById('btnSubDrop')?.addEventListener('click', () => {
    playSFX('click');
    document.getElementById('btnSubDrop').classList.add('active');
    document.getElementById('btnSubRate').classList.remove('active');
    document.getElementById('infoContentDrop').classList.add('active');
    document.getElementById('infoContentRate').classList.remove('active');
    renderDropList();
  });
  document.getElementById('inputSearchDrop')?.addEventListener('input', (e) => {
    renderDropList(e.target.value);
  });
}

function renderDropList(filterText = '') {
  const container = document.getElementById('dropListContainer');
  if (!container) return;
  container.innerHTML = '';
  const search = filterText.trim().toLowerCase();

  let pooled = [];
  for (let p = 1; p <= 10; p++) {
    const raw = localStorage.getItem(`jikan_page_${p}`);
    if (raw) {
      try {
        JSON.parse(raw).forEach(c => {
          pooled.push({
            name: c.name,
            anime: c.name_kanji || 'MyAnimeList',
            rarity: p === 1 ? 'SSR' : (p <= 4 ? 'SR' : 'R')
          });
        });
      } catch (e) {}
    }
  }

  if (pooled.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--text-muted); font-size: 11px;">Kolam Jikan sedang disinkronkan... Coba tarik gacha sekali!</div>`;
    return;
  }

  pooled.filter(i => !search || i.name.toLowerCase().includes(search)).forEach(item => {
    const el = document.createElement('div');
    el.className = 'drop-item';
    el.innerHTML = `
      <div>
        <div class="drop-item-char">${item.name}</div>
        <div class="drop-item-anime">${item.anime}</div>
      </div>
      <span class="rate-badge" style="color: var(--rarity-${item.rarity.toLowerCase()})">${item.rarity}</span>
    `;
    container.appendChild(el);
  });
}

// 11. Navigasi Bawah & Logout
function initTabs() {
  const navItems = document.querySelectorAll('.nav-item');
  const panes = document.querySelectorAll('.tab-pane');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      playSFX('click');
      const target = item.dataset.target;
      navItems.forEach(n => n.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      item.classList.add('active');
      document.getElementById(target)?.classList.add('active');
      if (target === 'tabGaleri') renderGallery();
      if (target === 'tabAkun') renderStats();
    });
  });

  document.getElementById('btnBukaAkun')?.addEventListener('click', () => {
    playSFX('click');
    navItems.forEach(n => n.classList.remove('active'));
    panes.forEach(p => p.classList.remove('active'));
    document.querySelector('[data-target="tabAkun"]')?.classList.add('active');
    document.getElementById('tabAkun')?.classList.add('active');
    renderStats();
  });

  document.getElementById('btnLogout')?.addEventListener('click', () => {
    playSFX('click');
    localStorage.removeItem('gacha_user');
    currentUser = null;
    location.reload();
  });

  document.getElementById('btnIzinNotif')?.addEventListener('click', async () => {
    playSFX('click');
    if ('Notification' in window) {
      const p = await Notification.requestPermission();
      if (p === 'granted') showToast('Notifikasi harian aktif! 🔔');
    }
  });
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerText = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

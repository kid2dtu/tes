const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz3LraveIpKMeajlIpnf5KcG4vGffBtdkY9LtFucyhwbTUVEWPKWLW8vDlwdVbmJ0REMg/exec";

let currentUser = JSON.parse(localStorage.getItem('gacha_user') || 'null');
let seenCards = new Set(JSON.parse(localStorage.getItem('gacha_seen_cards') || '[]'));
let activeModalCard = null;
let isFlipping = false;
let currentFilter = 'all';
let currentSort = 'date';
let currentSearch = '';
let livePool = [];
const syncChannel = new BroadcastChannel('gacha_sync');

if (currentUser) {
  if (currentUser.pity === undefined) currentUser.pity = 0;
  if (currentUser.shards === undefined) currentUser.shards = 0;
}

// 1. Audio SFX
let audioCtx = null;
function playSFX(type) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    if (type === 'click') {
      osc.frequency.setValueAtTime(600, now);
      gain.gain.setValueAtTime(0.15, now);
      osc.start(now); osc.stop(now + 0.05);
    } else if (type === 'flip') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.exponentialRampToValueAtTime(700, now + 0.15);
      gain.gain.setValueAtTime(0.2, now);
      osc.start(now); osc.stop(now + 0.15);
    } else if (type === 'ssr') {
      [523, 659, 783, 1046].forEach((f, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(f, now + i * 0.08);
        g.gain.setValueAtTime(0.25, now + i * 0.08);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(now + i * 0.08); o.stop(now + i * 0.08 + 0.35);
      });
      return;
    }
    osc.connect(gain); gain.connect(audioCtx.destination);
  } catch (e) {}
}

// 2. Partikel Confetti SSR
function triggerSSRConfetti() {
  const canvas = document.getElementById('fxCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const particles = Array.from({ length: 65 }, () => ({
    x: canvas.width / 2, y: canvas.height * 0.45,
    r: Math.random() * 5 + 3,
    dx: (Math.random() - 0.5) * 12, dy: (Math.random() - 0.7) * 14,
    color: ['#ec4899', '#8b5cf6', '#38bdf8', '#fbbf24', '#fff'][Math.floor(Math.random() * 5)],
    alpha: 1
  }));
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let active = false;
    particles.forEach(p => {
      if (p.alpha > 0) {
        active = true; p.x += p.dx; p.y += p.dy; p.dy += 0.35; p.alpha -= 0.015;
        ctx.globalAlpha = Math.max(0, p.alpha); ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
    });
    if (active) requestAnimationFrame(render);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  render();
}

// 3. Engine Pencarian & Auto-Repair Gambar AniList
async function fetchRealImageByName(charName) {
  const cacheKey = `real_img_${charName.toLowerCase().replace(/\s+/g, '_')}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        query: `query ($search: String) {
          Character(search: $search) {
            image { large }
          }
        }`,
        variables: { search: charName }
      })
    });
    const json = await res.json();
    const url = json?.data?.Character?.image?.large;
    if (url) {
      localStorage.setItem(cacheKey, url);
      return url;
    }
  } catch (err) {}
  return null;
}

async function autoRepairCollection() {
  if (!currentUser || !Array.isArray(currentUser.koleksi)) return;
  let updated = false;

  for (let card of currentUser.koleksi) {
    if (!card.url || card.url.includes('b129760-') || card.url.includes('myanimelist.net') || card.url.includes('weserv.nl') || card.url.includes('b149409-') || card.url.includes('b133887-') || card.url.includes('b36828-') || card.url.includes('b204647-') || card.url.includes('b204648-') || card.url.includes('b34470-')) {
      const realUrl = await fetchRealImageByName(card.character_name);
      if (realUrl) {
        card.url = realUrl;
        updated = true;
      }
    }
  }

  if (updated) {
    localStorage.setItem('gacha_user', JSON.stringify(currentUser));
    renderGallery();
  }
}

window.handleImageError = async function(imgElement, charName, cardIdx) {
  imgElement.onerror = null;
  const realUrl = await fetchRealImageByName(charName);
  if (realUrl) {
    imgElement.src = realUrl;
    if (currentUser?.koleksi?.[cardIdx]) {
      currentUser.koleksi[cardIdx].url = realUrl;
      localStorage.setItem('gacha_user', JSON.stringify(currentUser));
    }
  }
};

// 4. Engine Pool AniList Live
async function loadLivePool() {
  const cached = localStorage.getItem('anilist_live_pool_v1');
  if (cached) {
    try {
      livePool = JSON.parse(cached);
      return;
    } catch (e) {}
  }

  const query = `query {
    Page(page: 1, perPage: 50) {
      characters(sort: FAVOURITES_DESC) {
        name { full }
        image { large }
        media(sort: FAVOURITES_DESC, perPage: 1) {
          nodes { title { userPreferred } }
        }
      }
    }
  }`;

  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query })
    });
    const json = await res.json();
    const list = json?.data?.Page?.characters || [];
    livePool = list.map(c => ({
      character_name: c.name.full,
      anime_name: c.media?.nodes?.[0]?.title?.userPreferred || 'Anime Series',
      url: c.image.large
    }));
    if (livePool.length > 0) {
      localStorage.setItem('anilist_live_pool_v1', JSON.stringify(livePool));
    }
  } catch (err) {}
}

async function rollCard(targetRarity) {
  if (!livePool || livePool.length === 0) {
    await loadLivePool();
  }

  let candidates = livePool;
  if (livePool.length >= 30) {
    if (targetRarity === 'SSR') candidates = livePool.slice(0, 10);
    else if (targetRarity === 'SR') candidates = livePool.slice(10, 25);
    else candidates = livePool.slice(25);
  }

  const chosen = candidates[Math.floor(Math.random() * candidates.length)] || {
    character_name: 'Rem',
    anime_name: 'Re:Zero',
    url: 'https://s4.anilist.co/file/anilistcdn/character/large/b88572-10kF6A00F70p.png'
  };

  return { ...chosen, rarity: targetRarity, artist_name: 'Official Anime Art' };
}

// 5. Inisialisasi
window.addEventListener('DOMContentLoaded', async () => {
  const modalAuth = document.getElementById('modalAuth');
  if (!currentUser) {
    if (modalAuth) modalAuth.style.display = 'flex';
  } else {
    if (modalAuth) modalAuth.style.display = 'none';
    renderUI();
    autoRepairCollection();
    syncUserData();
  }

  loadLivePool();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  initTabs();
  initCountdown();
  initSyncListener();
  initCardDetailModal();
  initGalleryControls();
  initShardExchange();
  initGachaInfoModal();
});

// 6. Hitung Mundur & Realtime Sync
function initCountdown() {
  setInterval(() => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const diff = tomorrow - now;
    const j = String(Math.floor((diff / 3600000) % 24)).padStart(2, '0');
    const m = String(Math.floor((diff / 60000) % 60)).padStart(2, '0');
    const s = String(Math.floor((diff / 1000) % 60)).padStart(2, '0');
    const el = document.getElementById('txtCountdown');
    if (el) el.innerText = `${j}:${m}:${s}`;
  }, 1000);
}

function initSyncListener() {
  syncChannel.onmessage = (e) => {
    if (e.data?.type === 'TICKET_UPDATED' && currentUser?.username === e.data.targetUser) {
      currentUser.tickets = e.data.newTicket;
      localStorage.setItem('gacha_user', JSON.stringify(currentUser));
      renderUI();
    }
  };
  setInterval(() => {
    if (document.visibilityState === 'visible' && currentUser && !isFlipping) syncUserData();
  }, 6000);
}

// 7. Login & Sinkron Server
document.getElementById('btnAuthSubmit')?.addEventListener('click', async () => {
  playSFX('click');
  const username = document.getElementById('authUsername').value.trim().toLowerCase();
  const pin = document.getElementById('authPin').value.trim();
  const errBox = document.getElementById('authError');

  if (!username || pin.length !== 4) return errBox.innerText = 'Username wajib diisi & PIN 4 angka!';
  errBox.innerText = '';

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'login', username, pin })
    });
    const result = await res.json();
    if (result.success) {
      currentUser = { username: result.username, pin, tickets: result.tickets, pity: 0, shards: 0, koleksi: result.koleksi || [] };
      localStorage.setItem('gacha_user', JSON.stringify(currentUser));
      document.getElementById('modalAuth').style.display = 'none';
      renderUI();
      autoRepairCollection();
      showToast('Berhasil masuk! 🎟️');
    } else {
      errBox.innerText = result.message || 'Login gagal';
    }
  } catch (err) {
    errBox.innerText = 'Gagal terhubung database.';
  }
});

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
      if (result.koleksi && result.koleksi.length > (currentUser.koleksi?.length || 0)) {
        currentUser.koleksi = result.koleksi;
      }
      localStorage.setItem('gacha_user', JSON.stringify(currentUser));
      renderUI();
      autoRepairCollection();
    }
  } catch (e) {}
}

function renderUI() {
  if (!currentUser) return;
  document.getElementById('headerUsername').innerText = `@${currentUser.username}`;
  document.getElementById('profileUsername').innerText = `@${currentUser.username}`;
  document.getElementById('txtTiket').innerText = currentUser.tickets;
  const pity = currentUser.pity || 0;
  document.getElementById('txtPityCount').innerText = `${pity} / 30`;
  document.getElementById('pityBarFill').style.width = `${Math.min(100, (pity / 30) * 100)}%`;

  const cards = currentUser.koleksi || [];
  const total = cards.length;
  document.getElementById('statTotalTarik').innerText = total;
  document.getElementById('statKarakterUnik').innerText = new Set(cards.map(c => c.character_name)).size;
  document.getElementById('statSSRRate').innerText = total > 0 ? `${((cards.filter(c=>c.rarity==='SSR').length / total) * 100).toFixed(1)}%` : '0%';
  document.getElementById('statSRRate').innerText = total > 0 ? `${((cards.filter(c=>c.rarity==='SR').length / total) * 100).toFixed(1)}%` : '0%';
  document.getElementById('txtShardCount').innerText = currentUser.shards || 0;
  renderGallery();
}

// 8. Tarik Gacha
document.getElementById('btnTarikGacha')?.addEventListener('click', async () => {
  if (isFlipping) return;
  if (!currentUser || currentUser.tickets <= 0) return showToast('Tiket habis! Reset jam 00:00 WIB.');

  playSFX('click');
  const cardWrapper = document.getElementById('kartuWrapper');
  const cardFront = document.getElementById('kartuDepan');
  const cardImg = document.getElementById('kartuImg');

  isFlipping = true;
  document.getElementById('btnTarikGacha').disabled = true;
  cardWrapper.classList.remove('flipped');
  await new Promise(r => setTimeout(r, 350));

  let targetRarity = 'R';
  if ((currentUser.pity || 0) >= 29) {
    targetRarity = 'SSR';
    showToast('🌟 JAMINAN SSR TERCAPAI! 🌟');
  } else {
    const roll = Math.random() * 100;
    if (roll <= 5) targetRarity = 'SSR';
    else if (roll <= 30) targetRarity = 'SR';
  }

  const chosen = await rollCard(targetRarity);
  const now = new Date();
  const jam = String(now.getHours()).padStart(2, '0');
  const mnt = String(now.getMinutes()).padStart(2, '0');

  const newCard = {
    ...chosen,
    date: `${now.toLocaleDateString('id-ID')} ${jam}:${mnt} WIB`,
    timestamp: now.getTime()
  };

  cardFront.className = `card-face card-front rarity-${newCard.rarity}`;
  document.getElementById('kartuRarity').innerText = newCard.rarity;
  document.getElementById('kartuAnime').innerText = newCard.character_name;
  document.getElementById('kartuArtist').innerText = newCard.anime_name;

  if (currentUser.koleksi.some(c => c.character_name.toLowerCase() === newCard.character_name.toLowerCase())) {
    currentUser.shards = (currentUser.shards || 0) + 1;
    setTimeout(() => showToast(`Kartu kembar! +1 Star Shard ⭐`), 1200);
  }

  currentUser.tickets = Math.max(0, currentUser.tickets - 1);
  currentUser.pity = newCard.rarity === 'SSR' ? 0 : (currentUser.pity || 0) + 1;
  currentUser.koleksi.push(newCard);
  localStorage.setItem('gacha_user', JSON.stringify(currentUser));
  renderUI();

  let finishDone = false;
  const finish = () => {
    if (finishDone) return;
    finishDone = true;
    cardWrapper.classList.add('flipped');
    playSFX('flip');
    isFlipping = false;
    document.getElementById('btnTarikGacha').disabled = false;
    if (newCard.rarity === 'SSR') {
      setTimeout(() => { playSFX('ssr'); triggerSSRConfetti(); }, 300);
    }
  };

  cardImg.onload = finish;
  cardImg.onerror = finish;
  setTimeout(() => { if (isFlipping) finish(); }, 2000);
  cardImg.src = newCard.url;

  fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify({ action: 'gacha', username: currentUser.username, pin: currentUser.pin, kartu: newCard })
  }).catch(() => {});
});

document.getElementById('kartuWrapper')?.addEventListener('click', () => {
  if (document.getElementById('kartuImg')?.src) {
    playSFX('flip');
    document.getElementById('kartuWrapper').classList.toggle('flipped');
  }
});

// 9. Galeri Koleksi
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
  emptyBox.style.display = filtered.length === 0 ? 'block' : 'none';

  const rank = { SSR: 3, SR: 2, R: 1 };
  filtered.sort((a, b) => {
    if (currentSort === 'name') return (a.character_name || '').localeCompare(b.character_name || '');
    if (currentSort === 'rarity') return (rank[b.rarity] || 0) - (rank[a.rarity] || 0);
    return (b.timestamp || b._idx) - (a.timestamp || a._idx);
  });

  filtered.forEach(c => {
    const key = `${c.url}_${c._idx}`;
    const isNew = !seenCards.has(key);
    const safeName = (c.character_name || '').replace(/'/g, "\\'");
    const el = document.createElement('div');
    el.className = `mini-card rarity-${c.rarity}`;
    el.innerHTML = `
      ${isNew ? '<span class="badge-new">NEW</span>' : ''}
      <img src="${c.url}" loading="lazy" referrerpolicy="no-referrer" alt="${c.character_name}" onerror="window.handleImageError(this, '${safeName}', ${c._idx})">
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

// 10. Detail Modal & Shards
function initCardDetailModal() {
  const modal = document.getElementById('modalCardDetail');
  document.getElementById('btnCloseDetail')?.addEventListener('click', () => {
    playSFX('click'); modal.style.display = 'none';
  });
  document.getElementById('btnDownloadCard')?.addEventListener('click', () => {
    if (!activeModalCard) return;
    playSFX('click');
    const a = document.createElement('a');
    a.href = activeModalCard.url;
    a.download = `${activeModalCard.character_name}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    showToast('Download dimulai! 💾');
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
  document.getElementById('detailArtist').innerText = card.artist_name || 'Official Art';
  document.getElementById('detailDate').innerText = card.date;
  modal.style.display = 'flex';
}

function initShardExchange() {
  document.getElementById('btnTukarShard')?.addEventListener('click', async () => {
    if (!currentUser) return;
    if ((currentUser.shards || 0) < 5) return showToast('Butuh minimal 5 Star Shards ⭐');
    playSFX('ssr');
    currentUser.shards -= 5;
    currentUser.tickets += 1;
    localStorage.setItem('gacha_user', JSON.stringify(currentUser));
    renderUI();
    showToast('Sukses tukar 5 Shard ➔ +1 Tiket! 🎟️');

    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'admin_set_ticket', adminPin: '9999', targetUser: currentUser.username, newTicket: currentUser.tickets })
    }).catch(() => {});
  });
}

function initGachaInfoModal() {
  const modal = document.getElementById('modalGachaInfo');
  document.getElementById('btnBukaInfoGacha')?.addEventListener('click', () => {
    playSFX('click'); modal.style.display = 'flex';
  });
  document.getElementById('btnCloseInfo')?.addEventListener('click', () => {
    playSFX('click'); modal.style.display = 'none';
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
  });
}

// 11. Navigasi & Utility
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
    });
  });

  document.getElementById('btnBukaAkun')?.addEventListener('click', () => {
    playSFX('click');
    navItems.forEach(n => n.classList.remove('active'));
    panes.forEach(p => p.classList.remove('active'));
    document.querySelector('[data-target="tabAkun"]')?.classList.add('active');
    document.getElementById('tabAkun')?.classList.add('active');
  });

  document.getElementById('btnLogout')?.addEventListener('click', () => {
    playSFX('click');
    localStorage.removeItem('gacha_user');
    currentUser = null;
    location.reload();
  });
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerText = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

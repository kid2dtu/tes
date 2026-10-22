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

// Fungsi Auto-Repair seluruh koleksi yang rusak di database
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

// Penyelamat jika kartu individual gagal load (langsung sembuh seketika)
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
    if (
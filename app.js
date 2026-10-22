const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz3LraveIpKMeajlIpnf5KcG4vGffBtdkY9LtFucyhwbTUVEWPKWLW8vDlwdVbmJ0REMg/exec";

let currentUser = JSON.parse(localStorage.getItem('gacha_user') || 'null');
let seenCards = new Set(JSON.parse(localStorage.getItem('gacha_seen_cards') || '[]'));
let activeModalCard = null;
let isFlipping = false;
let currentFilter = 'all';
let currentSort = 'date';
let currentSearch = '';
const syncChannel = new BroadcastChannel('gacha_sync');

if (currentUser) {
  if (currentUser.pity === undefined) currentUser.pity = 0;
  if (currentUser.shards === undefined) currentUser.shards = 0;
}

// 1. Audio Synthesizer
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

// 3. Database Roster Karakter & Tag Safebooru
const GACHA_ROSTER = [
  // --- SSR (5%) ---
  { character_name: 'Hu Tao', anime_name: 'Genshin Impact', rarity: 'SSR', tag: 'hu_tao_(genshin_impact)' },
  { character_name: 'Raiden Shogun', anime_name: 'Genshin Impact', rarity: 'SSR', tag: 'raiden_shogun_(genshin_impact)' },
  { character_name: 'Furina', anime_name: 'Genshin Impact', rarity: 'SSR', tag: 'furina_(genshin_impact)' },
  { character_name: 'Frieren', anime_name: 'Sousou no Frieren', rarity: 'SSR', tag: 'frieren' },
  { character_name: 'Rem', anime_name: 'Re:Zero', rarity: 'SSR', tag: 'rem_(re:zero)' },
  { character_name: 'Megumin', anime_name: 'KonoSuba', rarity: 'SSR', tag: 'megumin' },
  { character_name: 'Hitori Gotoh', anime_name: 'Bocchi the Rock!', rarity: 'SSR', tag: 'gotou_hitori' },
  { character_name: 'Saber', anime_name: 'Fate/stay night', rarity: 'SSR', tag: 'saber_(fate)' },
  { character_name: 'Makima', anime_name: 'Chainsaw Man', rarity: 'SSR', tag: 'makima_(chainsaw_man)' },
  { character_name: 'Ai Hoshino', anime_name: 'Oshi no Ko', rarity: 'SSR', tag: 'hoshino_ai_(oshi_no_ko)' },
  { character_name: 'Gojo Satoru', anime_name: 'Jujutsu Kaisen', rarity: 'SSR', tag: 'gojou_satoru' },
  { character_name: 'Levi Ackerman', anime_name: 'Attack on Titan', rarity: 'SSR', tag: 'levi_(shingeki_no_kyojin)' },

  // --- SR (25%) ---
  { character_name: 'Marin Kitagawa', anime_name: 'My Dress-Up Darling', rarity: 'SR', tag: 'kitagawa_marin' },
  { character_name: 'Emilia', anime_name: 'Re:Zero', rarity: 'SR', tag: 'emilia_(re:zero)' },
  { character_name: 'Aqua', anime_name: 'KonoSuba', rarity: 'SR', tag: 'aqua_(konosuba)' },
  { character_name: 'Fern', anime_name: 'Sousou no Frieren', rarity: 'SR', tag: 'fern_(sousou_no_frieren)' },
  { character_name: 'Chisato Nishikigi', anime_name: 'Lycoris Recoil', rarity: 'SR', tag: 'nishikigi_chisato' },
  { character_name: 'Takina Inoue', anime_name: 'Lycoris Recoil', rarity: 'SR', tag: 'inoue_takina' },
  { character_name: 'Kita Ikuyo', anime_name: 'Bocchi the Rock!', rarity: 'SR', tag: 'kita_ikuyo' },
  { character_name: 'Yor Forger', anime_name: 'Spy × Family', rarity: 'SR', tag: 'yor_forger' },
  { character_name: 'Power', anime_name: 'Chainsaw Man', rarity: 'SR', tag: 'power_(chainsaw_man)' },
  { character_name: 'Kurumi Tokisaki', anime_name: 'Date A Live', rarity: 'SR', tag: 'tokisaki_kurumi' },
  { character_name: 'Kaguya Shinomiya', anime_name: 'Kaguya-sama: Love is War', rarity: 'SR', tag: 'shinomiya_kaguya' },
  { character_name: 'Zero Two', anime_name: 'Darling in the FranXX', rarity: 'SR', tag: 'zero_two_(darling_in_the_franxx)' },
  { character_name: 'Kurisu Makise', anime_name: 'Steins;Gate', rarity: 'SR', tag: 'makise_kurisu' },
  { character_name: 'Killua Zoldyck', anime_name: 'Hunter × Hunter', rarity: 'SR', tag: 'killua_zoldyck' },

  // --- R (70%) ---
  { character_name: 'Anya Forger', anime_name: 'Spy × Family', rarity: 'R', tag: 'anya_forger' },
  { character_name: 'Chika Fujiwara', anime_name: 'Kaguya-sama: Love is War', rarity: 'R', tag: 'fujiwara_chika' },
  { character_name: 'Darkness', anime_name: 'KonoSuba', rarity: 'R', tag: 'darkness_(konosuba)' },
  { character_name: 'Ram', anime_name: 'Re:Zero', rarity: 'R', tag: 'ram_(re:zero)' },
  { character_name: 'Nezuko Kamado', anime_name: 'Demon Slayer', rarity: 'R', tag: 'kamado_nezuko' },
  { character_name: 'Shinobu Kocho', anime_name: 'Demon Slayer', rarity: 'R', tag: 'kochou_shinobu' },
  { character_name: 'Mitsuri Kanroji', anime_name: 'Demon Slayer', rarity: 'R', tag: 'kanroji_mitsuri' },
  { character_name: 'Asuna Yuuki', anime_name: 'Sword Art Online', rarity: 'R', tag: 'yuuki_asuna' },
  { character_name: 'Nijika Ijichi', anime_name: 'Bocchi the Rock!', rarity: 'R', tag: 'ijichi_nijika' },
  { character_name: 'Ryo Yamada', anime_name: 'Bocchi the Rock!', rarity: 'R', tag: 'yamada_ryou_(bocchi_the_rock!)' },
  { character_name: 'Ruby Hoshino', anime_name: 'Oshi no Ko', rarity: 'R', tag: 'hoshino_ruby' },
  { character_name: 'Kana Arima', anime_name: 'Oshi no Ko', rarity: 'R', tag: 'arima_kana' },
  { character_name: 'Mai Sakurajima', anime_name: 'Bunny Girl Senpai', rarity: 'R', tag: 'sakurajima_mai' },
  { character_name: 'Miku Nakano', anime_name: 'The Quintessential Quintuplets', rarity: 'R', tag: 'nakano_miku' },
  { character_name: 'Nino Nakano', anime_name: 'The Quintessential Quintuplets', rarity: 'R', tag: 'nakano_nino' },
  { character_name: 'Violet Evergarden', anime_name: 'Violet Evergarden', rarity: 'R', tag: 'violet_evergarden' },
  { character_name: 'Rebecca', anime_name: 'Cyberpunk: Edgerunners', rarity: 'R', tag: 'rebecca_(cyberpunk)' },
  { character_name: 'Lucy', anime_name: 'Cyberpunk: Edgerunners', rarity: 'R', tag: 'lucy_(cyberpunk)' },
  { character_name: 'Stark', anime_name: 'Sousou no Frieren', rarity: 'R', tag: 'stark_(sousou_no_frieren)' },
  { character_name: 'Himmel', anime_name: 'Sousou no Frieren', rarity: 'R', tag: 'himmel_(sousou_no_frieren)' },
  { character_name: 'Loid Forger', anime_name: 'Spy × Family', rarity: 'R', tag: 'loid_forger' },
  { character_name: 'Tanjiro Kamado', anime_name: 'Demon Slayer', rarity: 'R', tag: 'kamado_tanjirou' },
  { character_name: 'Megumi Fushiguro', anime_name: 'Jujutsu Kaisen', rarity: 'R', tag: 'fushiguro_megumi' },
  { character_name: 'Edward Elric', anime_name: 'Fullmetal Alchemist', rarity: 'R', tag: 'edward_elric' },
  { character_name: 'Katsuki Bakugou', anime_name: 'My Hero Academia', rarity: 'R', tag: 'bakugou_katsuki' },
  { character_name: 'Shouto Todoroki', anime_name: 'My Hero Academia', rarity: 'R', tag: 'todoroki_shouto' },
  { character_name: 'Naruto Uzumaki', anime_name: 'Naruto', rarity: 'R', tag: 'uzumaki_naruto' },
  { character_name: 'Subaru Natsuki', anime_name: 'Re:Zero', rarity: 'R', tag: 'natsuki_subaru' }
];

// 4. Engine Fetch Gambar Safebooru HD
async function fetchSafebooruIllustration(tag) {
  const cacheKey = `sb_img_v1_${tag}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed[Math.floor(Math.random() * parsed.length)];
      }
    } catch (e) {}
  }

  try {
    const url = `https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=25&tags=${encodeURIComponent(tag + ' solo rating:safe')}`;
    const res = await fetch(url);
    const posts = await res.json();
    const valid = (posts || []).filter(p => p.image && !p.image.endsWith('.mp4') && !p.image.endsWith('.webm'));

    if (valid.length > 0) {
      const urls = valid.map(p => `https://safebooru.org/images/${p.directory}/${p.image}`);
      localStorage.setItem(cacheKey, JSON.stringify(urls));
      return urls[Math.floor(Math.random() * urls.length)];
    }
  } catch (err) {}

  return 'https://s4.anilist.co/file/anilistcdn/character/large/b88572-10kF6A00F70p.png';
}

async function rollCard(targetRarity) {
  const candidates = GACHA_ROSTER.filter(c => c.rarity === targetRarity);
  const chosen = candidates[Math.floor(Math.random() * candidates.length)] || GACHA_ROSTER[0];
  const imageUrl = await fetchSafebooruIllustration(chosen.tag);

  return {
    character_name: chosen.character_name,
    anime_name: chosen.anime_name,
    rarity: chosen.rarity,
    artist_name: 'Safebooru Fanart HD',
    url: imageUrl
  };
}

// 5. Inisialisasi
window.addEventListener('DOMContentLoaded', () => {
  const modalAuth = document.getElementById('modalAuth');
  if (!currentUser) {
    if (modalAuth) modalAuth.style.display = 'flex';
  } else {
    if (modalAuth) modalAuth.style.display = 'none';
    renderUI();
    syncUserData();
  }

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

  showToast('Memanggil ilustrasi Safebooru...');

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
  setTimeout(() => { if (isFlipping) finish(); }, 2500);
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

// 9. Galeri Koleksi (Deduplikasi Katalog Unik + Badge xCount)
function renderGallery() {
  const container = document.getElementById('gridGaleri');
  const emptyBox = document.getElementById('galeriKosong');
  if (!container || !emptyBox) return;

  container.innerHTML = '';

  const uniqueMap = new Map();
  (currentUser?.koleksi || []).forEach((c, idx) => {
    const key = (c.character_name || '').toLowerCase();
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, { ...c, _origIdx: idx, count: 1 });
    } else {
      uniqueMap.get(key).count += 1;
    }
  });

  const cards = Array.from(uniqueMap.values());

  let filtered = cards.filter(c => {
    const matchRarity = currentFilter === 'all' || c.rarity === currentFilter;
    const target = `${c.character_name} ${c.anime_name}`.toLowerCase();
    return matchRarity && (!currentSearch || target.includes(currentSearch));
  });

  document.getElementById('txtKoleksiCount').innerText = `${filtered.length} Karakter Unik`;
  emptyBox.style.display = filtered.length === 0 ? 'block' : 'none';

  const rank = { SSR: 3, SR: 2, R: 1 };
  filtered.sort((a, b) => {
    if (currentSort === 'name') return (a.character_name || '').localeCompare(b.character_name || '');
    if (currentSort === 'rarity') return (rank[b.rarity] || 0) - (rank[a.rarity] || 0);
    return (b.timestamp || b._origIdx) - (a.timestamp || a._origIdx);
  });

  filtered.forEach(c => {
    const key = `${c.url}_${c._origIdx}`;
    const isNew = !seenCards.has(key);
    const el = document.createElement('div');
    el.className = `mini-card rarity-${c.rarity}`;
    el.innerHTML = `
      ${isNew ? '<span class="badge-new">NEW</span>' : ''}
      ${c.count > 1 ? `<span style="position:absolute; top:8px; right:8px; background:rgba(0,0,0,0.75); color:#fbbf24; font-size:10px; font-weight:800; padding:2px 7px; border-radius:6px; border:1px solid rgba(251,191,36,0.4); z-index:5;">x${c.count}</span>` : ''}
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

// 10. Detail Modal & Download Langsung ke Disk (Anti-Tab Baru)
function initCardDetailModal() {
  const modal = document.getElementById('modalCardDetail');
  document.getElementById('btnCloseDetail')?.addEventListener('click', () => {
    playSFX('click'); modal.style.display = 'none';
  });
  document.getElementById('btnDownloadCard')?.addEventListener('click', () => {
    if (!activeModalCard) return;
    playSFX('click');
    downloadDirectToDisk(activeModalCard.url, activeModalCard.character_name);
  });
}

async function downloadDirectToDisk(url, name) {
  showToast('Mengunduh gambar ke penyimpanan... 💾');
  const filename = `${name.replace(/\s+/g, '_')}_safebooru.jpg`;

  try {
    let res;
    try {
      res = await fetch(url);
      if (!res.ok) throw new Error();
    } catch (e) {
      const cleanUrl = url.replace(/^https?:\/\//i, '');
      res = await fetch(`https://images.weserv.nl/?url=${encodeURIComponent(cleanUrl)}`);
    }

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    }, 2000);
    showToast('Gambar berhasil disimpan ke disk! 💾');
  } catch (err) {
    showToast('Gagal mengunduh gambar.');
  }
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
  document.getElementById('detailCharacter').innerText = `${card.character_name} ${card.count > 1 ? `(x${card.count})` : ''}`;
  document.getElementById('detailAnime').innerText = card.anime_name;
  document.getElementById('detailArtist').innerText = card.artist_name || 'Safebooru Fanart HD';
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

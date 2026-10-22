const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz3LraveIpKMeajlIpnf5KcG4vGffBtdkY9LtFucyhwbTUVEWPKWLW8vDlwdVbmJ0REMg/exec";

let currentUser = JSON.parse(localStorage.getItem('gacha_user') || 'null');
let seenCards = new Set(JSON.parse(localStorage.getItem('gacha_seen_cards') || '[]'));
let activeModalCard = null;
let deferredPrompt = null;
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

// 1. Audio Synthesizer (SFX Bawaan Browser)
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
    } else if (type === 'sr') {
      [659.25, 783.99, 987.77, 1318.51].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);
        gain.gain.setValueAtTime(0.25, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.08 + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.3);
      });
    } else if (type === 'ssr') {
      [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.07);
        gain.gain.setValueAtTime(0.3, now + idx * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.07 + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.07);
        osc.stop(now + idx * 0.07 + 0.5);
      });
    }
  } catch (e) {
    console.warn('Audio belum aktif:', e);
  }
}

// 2. Partikel Confetti SSR Canvas
function triggerSSRConfetti() {
  const canvas = document.getElementById('fxCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const particles = [];
  const colors = ['#ec4899', '#8b5cf6', '#38bdf8', '#fbbf24', '#ffffff', '#f43f5e'];

  for (let i = 0; i < 90; i++) {
    particles.push({
      x: canvas.width / 2,
      y: canvas.height * 0.45,
      r: Math.random() * 6 + 3,
      dx: (Math.random() - 0.5) * 14,
      dy: (Math.random() - 0.7) * 16,
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

// 3. Database Karakter Pool (Pencarian Berdasarkan Nama di AniList)
const GACHA_CARD_POOL = [
  // --- SSR (5%) ---
  { character_name: 'Hu Tao', anime_name: 'Genshin Impact', rarity: 'SSR', artist_name: 'HoYoverse' },
  { character_name: 'Rem', anime_name: 'Re:Zero kara Hajimeru Isekai Seikatsu', rarity: 'SSR', artist_name: 'Shinichirou Otsuka' },
  { character_name: 'Megumin', anime_name: 'KonoSuba', rarity: 'SSR', artist_name: 'Kurone Mishima' },
  { character_name: 'Frieren', anime_name: 'Sousou no Frieren', rarity: 'SSR', artist_name: 'Tsukasa Abe' },
  { character_name: 'Chisato Nishikigi', anime_name: 'Lycoris Recoil', rarity: 'SSR', artist_name: 'Imigimuru' },
  { character_name: 'Hitori Gotoh', anime_name: 'Bocchi the Rock!', rarity: 'SSR', artist_name: 'Aki Hamaji' },
  { character_name: 'Ai Hoshino', anime_name: 'Oshi no Ko', rarity: 'SSR', artist_name: 'Mengo Yokoyari' },
  { character_name: 'Saber', anime_name: 'Fate/stay night', rarity: 'SSR', artist_name: 'Takashi Takeuchi' },
  { character_name: 'Makima', anime_name: 'Chainsaw Man', rarity: 'SSR', artist_name: 'Tatsuki Fujimoto' },
  { character_name: 'Raiden Shogun', anime_name: 'Genshin Impact', rarity: 'SSR', artist_name: 'HoYoverse' },

  // --- SR (25%) ---
  { character_name: 'Marin Kitagawa', anime_name: 'My Dress-Up Darling', rarity: 'SR', artist_name: 'Shinichi Fukuda' },
  { character_name: 'Emilia', anime_name: 'Re:Zero kara Hajimeru Isekai Seikatsu', rarity: 'SR', artist_name: 'Shinichirou Otsuka' },
  { character_name: 'Aqua', anime_name: 'KonoSuba', rarity: 'SR', artist_name: 'Kurone Mishima' },
  { character_name: 'Fern', anime_name: 'Sousou no Frieren', rarity: 'SR', artist_name: 'Tsukasa Abe' },
  { character_name: 'Takina Inoue', anime_name: 'Lycoris Recoil', rarity: 'SR', artist_name: 'Imigimuru' },
  { character_name: 'Kita Ikuyo', anime_name: 'Bocchi the Rock!', rarity: 'SR', artist_name: 'Aki Hamaji' },
  { character_name: 'Yor Forger', anime_name: 'Spy × Family', rarity: 'SR', artist_name: 'Tatsuya Endou' },
  { character_name: 'Power', anime_name: 'Chainsaw Man', rarity: 'SR', artist_name: 'Tatsuki Fujimoto' },
  { character_name: 'Kurumi Tokisaki', anime_name: 'Date A Live', rarity: 'SR', artist_name: 'Tsunako' },
  { character_name: 'Rin Tohsaka', anime_name: 'Fate/stay night', rarity: 'SR', artist_name: 'Takashi Takeuchi' },
  { character_name: 'Kaguya Shinomiya', anime_name: 'Kaguya-sama: Love is War', rarity: 'SR', artist_name: 'Aka Akasaka' },
  { character_name: 'Zero Two', anime_name: 'Darling in the FranXX', rarity: 'SR', artist_name: 'Masayoshi Tanaka' },

  // --- R (70%) ---
  { character_name: 'Anya Forger', anime_name: 'Spy × Family', rarity: 'R', artist_name: 'Tatsuya Endou' },
  { character_name: 'Darkness', anime_name: 'KonoSuba', rarity: 'R', artist_name: 'Kurone Mishima' },
  { character_name: 'Ram', anime_name: 'Re:Zero kara Hajimeru Isekai Seikatsu', rarity: 'R', artist_name: 'Shinichirou Otsuka' },
  { character_name: 'Nezuko Kamado', anime_name: 'Demon Slayer', rarity: 'R', artist_name: 'Koyoharu Gotouge' },
  { character_name: 'Shinobu Kocho', anime_name: 'Demon Slayer', rarity: 'R', artist_name: 'Koyoharu Gotouge' },
  { character_name: 'Chika Fujiwara', anime_name: 'Kaguya-sama: Love is War', rarity: 'R', artist_name: 'Aka Akasaka' },
  { character_name: 'Komi Shouko', anime_name: "Komi Can't Communicate", rarity: 'R', artist_name: 'Tomohito Oda' },
  { character_name: 'Asuna Yuuki', anime_name: 'Sword Art Online', rarity: 'R', artist_name: 'abec' },
  { character_name: 'Yukino Yukinoshita', anime_name: 'Oregairu', rarity: 'R', artist_name: 'Ponkan⑧' },
  { character_name: 'Nijika Ijichi', anime_name: 'Bocchi the Rock!', rarity: 'R', artist_name: 'Aki Hamaji' },
  { character_name: 'Ryo Yamada', anime_name: 'Bocchi the Rock!', rarity: 'R', artist_name: 'Aki Hamaji' },
  { character_name: 'Ruby Hoshino', anime_name: 'Oshi no Ko', rarity: 'R', artist_name: 'Mengo Yokoyari' },
  { character_name: 'Kana Arima', anime_name: 'Oshi no Ko', rarity: 'R', artist_name: 'Mengo Yokoyari' },
  { character_name: 'Roxy Migurdia', anime_name: 'Mushoku Tensei', rarity: 'R', artist_name: 'Shirotaka' },
  { character_name: 'Sylphiette', anime_name: 'Mushoku Tensei', rarity: 'R', artist_name: 'Shirotaka' },
  { character_name: 'Hatsune Miku', anime_name: 'Vocaloid', rarity: 'R', artist_name: 'KEI' },
  { character_name: 'Mitsuri Kanroji', anime_name: 'Demon Slayer', rarity: 'R', artist_name: 'Koyoharu Gotouge' },
  { character_name: 'Kanao Tsuyuri', anime_name: 'Demon Slayer', rarity: 'R', artist_name: 'Koyoharu Gotouge' },
  { character_name: 'Mai Sakurajima', anime_name: 'Bunny Girl Senpai', rarity: 'R', artist_name: 'Keeji Mizoguchi' },
  { character_name: 'Taiga Aisaka', anime_name: 'Toradora!', rarity: 'R', artist_name: 'Yasu' },
  { character_name: 'Yui Yuigahama', anime_name: 'Oregairu', rarity: 'R', artist_name: 'Ponkan⑧' },
  { character_name: 'Iroha Isshiki', anime_name: 'Oregairu', rarity: 'R', artist_name: 'Ponkan⑧' },
  { character_name: 'Miku Nakano', anime_name: 'The Quintessential Quintuplets', rarity: 'R', artist_name: 'Negi Haruba' },
  { character_name: 'Nino Nakano', anime_name: 'The Quintessential Quintuplets', rarity: 'R', artist_name: 'Negi Haruba' },
  { character_name: 'Itsuki Nakano', anime_name: 'The Quintessential Quintuplets', rarity: 'R', artist_name: 'Negi Haruba' },
  { character_name: 'Yotsuba Nakano', anime_name: 'The Quintessential Quintuplets', rarity: 'R', artist_name: 'Negi Haruba' },
  { character_name: 'Ichika Nakano', anime_name: 'The Quintessential Quintuplets', rarity: 'R', artist_name: 'Negi Haruba' },
  { character_name: 'Megumi Kato', anime_name: 'Saekano', rarity: 'R', artist_name: 'Kurehito Misaki' },
  { character_name: 'Violet Evergarden', anime_name: 'Violet Evergarden', rarity: 'R', artist_name: 'Akiko Takase' },
  { character_name: 'Mikasa Ackerman', anime_name: 'Attack on Titan', rarity: 'R', artist_name: 'Hajime Isayama' },
  { character_name: 'Sasha Braus', anime_name: 'Attack on Titan', rarity: 'R', artist_name: 'Hajime Isayama' },
  { character_name: 'Rebecca', anime_name: 'Cyberpunk: Edgerunners', rarity: 'R', artist_name: 'Studio Trigger' },
  { character_name: 'Lucy', anime_name: 'Cyberpunk: Edgerunners', rarity: 'R', artist_name: 'Studio Trigger' },
  { character_name: 'Eris Boreas Greyrat', anime_name: 'Mushoku Tensei', rarity: 'R', artist_name: 'Shirotaka' },
  { character_name: 'Mem-Cho', anime_name: 'Oshi no Ko', rarity: 'R', artist_name: 'Mengo Yokoyari' },
  { character_name: 'Akane Kurokawa', anime_name: 'Oshi no Ko', rarity: 'R', artist_name: 'Mengo Yokoyari' },
  { character_name: 'Miko Iino', anime_name: 'Kaguya-sama: Love is War', rarity: 'R', artist_name: 'Aka Akasaka' },
  { character_name: 'Ai Hayasaka', anime_name: 'Kaguya-sama: Love is War', rarity: 'R', artist_name: 'Aka Akasaka' },
  { character_name: 'Kikuri Hiroi', anime_name: 'Bocchi the Rock!', rarity: 'R', artist_name: 'Aki Hamaji' },
  { character_name: 'Seika Ijichi', anime_name: 'Bocchi the Rock!', rarity: 'R', artist_name: 'Aki Hamaji' },
  { character_name: 'Stark', anime_name: 'Sousou no Frieren', rarity: 'R', artist_name: 'Tsukasa Abe' },
  { character_name: 'Himmel', anime_name: 'Sousou no Frieren', rarity: 'R', artist_name: 'Tsukasa Abe' },
  { character_name: 'Loid Forger', anime_name: 'Spy × Family', rarity: 'R', artist_name: 'Tatsuya Endou' },
  { character_name: 'Tanjiro Kamado', anime_name: 'Demon Slayer', rarity: 'R', artist_name: 'Koyoharu Gotouge' },
  { character_name: 'Zenitsu Agatsuma', anime_name: 'Demon Slayer', rarity: 'R', artist_name: 'Koyoharu Gotouge' },
  { character_name: 'Inosuke Hashibira', anime_name: 'Demon Slayer', rarity: 'R', artist_name: 'Koyoharu Gotouge' }
];

async function getAniListImage(card) {
  const cacheKey = `anilist_img_v2_${encodeURIComponent(card.character_name.toLowerCase())}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Accept': 'application/json' 
      },
      body: JSON.stringify({
        query: `query ($search: String) {
          Character(search: $search) {
            image { large }
          }
        }`,
        variables: { search: card.character_name }
      })
    });

    const data = await res.json();
    const imgUrl = data?.data?.Character?.image?.large;
    if (imgUrl) {
      localStorage.setItem(cacheKey, imgUrl);
      return imgUrl;
    }
  } catch (e) {
    console.warn('Gagal fetch gambar AniList:', e);
  }

  return `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(card.character_name)}`;
}

window.addEventListener('DOMContentLoaded', () => {
  const modalAuth = document.getElementById('modalAuth');
  const btnGacha = document.getElementById('btnTarikGacha');
  if (btnGacha) btnGacha.disabled = false;
  isFlipping = false;

  if (!currentUser) {
    if (modalAuth) modalAuth.style.display = 'flex';
  } else {
    if (modalAuth) modalAuth.style.display = 'none';
    repairUserCollection();
    renderUI();
    syncUserData();
  }

  initPWA();
  initTabs();
  initCountdown();
  initSyncListener();
  initCardDetailModal();
  initGalleryControls();
  initShardExchange();
  initGachaInfoModal();
});

// Perbaiki otomatis kartu lama yang salah gambar atau rusak
async function repairUserCollection() {
  if (!currentUser || !Array.isArray(currentUser.koleksi)) return;
  let hasRepair = false;

  for (let card of currentUser.koleksi) {
    if (!card.url || card.url.includes('nekos.best') || card.url.includes('myanimelist.net') || card.url.includes('weserv.nl')) {
      const match = GACHA_CARD_POOL.find(c => c.character_name.toLowerCase() === (card.character_name || '').toLowerCase());
      if (match) {
        card.url = await getAniListImage(match);
        hasRepair = true;
      }
    }
  }

  if (hasRepair) {
    localStorage.setItem('gacha_user', JSON.stringify(currentUser));
    renderGallery();
  }
}

// 4. Sinkronisasi Realtime
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
    if (document.visibilityState === 'visible' && currentUser) syncUserData();
  });

  window.addEventListener('focus', () => {
    if (currentUser) syncUserData();
  });

  setInterval(() => {
    if (document.visibilityState === 'visible' && currentUser && !isFlipping) syncUserData();
  }, 5000);
}

// 5. Inisialisasi PWA & Notifikasi
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
      playSFX('click');
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
      playSFX('click');
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
    new Notification(title, { body: body, icon: '/icon.png' });
  }
}

// 6. Hitung Mundur Reset 00:00 WIB
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

// 7. Autentikasi Akun
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
          pity: currentUser?.pity || 0,
          shards: currentUser?.shards || 0,
          koleksi: result.koleksi || []
        };
        lastKnownTickets = result.tickets;
        localStorage.setItem('gacha_user', JSON.stringify(currentUser));
        document.getElementById('modalAuth').style.display = 'none';
        repairUserCollection();
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

// 8. Sinkronisasi Data
async function syncUserData() {
  if (!currentUser) return;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'login',
        username: currentUser.username,
        pin: currentUser.pin
      })
    });
    const result = await res.json();
    if (result.success) {
      if (lastKnownTickets < 10 && result.tickets === 10) {
        fireTicketNotification('Tiket Harian Siap! 🎟️', 'Tiket kamu sudah terisi ulang jadi 10! Ayo gacha lagi!');
      }
      lastKnownTickets = result.tickets;
      currentUser.tickets = result.tickets;
      currentUser.koleksi = result.koleksi || [];
      currentUser.pity = currentUser.pity || 0;
      currentUser.shards = currentUser.shards || 0;
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

  const currentPity = currentUser.pity || 0;
  const txtPity = document.getElementById('txtPityCount');
  const barFill = document.getElementById('pityBarFill');
  if (txtPity) txtPity.innerText = `${currentPity} / 30`;
  if (barFill) barFill.style.width = `${Math.min(100, (currentPity / 30) * 100)}%`;

  renderStatsAndShards();
  renderGallery();
}

function renderStatsAndShards() {
  if (!currentUser) return;
  const cards = currentUser.koleksi || [];
  const totalTarik = cards.length;
  const uniqueChars = new Set(cards.map(c => c.character_name)).size;
  const ssrCount = cards.filter(c => c.rarity === 'SSR').length;
  const srCount = cards.filter(c => c.rarity === 'SR').length;
  const ssrRate = totalTarik > 0 ? ((ssrCount / totalTarik) * 100).toFixed(1) : 0;
  const srRate = totalTarik > 0 ? ((srCount / totalTarik) * 100).toFixed(1) : 0;

  const elTotal = document.getElementById('statTotalTarik');
  const elUnik = document.getElementById('statKarakterUnik');
  const elSSR = document.getElementById('statSSRRate');
  const elSR = document.getElementById('statSRRate');
  const elShard = document.getElementById('txtShardCount');

  if (elTotal) elTotal.innerText = totalTarik;
  if (elUnik) elUnik.innerText = `${uniqueChars}/${GACHA_CARD_POOL.length}`;
  if (elSSR) elSSR.innerText = `${ssrRate}%`;
  if (elSR) elSR.innerText = `${srRate}%`;
  if (elShard) elShard.innerText = currentUser.shards || 0;
}

// 9. Tarik Gacha Anti-Macet & Pity System
const btnGacha = document.getElementById('btnTarikGacha');
if (btnGacha) {
  btnGacha.addEventListener('click', async () => {
    if (isFlipping) return;
    if (!currentUser || currentUser.tickets <= 0) {
      return showToast('Tiket harian habis! Balik lagi besok jam 00:00 WIB.');
    }

    playSFX('click');
    const cardWrapper = document.getElementById('kartuWrapper');
    const cardFront = document.getElementById('kartuDepan');
    const cardImg = document.getElementById('kartuImg');

    isFlipping = true;
    btnGacha.disabled = true;
    cardWrapper.classList.remove('flipped');
    await new Promise(r => setTimeout(r, 350));

    showToast('Memanggil kartu anime...');

    const pityNow = currentUser.pity || 0;
    let targetRarity = 'R';
    if (pityNow >= 29) {
      targetRarity = 'SSR';
      showToast('🌟 PITY 30 TERCAPAI: JAMINAN SSR! 🌟');
    } else {
      const roll = Math.random() * 100;
      if (roll <= 5) {
        targetRarity = 'SSR';
      } else if (roll <= 30) {
        targetRarity = 'SR';
      } else {
        targetRarity = 'R';
      }
    }

    const candidates = GACHA_CARD_POOL.filter(c => c.rarity === targetRarity);
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    const verifiedImageUrl = await getAniListImage(chosen);

    const now = new Date();
    const jam = String(now.getHours()).padStart(2, '0');
    const menit = String(now.getMinutes()).padStart(2, '0');
    const waktuLengkap = `${now.toLocaleDateString('id-ID')} ${jam}:${menit} WIB`;

    const newCard = {
      url: verifiedImageUrl,
      artist_name: chosen.artist_name,
      character_name: chosen.character_name,
      anime_name: chosen.anime_name,
      rarity: chosen.rarity,
      date: waktuLengkap,
      timestamp: now.getTime()
    };

    cardFront.className = `card-face card-front rarity-${newCard.rarity}`;
    document.getElementById('kartuRarity').innerText = newCard.rarity;
    document.getElementById('kartuAnime').innerText = newCard.character_name;
    document.getElementById('kartuArtist').innerText = `Artis: ${newCard.artist_name}`;

    const isDuplicate = currentUser.koleksi.some(
      c => c.character_name === newCard.character_name && c.rarity === newCard.rarity
    );

    if (isDuplicate) {
      currentUser.shards = (currentUser.shards || 0) + 1;
      setTimeout(() => {
        showToast(`Kartu kembar! Kamu dapat +1 Star Shard ⭐ (Total: ${currentUser.shards})`);
      }, 1200);
    }

    currentUser.tickets = Math.max(0, currentUser.tickets - 1);
    lastKnownTickets = currentUser.tickets;

    if (newCard.rarity === 'SSR') currentUser.pity = 0;
    else currentUser.pity = (currentUser.pity || 0) + 1;

    currentUser.koleksi.push(newCard);
    localStorage.setItem('gacha_user', JSON.stringify(currentUser));

    document.getElementById('txtTiket').innerText = currentUser.tickets;
    const txtPity = document.getElementById('txtPityCount');
    const barFill = document.getElementById('pityBarFill');
    if (txtPity) txtPity.innerText = `${currentUser.pity} / 30`;
    if (barFill) barFill.style.width = `${Math.min(100, (currentUser.pity / 30) * 100)}%`;

    renderStatsAndShards();

    let cardUnlocked = false;
    const unlockGachaAction = () => {
      if (cardUnlocked) return;
      cardUnlocked = true;
      cardWrapper.classList.add('flipped');
      playSFX('flip');
      isFlipping = false;
      btnGacha.disabled = false;

      if (newCard.rarity === 'SSR') {
        setTimeout(() => {
          playSFX('ssr');
          triggerSSRConfetti();
        }, 300);
        fireTicketNotification('✨ DAPAT KARTU SSR! ✨', `Luar biasa! Kamu baru saja mendapatkan ${newCard.character_name} (${newCard.anime_name}) dengan kelangkaan SSR!`);
      } else if (newCard.rarity === 'SR') {
        setTimeout(() => playSFX('sr'), 300);
        fireTicketNotification('🌟 DAPAT KARTU SR! 🌟', `Keren! Kamu berhasil mendapatkan ${newCard.character_name} (${newCard.anime_name}) dengan kelangkaan SR!`);
      }
    };

    cardImg.onload = unlockGachaAction;
    cardImg.onerror = unlockGachaAction;

    setTimeout(() => {
      if (isFlipping) unlockGachaAction();
    }, 2500);

    cardImg.src = newCard.url;

    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'gacha',
        username: currentUser.username,
        pin: currentUser.pin,
        kartu: newCard
      })
    }).catch(console.error);
  });
}

const cardWrapper = document.getElementById('kartuWrapper');
if (cardWrapper) {
  cardWrapper.addEventListener('click', () => {
    const img = document.getElementById('kartuImg');
    if (img && img.src) {
      playSFX('flip');
      cardWrapper.classList.toggle('flipped');
    }
  });
}

// 10. Album Galeri Koleksi
function renderGallery() {
  const container = document.getElementById('gridGaleri');
  const emptyBox = document.getElementById('galeriKosong');
  const countBadge = document.getElementById('txtKoleksiCount');
  if (!container || !emptyBox) return;

  container.innerHTML = '';
  const cards = (currentUser && currentUser.koleksi) ? currentUser.koleksi.map((c, idx) => ({ ...c, _origIdx: idx })) : [];

  let filtered = cards.filter(c => {
    const matchRarity = (currentFilter === 'all') || (c.rarity === currentFilter);
    const searchTarget = `${c.character_name} ${c.anime_name}`.toLowerCase();
    const matchSearch = !currentSearch || searchTarget.includes(currentSearch);
    return matchRarity && matchSearch;
  });

  if (countBadge) countBadge.innerText = `${filtered.length} Kartu`;

  if (filtered.length === 0) {
    emptyBox.style.display = 'block';
    return;
  }
  emptyBox.style.display = 'none';

  const rarityRank = { 'SSR': 3, 'SR': 2, 'R': 1 };
  filtered.sort((a, b) => {
    if (currentSort === 'name') {
      return (a.character_name || '').localeCompare(b.character_name || '');
    } else if (currentSort === 'rarity') {
      const rankDiff = (rarityRank[b.rarity] || 0) - (rarityRank[a.rarity] || 0);
      if (rankDiff !== 0) return rankDiff;
      if (b.timestamp && a.timestamp && b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
      return b._origIdx - a._origIdx;
    } else {
      if (b.timestamp && a.timestamp && b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
      return b._origIdx - a._origIdx;
    }
  });

  filtered.forEach(c => {
    const charName = c.character_name || 'Karakter Anime';
    const cardKey = `${c.url}_${c._origIdx}`;
    const isNew = !seenCards.has(cardKey);

    const el = document.createElement('div');
    el.className = `mini-card rarity-${c.rarity}`;
    el.innerHTML = `
      ${isNew ? '<span class="badge-new">NEW</span>' : ''}
      <img src="${c.url}" loading="lazy" alt="${charName}">
      <div class="mini-card-info">
        <span class="m-rarity" style="color: var(--rarity-${c.rarity.toLowerCase()})">${c.rarity}</span>
        <h4>${charName}</h4>
      </div>
    `;

    el.addEventListener('click', () => {
      playSFX('click');
      if (isNew) {
        seenCards.add(cardKey);
        localStorage.setItem('gacha_seen_cards', JSON.stringify(Array.from(seenCards)));
        const b = el.querySelector('.badge-new');
        if (b) b.remove();
      }
      openCardDetail(c);
    });

    container.appendChild(el);
  });
}

function initGalleryControls() {
  const searchInput = document.getElementById('inputSearchGaleri');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentSearch = e.target.value.trim().toLowerCase();
      renderGallery();
    });
  }

  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      playSFX('click');
      currentSort = e.target.value;
      renderGallery();
    });
  }

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

// 11. Modal Detail & Download Langsung ke Disk
function initCardDetailModal() {
  const modal = document.getElementById('modalCardDetail');
  const btnClose = document.getElementById('btnCloseDetail');
  const btnDownload = document.getElementById('btnDownloadCard');
  const modalBox = modal ? modal.querySelector('.modal-detail-card') : null;

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      playSFX('click');
      modal.style.display = 'none';
    });
  }
  if (modal) {
    modal.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }
  if (modalBox) {
    modalBox.addEventListener('click', (e) => e.stopPropagation());
  }

  if (btnDownload) {
    btnDownload.addEventListener('click', () => {
      if (!activeModalCard) return;
      playSFX('click');
      downloadCardImage(activeModalCard.url, activeModalCard.character_name);
    });
  }
}

function openCardDetail(card) {
  activeModalCard = card;
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

async function downloadCardImage(url, name) {
  showToast('Menyiapkan download gambar...');
  const filename = `${name.replace(/\s+/g, '_')}_gacha.jpg`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Fetch gagal');
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
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 1500);
    showToast('Gambar tersimpan! 💾');
  }
}

// 12. Modal Rincian Rate & Drop List Pool
function initGachaInfoModal() {
  const modal = document.getElementById('modalGachaInfo');
  const btnBuka = document.getElementById('btnBukaInfoGacha');
  const btnTutup = document.getElementById('btnCloseInfo');
  const btnSubRate = document.getElementById('btnSubRate');
  const btnSubDrop = document.getElementById('btnSubDrop');
  const contentRate = document.getElementById('infoContentRate');
  const contentDrop = document.getElementById('infoContentDrop');
  const inputSearchDrop = document.getElementById('inputSearchDrop');
  const modalBox = modal ? modal.querySelector('.modal-info-card') : null;

  if (btnBuka) {
    btnBuka.addEventListener('click', () => {
      playSFX('click');
      if (modal) modal.style.display = 'flex';
      renderDropList();
    });
  }

  if (btnTutup) {
    btnTutup.addEventListener('click', () => {
      playSFX('click');
      if (modal) modal.style.display = 'none';
    });
  }

  if (modal) {
    modal.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }

  if (modalBox) {
    modalBox.addEventListener('click', (e) => e.stopPropagation());
  }

  if (btnSubRate && btnSubDrop) {
    btnSubRate.addEventListener('click', () => {
      playSFX('click');
      btnSubRate.classList.add('active');
      btnSubDrop.classList.remove('active');
      contentRate.classList.add('active');
      contentDrop.classList.remove('active');
    });

    btnSubDrop.addEventListener('click', () => {
      playSFX('click');
      btnSubDrop.classList.add('active');
      btnSubRate.classList.remove('active');
      contentDrop.classList.add('active');
      contentRate.classList.remove('active');
      renderDropList(inputSearchDrop ? inputSearchDrop.value : '');
    });
  }

  if (inputSearchDrop) {
    inputSearchDrop.addEventListener('input', (e) => {
      renderDropList(e.target.value);
    });
  }
}

function renderDropList(filterText = '') {
  const container = document.getElementById('dropListContainer');
  if (!container) return;
  container.innerHTML = '';
  const search = filterText.trim().toLowerCase();

  const sorted = [...GACHA_CARD_POOL].sort((a, b) => a.character_name.localeCompare(b.character_name));
  const filtered = sorted.filter(item => {
    if (!search) return true;
    return item.character_name.toLowerCase().includes(search) || item.anime_name.toLowerCase().includes(search);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--text-muted); font-size: 11px;">Karakter tidak ditemukan.</div>`;
    return;
  }

  filtered.forEach(item => {
    const el = document.createElement('div');
    el.className = 'drop-item';
    el.innerHTML = `
      <div>
        <div class="drop-item-char">${item.character_name}</div>
        <div class="drop-item-anime">${item.anime_name}</div>
      </div>
      <span class="rate-badge" style="background: rgba(255,255,255,0.08); color: var(--rarity-${item.rarity.toLowerCase()}); font-weight:800; font-size:11px;">${item.rarity}</span>
    `;
    container.appendChild(el);
  });
}

// 13. Penukaran Star Shard (5 Shard ➔ +1 Tiket)
function initShardExchange() {
  const btnTukar = document.getElementById('btnTukarShard');
  if (!btnTukar) return;

  btnTukar.addEventListener('click', async () => {
    if (!currentUser) return;
    const currentShards = currentUser.shards || 0;
    if (currentShards < 5) {
      playSFX('click');
      return showToast('Star Shards belum cukup (butuh 5 shard)');
    }

    playSFX('ssr');
    currentUser.shards = currentShards - 5;
    currentUser.tickets = (currentUser.tickets || 0) + 1;
    lastKnownTickets = currentUser.tickets;
    localStorage.setItem('gacha_user', JSON.stringify(currentUser));
    renderUI();
    showToast('Sukses tukar 5 Shard ➔ +1 Tiket Gacha! 🎟️');

    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'admin_set_ticket',
        adminPin: '9999',
        targetUser: currentUser.username,
        newTicket: currentUser.tickets
      })
    }).catch(console.error);
  });
}

// 14. Navigasi Bawah & Logout
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

      const pane = document.getElementById(target);
      if (pane) pane.classList.add('active');

      if (target === 'tabGaleri') renderGallery();
      if (target === 'tabAkun') renderStatsAndShards();
    });
  });

  const btnBukaAkun = document.getElementById('btnBukaAkun');
  if (btnBukaAkun) {
    btnBukaAkun.addEventListener('click', () => {
      playSFX('click');
      navItems.forEach(n => n.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      const navAkun = document.querySelector('[data-target="tabAkun"]');
      if (navAkun) navAkun.classList.add('active');
      const tabAkun = document.getElementById('tabAkun');
      if (tabAkun) tabAkun.classList.add('active');
      renderStatsAndShards();
    });
  }

  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      playSFX('click');
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

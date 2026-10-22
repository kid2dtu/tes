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

// 3. Database Karakter Anime (150+ Karakter)
const ANIME_CHARACTER_DATABASE = [
  { char: 'Rem', anime: 'Re:Zero' }, { char: 'Ram', anime: 'Re:Zero' }, { char: 'Emilia', anime: 'Re:Zero' },
  { char: 'Beatrice', anime: 'Re:Zero' }, { char: 'Echidna', anime: 'Re:Zero' }, { char: 'Megumin', anime: 'KonoSuba' },
  { char: 'Aqua', anime: 'KonoSuba' }, { char: 'Darkness', anime: 'KonoSuba' }, { char: 'Yunyun', anime: 'KonoSuba' },
  { char: 'Wiz', anime: 'KonoSuba' }, { char: 'Raiden Shogun', anime: 'Genshin Impact' }, { char: 'Hu Tao', anime: 'Genshin Impact' },
  { char: 'Furina', anime: 'Genshin Impact' }, { char: 'Ganyu', anime: 'Genshin Impact' }, { char: 'Kamisato Ayaka', anime: 'Genshin Impact' },
  { char: 'Keqing', anime: 'Genshin Impact' }, { char: 'Yelan', anime: 'Genshin Impact' }, { char: 'Nahida', anime: 'Genshin Impact' },
  { char: 'Navia', anime: 'Genshin Impact' }, { char: 'Arlecchino', anime: 'Genshin Impact' }, { char: 'Yoimiya', anime: 'Genshin Impact' },
  { char: 'Shenhe', anime: 'Genshin Impact' }, { char: 'Nilou', anime: 'Genshin Impact' }, { char: 'Eula', anime: 'Genshin Impact' },
  { char: 'Yae Miko', anime: 'Genshin Impact' }, { char: 'Firefly', anime: 'Honkai: Star Rail' }, { char: 'Kafka', anime: 'Honkai: Star Rail' },
  { char: 'Sparkle', anime: 'Honkai: Star Rail' }, { char: 'March 7th', anime: 'Honkai: Star Rail' }, { char: 'Robin', anime: 'Honkai: Star Rail' },
  { char: 'Acheron', anime: 'Honkai: Star Rail' }, { char: 'Ruan Mei', anime: 'Honkai: Star Rail' }, { char: 'Silver Wolf', anime: 'Honkai: Star Rail' },
  { char: 'Black Swan', anime: 'Honkai: Star Rail' }, { char: 'Feixiao', anime: 'Honkai: Star Rail' }, { char: 'Topaz', anime: 'Honkai: Star Rail' },
  { char: 'Tingyun', anime: 'Honkai: Star Rail' }, { char: 'Fu Xuan', anime: 'Honkai: Star Rail' }, { char: 'Seele', anime: 'Honkai: Star Rail' },
  { char: 'Shiroko', anime: 'Blue Archive' }, { char: 'Hina', anime: 'Blue Archive' }, { char: 'Yuuka', anime: 'Blue Archive' },
  { char: 'Mika', anime: 'Blue Archive' }, { char: 'Aris', anime: 'Blue Archive' }, { char: 'Asuna', anime: 'Blue Archive' },
  { char: 'Karin', anime: 'Blue Archive' }, { char: 'Aru', anime: 'Blue Archive' }, { char: 'Wakamo', anime: 'Blue Archive' },
  { char: 'Hanako', anime: 'Blue Archive' }, { char: 'Koharu', anime: 'Blue Archive' }, { char: 'Azusa', anime: 'Blue Archive' },
  { char: 'Saber (Artoria)', anime: 'Fate/stay night' }, { char: 'Rin Tohsaka', anime: 'Fate/stay night' }, { char: 'Illyasviel', anime: 'Fate/stay night' },
  { char: 'Sakura Matou', anime: 'Fate/stay night' }, { char: 'Mash Kyrielight', anime: 'Fate/Grand Order' }, { char: 'Jeanne d Arc', anime: 'Fate/Grand Order' },
  { char: 'Morgan', anime: 'Fate/Grand Order' }, { char: 'Nero Claudius', anime: 'Fate/EXTRA' }, { char: 'Ishtar', anime: 'Fate/Grand Order' },
  { char: 'Ereshkigal', anime: 'Fate/Grand Order' }, { char: 'Okita Souji', anime: 'Fate/Grand Order' }, { char: 'Castoria', anime: 'Fate/Grand Order' },
  { char: 'Hitori Gotoh (Bocchi)', anime: 'Bocchi the Rock!' }, { char: 'Kita Ikuyo', anime: 'Bocchi the Rock!' }, { char: 'Nijika Ijichi', anime: 'Bocchi the Rock!' },
  { char: 'Ryo Yamada', anime: 'Bocchi the Rock!' }, { char: 'Kikuri Hiroi', anime: 'Bocchi the Rock!' }, { char: 'Chisato Nishikigi', anime: 'Lycoris Recoil' },
  { char: 'Takina Inoue', anime: 'Lycoris Recoil' }, { char: 'Frieren', anime: 'Sousou no Frieren' }, { char: 'Fern', anime: 'Sousou no Frieren' },
  { char: 'Ubel', anime: 'Sousou no Frieren' }, { char: 'Marcille Donato', anime: 'Dungeon Meshi' }, { char: 'Ai Hoshino', anime: 'Oshi no Ko' },
  { char: 'Ruby Hoshino', anime: 'Oshi no Ko' }, { char: 'Kana Arima', anime: 'Oshi no Ko' }, { char: 'Akane Kurokawa', anime: 'Oshi no Ko' },
  { char: 'Mem-Cho', anime: 'Oshi no Ko' }, { char: 'Kaguya Shinomiya', anime: 'Kaguya-sama: Love is War' }, { char: 'Chika Fujiwara', anime: 'Kaguya-sama: Love is War' },
  { char: 'Miko Iino', anime: 'Kaguya-sama: Love is War' }, { char: 'Ai Hayasaka', anime: 'Kaguya-sama: Love is War' }, { char: 'Yor Forger', anime: 'Spy × Family' },
  { char: 'Anya Forger', anime: 'Spy × Family' }, { char: 'Makima', anime: 'Chainsaw Man' }, { char: 'Power', anime: 'Chainsaw Man' },
  { char: 'Reze', anime: 'Chainsaw Man' }, { char: 'Kobeni', anime: 'Chainsaw Man' }, { char: 'Asuna Yuuki', anime: 'Sword Art Online' },
  { char: 'Sinon (Asada Shino)', anime: 'Sword Art Online' }, { char: 'Alice Synthesis Thirty', anime: 'Sword Art Online' }, { char: 'Yuuki Konno', anime: 'Sword Art Online' },
  { char: 'Silica', anime: 'Sword Art Online' }, { char: 'Lisbeth', anime: 'Sword Art Online' }, { char: 'Zero Two', anime: 'Darling in the Franxx' },
  { char: 'Ichigo', anime: 'Darling in the Franxx' }, { char: 'Shirakami Fubuki', anime: 'Hololive' }, { char: 'Usada Pekora', anime: 'Hololive' },
  { char: 'Houshou Marine', anime: 'Hololive' }, { char: 'Hoshimachi Suisei', anime: 'Hololive' }, { char: 'Sakura Miko', anime: 'Hololive' },
  { char: 'Inugami Korone', anime: 'Hololive' }, { char: 'Gawr Gura', anime: 'Hololive' }, { char: 'Mori Calliope', anime: 'Hololive' },
  { char: 'Minato Aqua', anime: 'Hololive' }, { char: 'Marin Kitagawa', anime: 'My Dress-Up Darling' }, { char: 'Kurumi Tokisaki', anime: 'Date A Live' },
  { char: 'Tohka Yatogami', anime: 'Date A Live' }, { char: 'Kotori Itsuka', anime: 'Date A Live' }, { char: 'Origami Tobiichi', anime: 'Date A Live' },
  { char: 'Mai Sakurajima', anime: 'Seishun Buta Yarou' }, { char: 'Shoko Makinohara', anime: 'Seishun Buta Yarou' }, { char: 'Yukino Yukinoshita', anime: 'Oregairu' },
  { char: 'Yui Yuigahama', anime: 'Oregairu' }, { char: 'Iroha Isshiki', anime: 'Oregairu' }, { char: 'Chizuru Mizuhara', anime: 'Rent-a-Girlfriend' },
  { char: 'Ruka Sarashina', anime: 'Rent-a-Girlfriend' }, { char: 'Komi Shouko', anime: 'Komi Can t Communicate' }, { char: 'Hori Kyouko', anime: 'Horimiya' },
  { char: 'Nino Nakano', anime: 'The Quintessential Quintuplets' }, { char: 'Miku Nakano', anime: 'The Quintessential Quintuplets' }, { char: 'Itsuki Nakano', anime: 'The Quintessential Quintuplets' },
  { char: 'Yotsuba Nakano', anime: 'The Quintessential Quintuplets' }, { char: 'Ichika Nakano', anime: 'The Quintessential Quintuplets' }, { char: 'Roxy Migurdia', anime: 'Mushoku Tensei' },
  { char: 'Sylphiette', anime: 'Mushoku Tensei' }, { char: 'Eris Boreas Greyrat', anime: 'Mushoku Tensei' }, { char: 'Raphtalia', anime: 'The Rising of the Shield Hero' },
  { char: 'Filo', anime: 'The Rising of the Shield Hero' }, { char: 'Holo', anime: 'Spice and Wolf' }, { char: 'Senko-san', anime: 'Sewayaki Kitsune no Senko-san' },
  { char: 'Kanna Kamui', anime: 'Miss Kobayashi s Dragon Maid' }, { char: 'Tohru', anime: 'Miss Kobayashi s Dragon Maid' }, { char: 'Elma', anime: 'Miss Kobayashi s Dragon Maid' },
  { char: 'Lucoa', anime: 'Miss Kobayashi s Dragon Maid' }, { char: 'Shuna', anime: 'That Time I Got Reincarnated as a Slime' }, { char: 'Shion', anime: 'That Time I Got Reincarnated as a Slime' },
  { char: 'Milim Nava', anime: 'That Time I Got Reincarnated as a Slime' }, { char: 'Albedo', anime: 'Overlord' }, { char: 'Shalltear Bloodfallen', anime: 'Overlord' },
  { char: 'Nezuko Kamado', anime: 'Demon Slayer' }, { char: 'Shinobu Kocho', anime: 'Demon Slayer' }, { char: 'Mitsuri Kanroji', anime: 'Demon Slayer' },
  { char: 'Kanao Tsuyuri', anime: 'Demon Slayer' }, { char: 'Nobara Kugisaki', anime: 'Jujutsu Kaisen' }, { char: 'Maki Zenin', anime: 'Jujutsu Kaisen' },
  { char: 'Ochaco Uraraka', anime: 'My Hero Academia' }, { char: 'Tsuyu Asui', anime: 'My Hero Academia' }, { char: 'Toga Himiko', anime: 'My Hero Academia' },
  { char: 'Mikasa Ackerman', anime: 'Attack on Titan' }, { char: 'Historia Reiss', anime: 'Attack on Titan' }, { char: 'Hatsune Miku', anime: 'Vocaloid' },
  { char: 'Kagamine Rin', anime: 'Vocaloid' }, { char: 'Megurine Luka', anime: 'Vocaloid' }, { char: 'Taiga Aisaka', anime: 'Toradora!' },
  { char: 'Violet Evergarden', anime: 'Violet Evergarden' }, { char: 'C.C.', anime: 'Code Geass' }, { char: 'Kallen Stadtfeld', anime: 'Code Geass' },
  { char: 'Rias Gremory', anime: 'High School DxD' }, { char: 'Akeno Himejima', anime: 'High School DxD' }, { char: 'Lucy Heartfilia', anime: 'Fairy Tail' },
  { char: 'Erza Scarlet', anime: 'Fairy Tail' }
];

function resolveCardIdentity(card) {
  if (card.character_name && card.character_name !== 'Original Character') {
    return { char: card.character_name, anime: card.anime_name || 'Anime Series' };
  }
  if (card.anime_name && card.anime_name !== 'Original Character' && card.anime_name !== 'Anime Special') {
    return { char: card.anime_name, anime: 'Anime Series' };
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
  initGalleryControls();
  initShardExchange();
  initGachaInfoModal();
});

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
  const uniqueChars = new Set(cards.map(c => resolveCardIdentity(c).char)).size;
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
  if (elUnik) elUnik.innerText = `${uniqueChars}/150`;
  if (elSSR) elSSR.innerText = `${ssrRate}%`;
  if (elSR) elSR.innerText = `${srRate}%`;
  if (elShard) elShard.innerText = currentUser.shards || 0;
}

// 9. Tarik Gacha
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

    isFlipping = true;
    btnGacha.disabled = true;
    cardWrapper.classList.remove('flipped');
    await new Promise(r => setTimeout(r, 350));
    showToast('Memanggil kartu anime...');

    const pityNow = currentUser.pity || 0;
    let rarity = 'R';
    let endpoint = 'neko';

    if (pityNow >= 29) {
      rarity = 'SSR';
      endpoint = 'smug';
      showToast('🌟 PITY 30 TERCAPAI: JAMINAN SSR! 🌟');
    } else {
      const roll = Math.random() * 100;
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
    }

    try {
      const res = await fetch(`https://nekos.best/api/v2/${endpoint}`);
      const data = await res.json();
      const item = data.results[0];

      const identity = resolveCardIdentity({ url: item.url, anime_name: item.anime_name });
      const charName = (item.anime_name && item.anime_name !== 'Original Character') ? item.anime_name : identity.char;
      const animeName = identity.anime;

      const now = new Date();
      const jam = String(now.getHours()).padStart(2, '0');
      const menit = String(now.getMinutes()).padStart(2, '0');
      const waktuLengkap = `${now.toLocaleDateString('id-ID')} ${jam}:${menit} WIB`;

      const newCard = {
        url: item.url,
        artist_name: item.artist_name || 'Artis Komunitas',
        character_name: charName,
        anime_name: animeName,
        rarity: rarity,
        date: waktuLengkap,
        timestamp: now.getTime()
      };

      cardFront.className = `card-face card-front rarity-${rarity}`;
      document.getElementById('kartuRarity').innerText = rarity;
      document.getElementById('kartuImg').src = newCard.url;
      document.getElementById('kartuAnime').innerText = newCard.character_name;
      document.getElementById('kartuArtist').innerText = `Artis: ${newCard.artist_name}`;

      const isDuplicate = currentUser.koleksi.some(
        c => resolveCardIdentity(c).char === charName && c.rarity === rarity
      );
      if (isDuplicate) {
        currentUser.shards = (currentUser.shards || 0) + 1;
        setTimeout(() => {
          showToast(`Kartu kembar! Kamu dapat +1 Star Shard ⭐ (Total: ${currentUser.shards})`);
        }, 1200);
      }

      currentUser.tickets = Math.max(0, currentUser.tickets - 1);
      lastKnownTickets = currentUser.tickets;

      if (rarity === 'SSR') currentUser.pity = 0;
      else currentUser.pity = (currentUser.pity || 0) + 1;

      currentUser.koleksi.push(newCard);
      localStorage.setItem('gacha_user', JSON.stringify(currentUser));
      document.getElementById('txtTiket').innerText = currentUser.tickets;

      const txtPity = document.getElementById('txtPityCount');
      const barFill = document.getElementById('pityBarFill');
      if (txtPity) txtPity.innerText = `${currentUser.pity} / 30`;
      if (barFill) barFill.style.width = `${Math.min(100, (currentUser.pity / 30) * 100)}%`;

      renderStatsAndShards();

      document.getElementById('kartuImg').onload = () => {
        cardWrapper.classList.add('flipped');
        playSFX('flip');
        isFlipping = false;
        btnGacha.disabled = false;

        if (rarity === 'SSR') {
          setTimeout(() => {
            playSFX('ssr');
            triggerSSRConfetti();
          }, 300);
          fireTicketNotification('✨ DAPAT KARTU SSR! ✨', `Luar biasa! Kamu baru saja mendapatkan ${newCard.character_name} (${newCard.anime_name}) dengan kelangkaan SSR!`);
        } else if (rarity === 'SR') {
          setTimeout(() => playSFX('sr'), 300);
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
  const cards = (currentUser && currentUser.koleksi) 
    ? currentUser.koleksi.map((c, idx) => ({ ...c, _origIdx: idx })) 
    : [];

  let filtered = cards.filter(c => {
    const matchRarity = (currentFilter === 'all') || (c.rarity === currentFilter);
    const identity = resolveCardIdentity(c);
    const searchTarget = `${identity.char} ${identity.anime}`.toLowerCase();
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
      const nameA = resolveCardIdentity(a).char;
      const nameB = resolveCardIdentity(b).char;
      return nameA.localeCompare(nameB);
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
    const identity = resolveCardIdentity(c);
    const charName = identity.char;
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
      openCardDetail({
        url: c.url,
        rarity: c.rarity,
        character_name: charName,
        anime_name: identity.anime,
        artist_name: c.artist_name || 'Artis Komunitas',
        date: c.date || 'Waktu tidak tercatat'
      });
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

// 11. Modal Pratinjau & Simpan Gambar Langsung ke Disk (Bypass CORS)
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
  const rawExt = url.split('.').pop().split('?')[0].toLowerCase();
  const ext = ['gif', 'png', 'jpg', 'jpeg', 'webp'].includes(rawExt) ? rawExt : 'png';
  const filename = `${name.replace(/\s+/g, '_')}_gacha.${ext}`;

  const proxyList = [
    `https://images.weserv.nl/?url=${encodeURIComponent(url)}&default=${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url
  ];

  let blob = null;
  for (const targetUrl of proxyList) {
    try {
      const res = await fetch(targetUrl);
      if (res.ok) {
        blob = await res.blob();
        if (blob && blob.size > 0) break;
      }
    } catch (err) {}
  }

  if (blob) {
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
    }, 2500);
    showToast('Gambar berhasil disimpan ke disk! 💾');
  } else {
    showToast('Gagal mengunduh gambar');
  }
}

// 12. Modal Rincian Rate & Drop List Karakter
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

  // Switch Sub-Tab
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

  const uniqueChars = [];
  const seen = new Set();
  ANIME_CHARACTER_DATABASE.forEach(item => {
    if (!seen.has(item.char)) {
      seen.add(item.char);
      uniqueChars.push(item);
    }
  });

  uniqueChars.sort((a, b) => a.char.localeCompare(b.char));

  const filtered = uniqueChars.filter(item => {
    if (!search) return true;
    return item.char.toLowerCase().includes(search) || item.anime.toLowerCase().includes(search);
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
        <div class="drop-item-char">${item.char}</div>
        <div class="drop-item-anime">Seri: ${item.anime}</div>
      </div>
      <span style="font-size: 10px; color: #818cf8; font-weight: 700;">Tersedia di Pool</span>
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

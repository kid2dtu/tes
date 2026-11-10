// Konfigurasi Terpusat AnimeGacha
const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbz3LraveIpKMeajlIpnf5KcG4vGffBtdkY9LtFucyhwbTUVEWPKWLW8vDlwdVbmJ0REMg/exec",
  POLLING_INTERVAL_MS: 45000,
  CACHE_KEYS: {
    CARD_POOL: "animegacha_card_pool_cache",
    LAST_SEEN_ANNOUNCEMENT: "last_seen_announcement",
    USER: "gacha_user",
    PIN: "gacha_pin"
  }
};

// Export untuk berbagai environment jika diperlukan
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}

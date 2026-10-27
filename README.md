# Notulensi Kajian (versi hosting sendiri)

Satu proyek Cloudflare Worker: halaman web + server kecil yang (1) mengambil CC YouTube dan (2) memanggil Claude API.
API key tersimpan di server, tidak pernah dikirim ke browser.

## Struktur
- `public/index.html`  halaman aplikasi
- `worker.js`          /api/transcript dan /api/generate
- `wrangler.toml`      konfigurasi (model: claude-sonnet-5-5)

## Deploy (sekitar 5 menit, gratis di paket Cloudflare Free)
1. Siapkan: Node.js 18+, akun Cloudflare (gratis), dan API key dari console.anthropic.com
2. Di folder ini:
   npm install -g wrangler
   wrangler login
   wrangler secret put ANTHROPIC_API_KEY     # tempel API key
   wrangler secret put ACCESS_CODE           # kode rahasia buatanmu
   wrangler deploy
3. Buka URL `https://notulensi-kajian.<akunmu>.workers.dev`, isi kode akses, tempel link YouTube.

## Coba lokal
   cp .dev.vars.example .dev.vars   # isi key dan kode
   wrangler dev

## Catatan penting
- Biaya: Claude API dibayar per pemakaian (satu kajian 20 slide kira-kira puluhan ribu token output).
- Ambil CC: memakai endpoint internal YouTube (klien Android). Ini tidak resmi, bisa berubah atau
  memblokir IP cloud sewaktu-waktu. Jika gagal, tempel transkrip manual di kolom yang tersedia.
- Video tanpa CC: aplikasi berhenti dengan pesan "Maaf, video ini tidak memiliki CC/Subtitle..."
- Ubah model: edit `MODEL` di wrangler.toml lalu deploy ulang.
- Jangan bagikan kode akses dan jangan commit `.dev.vars` ke Git.

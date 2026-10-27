// Cloudflare Worker: /api/transcript (ambil CC YouTube) dan /api/generate (panggil Claude, streaming)
const UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip';

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function videoId(u) {
  try {
    const x = new URL(u);
    if (x.hostname === 'youtu.be') return x.pathname.slice(1, 12);
    if (x.searchParams.get('v')) return x.searchParams.get('v');
    const m = x.pathname.match(/\/(?:live|shorts|embed)\/([\w-]{11})/);
    return m ? m[1] : null;
  } catch { return null; }
}

async function getCaptions(id) {
  const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': UA,
      'x-youtube-client-name': '3',
      'x-youtube-client-version': '20.10.38',
    },
    body: JSON.stringify({
      context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, hl: 'id', gl: 'ID' } },
      videoId: id, contentCheckOk: true, racyCheckOk: true,
    }),
  });
  if (!r.ok) throw new Error('YouTube menolak permintaan (' + r.status + ')');
  const d = await r.json();
  const vd = d.videoDetails || {};
  const mf = d.microformat?.playerMicroformatRenderer || {};
  const tracks = d.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const info = {
    title: vd.title || '',
    channel: vd.author || mf.ownerChannelName || '',
    uploadDate: (mf.uploadDate || mf.publishDate || '').slice(0, 10),
  };
  if (!tracks.length) return { info, text: null };

  // Prioritas: Indonesia manual > Indonesia otomatis > bahasa lain manual > apa pun
  const score = t => (t.languageCode?.startsWith('id') ? 0 : 2) + (t.kind === 'asr' ? 1 : 0);
  const t = [...tracks].sort((a, b) => score(a) - score(b))[0];
  const cr = await fetch(t.baseUrl + '&fmt=json3', { headers: { 'user-agent': UA } });
  if (!cr.ok) throw new Error('Gagal mengunduh CC (' + cr.status + ')');
  const body = await cr.text();
  if (!body) throw new Error('CC kosong dari YouTube');
  const cj = JSON.parse(body);
  const text = (cj.events || [])
    .filter(e => e.segs)
    .map(e => e.segs.map(s => s.utf8).join('').replace(/\n/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\[(?:Musik|Music|Tepuk tangan|Applause)\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { info: { ...info, lang: t.languageCode, auto: t.kind === 'asr' }, text };
}

const SYS = n => `ROLE: Kamu Islamic Content Creator dan Notulen profesional. Ubah transkrip kajian mentah menjadi slide "content transcript" (notulensi) berdetail tinggi yang tetap menjaga esensi, kosakata, idiom, dan gaya retorika asli pembicara.

ATURAN ISI:
- Bagi isi ke dalam TEPAT ${n} slide berurutan secara logis. Susunan mengikuti transkrip asli.
- Verbatim lengkap dan rinci: pertahankan diksi sesuai transkrip, buang sapaan/basa-basi/kalimat tak perlu ("kita mulai", "kita lanjutkan", "pembahasan kali ini", dll.). Kutipan ulama dan kutipan asli ustadz harus spesifik dan menonjolkan gaya bahasa asli.
- Tebalkan (**...**) argumen kunci, prinsip dasar, dan golden quotes.
- Slide 1: mulai langsung dengan hook/konteks. JANGAN pakai pembuka umum ("Segala puji bagi Allah...", shalawat, dll.).
- Slide terakhir: kesimpulan/ringkasan menyentuh + ajakan (CTA).
- DILARANG menulis timestamp. Jangan mengarang isi yang tidak ada di transkrip.

ATURAN BAHASA:
- Narasi, penjelasan, judul: BAHASA INDONESIA.
- Gunakan simbol ﷺ (bukan SAW) dan frasa lengkap "subhanahu wa ta’ala" (bukan SWT).
- Tulis honorifik setelah nama ustadz, ulama, sahabat, dan nabi (mis. ‘alaihis salam, radhiyallahu ‘anhu, rahimahullah, ﷺ), tanpa singkatan.
- Jika transkrip menyebut ayat Al-Qur’an atau hadits: tulis teks ARAB lalu artinya dalam Indonesia.

ATURAN FORMAT:
- Panjang "body" tiap slide: minimal 2000 dan maksimal 2500 karakter.
- Beri baris baru (\\n) pada setiap kalimat atau paragraf agar mudah dibaca.
- Jangan masukkan judul atau footer ke dalam body.

RUJUKAN: Untuk tiap slide, daftar semua rujukan yang DISEBUTKAN pembicara (ayat dengan nama surah:nomor, hadits beserta perawi bila disebut, kitab/ulama). Jika tidak ada, array kosong. Jangan menambah rujukan yang tidak disebut.

CAPTION: Buat satu caption akhir yang relevan, mendalam, dan menggugah hati, disertai kutipan ustadz dengan gaya bahasa aslinya.

OUTPUT: HANYA JSON valid tanpa teks lain dan tanpa backtick:
{"slides":[{"title":"...","body":"...","refs":["..."]}],"caption":"..."}`;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });

    // Kunci akses sederhana agar API key kamu tidak dipakai orang lain
    if (env.ACCESS_CODE && req.headers.get('x-access-code') !== env.ACCESS_CODE)
      return json({ error: 'Kode akses salah atau belum diisi.' }, 401);

    try {
      if (url.pathname === '/api/transcript') {
        const id = videoId(url.searchParams.get('url') || '');
        if (!id) return json({ error: 'Link YouTube tidak valid.' }, 400);
        const { info, text } = await getCaptions(id);
        if (!text) return json({ error: 'no_captions', info }, 404);
        return json({ ...info, text });
      }

      if (url.pathname === '/api/generate' && req.method === 'POST') {
        if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY belum di-set.' }, 500);
        const { transcript, n = 20, title = '', ustadz = '', channel = '' } = await req.json();
        if (!transcript || transcript.length < 300) return json({ error: 'Transkrip terlalu pendek.' }, 400);
        const slides = Math.max(1, Math.min(40, parseInt(n) || 20));
        const up = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: env.MODEL || 'claude-sonnet-5-5',
            max_tokens: Math.min(60000, slides * 1500 + 2000),
            stream: true,
            system: SYS(slides),
            messages: [{ role: 'user', content: `INFO: Judul: ${title}; Ustadz: ${ustadz}; Channel: ${channel}.\n\nTRANSKRIP:\n${transcript}` }],
          }),
        });
        if (!up.ok) return json({ error: 'Claude API: ' + (await up.text()) }, 502);
        return new Response(up.body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
      }
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
  },
};

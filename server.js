// SecureLocal - basit yerel RAG sunucusu
// Belgeleri okur, TF-IDF ile "en alakalı parça"yı bulur, Foundry Local'daki modele sorar.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');

// Foundry Local'a istek atmak için global fetch gerekiyor; eski Node'da sessizce
// hep yedek moda düşmek yerine sebebi açıkça söyleyip duruyoruz.
if (typeof fetch !== 'function') {
  console.error(`SecureLocal: Node.js 18 veya üstü gerekiyor. Mevcut sürüm: ${process.version}`);
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, 'data');
const FOUNDRY_BASE_URL = process.env.FOUNDRY_BASE_URL || 'http://localhost:5273/v1';
const FOUNDRY_MODEL = process.env.FOUNDRY_MODEL || ''; // boş bırakılırsa model otomatik bulunur
const PORT = process.env.PORT || 3000;

const SYSTEM_PROMPT = `Sen SecureLocal adında bir siber güvenlik danışmanısın.
Sadece sana verilen kaynak parçalarından yararlanarak cevap ver.
Kaynaklarda olmayan bir şeyi uydurma; emin değilsen "Bu konuda kaynaklarımda yeterli bilgi yok" de.
Cevabını kısa, net ve Türkçe yaz. Mümkünse hangi kaynaktan yararlandığını belirt.`;

// ---- 1) Belgeleri oku ve parçalara (chunk) böl ----
// Her belgeyi boş satırlara göre paragraflara ayırıyoruz, her paragraf bir "chunk".
function loadChunks() {
  const chunks = [];
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.txt'));

  for (const file of files) {
    const text = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
    const paragraflar = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

    // Başlık gibi çok kısa paragraflar tek başına chunk olursa TF-IDF'i yanıltıyor,
    // bu yüzden bir sonraki paragrafla birleştiriyoruz.
    const birlesmis = [];
    let bekleyen = '';
    for (const p of paragraflar) {
      bekleyen = bekleyen ? `${bekleyen}\n${p}` : p;
      if (bekleyen.length >= 80) {
        birlesmis.push(bekleyen);
        bekleyen = '';
      }
    }
    if (bekleyen) birlesmis.push(bekleyen);

    birlesmis.forEach((p, i) => {
      chunks.push({ id: `${file}#${i}`, kaynak: file, metin: p });
    });
  }

  return chunks;
}

// ---- 2) Basit TF-IDF vektörleri ----
// Gerçek bir embedding modeli indirmeden, klasik bilgi getirimi yöntemiyle
// "hangi kelime hangi parçada ne kadar önemli" hesaplıyoruz.

// TF-IDF tam kelime eşleşmesi arar; "şifre" sorup belgede sadece "parola"
// yazması durumunda hiç eşleşme bulamaz. Sık karışan birkaç eş anlamlıyı
// aynı köke indirerek bu sorunu basitçe çözüyoruz.
const ESANLAMLILAR = {
  şifre: 'parola',
  şifreyi: 'parola',
  şifremi: 'parola',
  hack: 'saldırı',
  hacker: 'saldırgan',
};

// Türkçe sondan eklemeli bir dil: soruda "saatte / ihlalini / bildirmeliyim" yazarken belgede
// "saat / ihlal / bildirir" geçiyor ve tam kelime eşleşmesi hiçbirini yakalayamıyor. Her kelimeyi
// ilk 4 harfine indirmek (kaba gövdeleme), ek almış hâlleri aynı köke topluyor.
const GOVDE_UZUNLUGU = 4;

function tokenize(text) {
  return text
    .toLocaleLowerCase('tr')
    .replace(/[^a-zçğıöşü0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .map((w) => ESANLAMLILAR[w] || w)
    .map((w) => w.slice(0, GOVDE_UZUNLUGU));
}

function buildIndex(chunks) {
  const df = new Map(); // kelime -> kaç farklı chunk'ta geçiyor
  const tokenized = chunks.map((c) => tokenize(c.metin));

  tokenized.forEach((words) => {
    new Set(words).forEach((w) => df.set(w, (df.get(w) || 0) + 1));
  });

  const n = chunks.length;
  const idf = new Map();
  df.forEach((count, word) => idf.set(word, Math.log(n / count) + 1));

  const vectors = tokenized.map((words) => {
    const tf = new Map();
    words.forEach((w) => tf.set(w, (tf.get(w) || 0) + 1));
    const vec = new Map();
    tf.forEach((count, word) => vec.set(word, (count / words.length) * idf.get(word)));
    return vec;
  });

  return { idf, vectors };
}

function vectorFromQuery(query, idf) {
  const words = tokenize(query);
  const tf = new Map();
  words.forEach((w) => tf.set(w, (tf.get(w) || 0) + 1));
  const vec = new Map();
  tf.forEach((count, word) => {
    if (idf.has(word)) vec.set(word, (count / words.length) * idf.get(word));
  });
  return vec;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  a.forEach((val, key) => {
    normA += val * val;
    if (b.has(key)) dot += val * b.get(key);
  });
  b.forEach((val) => (normB += val * val));
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function search(query, chunks, index, topK = 4) {
  const queryVec = vectorFromQuery(query, index.idf);
  const scored = chunks.map((chunk, i) => ({
    ...chunk,
    benzerlik: cosineSimilarity(queryVec, index.vectors[i]),
  }));
  return scored
    .filter((c) => c.benzerlik > 0)
    .sort((a, b) => b.benzerlik - a.benzerlik)
    .slice(0, topK);
}

// ---- 3) Foundry Local'a bağlanıp cevabı ürettir ----

// Modelin tam adı bilgisayardan bilgisayara değişiyor (ör. "...-cpu:2" ile "...-gpu:2",
// farklı sürüm numaraları). Koda sabit bir ad yazınca başka bir makinede istek 400 dönüp
// uygulama sessizce yedek moda düşüyordu. Bu yüzden .env'de ad verilmemişse indirilmiş
// modelleri Foundry'ye sorup ilkini seçiyoruz.
let secilenModel = FOUNDRY_MODEL;
async function modelAdiniBul() {
  if (secilenModel) return secilenModel;

  const r = await fetch(`${FOUNDRY_BASE_URL}/models`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Model listesi alınamadı: ${r.status}`);

  const idler = ((await r.json()).data || []).map((m) => m.id);
  if (idler.length === 0) {
    throw new Error('Foundry Local çalışıyor ama indirilmiş model yok (foundry model run ... ile indir).');
  }

  secilenModel = idler.find((id) => /phi/i.test(id)) || idler[0];
  console.log(`SecureLocal: kullanılacak model otomatik seçildi -> ${secilenModel}`);
  return secilenModel;
}

async function askFoundry(soru, kaynakParcalari) {
  const baglam = kaynakParcalari
    .map((k, i) => `[Kaynak ${i + 1} - ${k.kaynak}]\n${k.metin}`)
    .join('\n\n');

  const body = {
    model: await modelAdiniBul(),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Kaynaklar:\n\n${baglam}\n\nSoru: ${soru}` },
    ],
    temperature: 0.2,
    max_tokens: 500,
  };

  const response = await fetch(`${FOUNDRY_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) throw new Error(`Foundry Local hata döndü: ${response.status}`);

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim();
}

// Foundry Local çalışmıyorsa (henüz kurulmadıysa) sistemin yine de bir şey göstermesi için
// bulunan kaynak parçalarını doğrudan özetleyerek dönüyoruz.
function yedekCevap(kaynakParcalari) {
  if (kaynakParcalari.length === 0) {
    return 'Kaynaklarımda bu soruyla ilgili bir şey bulamadım.';
  }
  const ozet = kaynakParcalari.map((k) => `• (${k.kaynak}) ${k.metin.slice(0, 220)}...`).join('\n\n');
  return `Foundry Local'a şu an ulaşılamadı, bu yüzden en alakalı kaynak parçaları doğrudan gösteriliyor:\n\n${ozet}`;
}

// ---- 4) Sunucu ----
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const chunks = loadChunks();
const index = buildIndex(chunks);
console.log(`SecureLocal: ${chunks.length} kaynak parçası yüklendi.`);

app.post('/api/ask', async (req, res) => {
  const soru = (req.body.soru || '').trim();
  if (!soru) return res.status(400).json({ hata: 'Soru boş olamaz.' });

  const bulunanlar = search(soru, chunks, index);

  let cevap;
  let foundryCalisti = true;

  if (bulunanlar.length === 0) {
    cevap = 'Bu konuyla ilgili kaynaklarımda bir bilgi bulamadım.';
  } else {
    try {
      cevap = await askFoundry(soru, bulunanlar);
      if (!cevap) throw new Error('Foundry Local boş cevap döndü.');
    } catch (err) {
      // Sebebi terminale yaz; aksi halde "neden yedek moda düştü" görünmez oluyor.
      console.warn(`SecureLocal: Foundry Local'dan cevap alınamadı — ${err.message}`);
      foundryCalisti = false;
      cevap = yedekCevap(bulunanlar);
    }
  }

  res.json({
    cevap,
    foundryCalisti,
    kaynaklar: bulunanlar.map((k) => ({
      dosya: k.kaynak,
      parca: k.metin.slice(0, 160) + (k.metin.length > 160 ? '...' : ''),
      benzerlik: Number(k.benzerlik.toFixed(3)),
    })),
  });
});

app.get('/api/health', async (req, res) => {
  try {
    // Sadece servis ayakta mı değil, kullanılabilir bir model de var mı diye bakıyoruz.
    res.json({ foundry: true, model: await modelAdiniBul() });
  } catch (err) {
    res.json({ foundry: false, sebep: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`SecureLocal http://localhost:${PORT} adresinde çalışıyor.`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`SecureLocal: ${PORT} portu başka bir program tarafından kullanılıyor.`);
    console.error('Farklı bir portta başlatmak için: PORT=3001 npm start');
    process.exit(1);
  }
  throw err;
});

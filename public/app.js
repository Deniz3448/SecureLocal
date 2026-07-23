const soruInput = document.getElementById('soru');
const sorBtn = document.getElementById('sor-btn');
const durum = document.getElementById('durum');
const sonuc = document.getElementById('sonuc');
const cevapMetni = document.getElementById('cevap-metni');
const kaynakListesi = document.getElementById('kaynak-listesi');

async function soruSor(soru) {
  if (!soru) return;

  sorBtn.disabled = true;
  durum.textContent = 'Kaynaklarda aranıyor ve cevap üretiliyor... (yerel model yavaş olabilir, ~1 dakika sürebilir)';
  sonuc.classList.add('hidden');

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ soru }),
    });

    if (!res.ok) throw new Error('Sunucu hatası');
    const data = await res.json();

    cevapMetni.textContent = data.cevap;
    kaynakListesi.innerHTML = '';

    if (data.kaynaklar.length === 0) {
      kaynakListesi.innerHTML = '<li>İlgili kaynak bulunamadı.</li>';
    } else {
      data.kaynaklar.forEach((k) => {
        const li = document.createElement('li');
        li.innerHTML = `<b>${k.dosya}</b> (benzerlik: ${k.benzerlik}) — ${k.parca}`;
        kaynakListesi.appendChild(li);
      });
    }

    durum.textContent = data.foundryCalisti
      ? ''
      : 'Not: Foundry Local şu an çalışmıyor gibi görünüyor, ham kaynaklar gösterildi.';
    sonuc.classList.remove('hidden');
  } catch (err) {
    durum.textContent = 'Bir hata oluştu: ' + err.message;
  } finally {
    sorBtn.disabled = false;
  }
}

sorBtn.addEventListener('click', () => soruSor(soruInput.value.trim()));

soruInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    soruSor(soruInput.value.trim());
  }
});

document.querySelectorAll('.ornek').forEach((btn) => {
  btn.addEventListener('click', () => {
    soruInput.value = btn.dataset.soru;
    soruSor(btn.dataset.soru);
  });
});

// URL'ye ?soru=... eklenirse otomatik doldurup soruyu sorar (ör. ekran görüntüsü almak için).
const urlSoru = new URLSearchParams(window.location.search).get('soru');
if (urlSoru) {
  soruInput.value = urlSoru;
  soruSor(urlSoru);
}

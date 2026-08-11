# SecureLocal 🛡

**Tamamen yerel çalışan, kaynak göstererek cevap veren bir siber güvenlik ve KVKK danışmanı.**

Microsoft Yaz Programı 2026 — Azure Foundry Local (Local RAG) projesi. Hazırlayan: [Deniz](https://github.com/Deniz3448), 2. sınıf Yazılım Geliştirme öğrencisi.

![SecureLocal ekran görüntüsü](screenshot.png)

---

## Bu proje ne yapıyor?

SecureLocal'a bir siber güvenlik veya KVKK sorusu soruyorsun ("Şifre politikam yeterli mi?",
"SQL injection nasıl önlenir?" gibi). Uygulama, cevabı kafasından uydurmuyor: önce kendi
belgelerinden (OWASP Top 10, KVKK özeti, örnek bir şirket parola politikası, örnek güvenlik açığı
senaryoları) en alakalı parçaları buluyor, sonra bu parçaları kaynak göstererek, **tamamen kendi
bilgisayarında çalışan** bir yapay zeka modeliyle cevaba dönüştürüyor.

## Neden yerel?

Bir şirketin parola politikasını ya da bir güvenlik açığını ChatGPT'ye sormak, o veriyi buluta
göndermek demek. SecureLocal, [Azure Foundry Local](https://learn.microsoft.com/azure/ai-foundry/foundry-local/)
kullanarak modeli tamamen bilgisayarda çalıştırıyor — hiçbir soru, hiçbir belge internete
gitmiyor. İnternet bağlantısını tamamen kapatıp da çalıştırabilirsin; bu, hassas güvenlik verisiyle
uğraşan bir araç için tam da işverenlerin aradığı özellik: "veri bilgisayardan çıkmıyor."

## Nasıl çalışıyor? (RAG akışı)

```
Sen soru sorarsın
   ↓
Soru, kaynak belgelerdeki paragraflarla TF-IDF + kosinüs benzerliği ile karşılaştırılır
   ↓
En alakalı 4 parça bulunur                              ←── Retrieval (Getirme)
   ↓
Bu parçalar + soru, Foundry Local'daki modele gönderilir
   ↓
Model sadece bu kaynaklara dayanarak cevap yazar         ←── Generation (Üretim)
   ↓
Cevap + hangi belgeden geldiği ekrana döner
```

Gömme (embedding) adımı için harici bir model indirmek yerine, klasik bir bilgi getirimi yöntemi
olan **TF-IDF + kosinüs benzerliği** kullanılıyor — hiçbir ek bağımlılık gerektirmiyor, kurulumu
saniyeler sürüyor ve mantığını uçtan uca okuyup anlamak kolay.

TF-IDF tam kelime eşleşmesi aradığı için Türkçede iki yerde tökezliyordu; ikisini de basit
yöntemlerle çözdüm:

- **Eş anlamlılar** (`ESANLAMLILAR`, örn. "şifre" ↔ "parola"): kullanıcı "şifre" diye sorup belge
  "parola" diyorsa hiç sonuç dönmüyordu.
- **Ekler:** Türkçe sondan eklemeli bir dil — soruda "veri ihlalini kaç **saatte** bildirmeliyim"
  yazarken belgede "en geç 72 **saat** içinde" geçiyor ve hiçbiri eşleşmiyordu. Her kelimeyi ilk 4
  harfine indirerek (kaba gövdeleme) ek almış hâlleri aynı köke topladım; bu tek satır, yukarıdaki
  sorunun doğru paragrafını hiç bulunamaz durumdan 1. sıraya taşıdı.

İkisi de, gerçek bir embedding modelinin kendiliğinden çözdüğü "anlamca yakın kelimeleri tanıma"
problemine ucuz birer çözüm.

## Proje yapısı

```
SecureLocal/
├── data/                        kaynak belgeler (.txt) — buraya kendi belgeni de atabilirsin
│   ├── owasp-top10.txt
│   ├── kvkk-ozet.txt
│   ├── sifre-politikasi.txt
│   └── guvenlik-aciklari-ornek.txt
├── public/                      arayüz (saf HTML/CSS/JS, framework yok)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── server.js                    backend: chunking, TF-IDF arama, Foundry Local entegrasyonu
├── package.json
└── .env.example                 Foundry Local bağlantı ayarları şablonu
```

## Kurulum

**Gereken:** Node.js 18 veya üstü (`node -v` ile kontrol et) ve Foundry Local.

**1) Foundry Local'ı kur**

```bash
# Windows
winget install Microsoft.FoundryLocal

# macOS
brew tap microsoft/foundrylocal && brew install foundrylocal
```

**2) Servisi başlat ve modeli indir** (iki işletim sisteminde de aynı)

```bash
foundry service set --port 5273   # portu sabitle, her açılışta aynı kalsın
foundry service start
foundry model run phi-3.5-mini    # cihazına uygun sürümü kendisi seçip indirir
```

**3) Projeyi çalıştır**

```bash
npm install
npm start
```

Tarayıcıda `http://localhost:3000` adresini aç.

> **`.env` dosyası oluşturmana gerek yok** — uygulama varsayılan olarak `localhost:5273`'e bağlanır
> ve indirilmiş modeli Foundry'den otomatik bulur (model adı cihaza göre `...-cpu:2` / `...-gpu:2`
> şeklinde değişebiliyor). Portu ya da modeli elle değiştirmek istersen `cp .env.example .env`
> yapıp düzenleyebilirsin (Windows'ta `copy .env.example .env`).

> Foundry Local henüz kurulu değilse veya çalışmıyorsa uygulama çökmez: en alakalı kaynak
> parçalarını doğrudan gösteren bir yedek moda düşer, böylece arayüzü yine de test edebilirsin.
> Bu durumda sunucunun çalıştığı terminale sebebi de yazılır.

> **Hız notu:** Bu, bulut değil senin bilgisayarında çalışan küçük bir model — ekran kartı yoksa
> (CPU'da) bir cevap üretmesi 30 saniye ile 1.5 dakika arasında sürebilir. Bu normal; "yerel ve
> gizli çalışmanın" bedeli budur.

## Örnek sorular

- "Şifre politikam yeterli mi?"
- "KVKK'ya göre veri ihlalini kaç saatte bildirmeliyim?"
- "SQL injection nedir ve nasıl önlenir?"
- "OWASP Top 10'da erişim denetimi neden önemli?"

## Kullanılan teknolojiler

- **Node.js + Express** — sunucu
- **Azure Foundry Local** (`phi-3.5-mini`) — yerel LLM çalıştırma, OpenAI-uyumlu API
- **TF-IDF + kosinüs benzerliği** — yerel arama/retrieval, harici embedding modeli gerektirmez
- Sade **HTML/CSS/JS** arayüz — framework yok

## Bilinen sınırlamalar

- TF-IDF, gerçek embedding modelleri gibi "anlamı" değil, sadece kelime örtüşmesini anlıyor.
  Eş anlamlı sözlük ve 4 harflik gövdeleme bunu kısmen telafi ediyor ama tam bir çözüm değil;
  gövdeleme bazen farklı kelimeleri de aynı köke indirebiliyor (ör. "güvenlik" / "güvence").
- `phi-3.5-mini` küçük ve yerel bir model olduğu için bulut modellerine göre hem daha yavaş hem
  bazen daha dağınık cevaplar verebiliyor — bu, gizlilik karşılığında kabul edilen bir ödünleşim.

## Ne öğrendim

- RAG'in retrieval (kaynak bulma) ve generation (cevap üretme) adımlarının birbirinden ayrı,
  test edilebilir parçalar olduğunu — retrieval'ı LLM'siz de test edip doğrulayabildim.
- TF-IDF gibi basit bir yöntemin bile işe yaradığını, ama "şifre" sorup belgede "parola" yazınca
  hiç sonuç bulamadığını görünce eş anlamlı kelime probleminin ne kadar gerçek olduğunu anladım.
- Retrieval'ı LLM'siz test edince asıl sorunun Türkçe ekler olduğunu gördüm: model kötü cevap
  veriyor sanırken, aslında doğru paragraf ona hiç gönderilmiyormuş. "Modelin hatası" sandığım
  şeyin bir adım öncesinde, arama katmanında olduğunu ölçerek bulmak bu projedeki en öğretici andı.
- Küçük, yerel bir modelin (phi-3.5-mini, ~2.5GB) CPU'da çalışabildiğini ama bulut modellerine göre
  hem daha yavaş hem bazen daha "dağınık" cevaplar verdiğini — bu, gizlilik/hız arasındaki gerçek
  bir mühendislik ödünleşimi.
- Foundry Local'ın OpenAI-uyumlu bir API sunduğunu, yani `/v1/chat/completions` gibi standart bir
  formatla konuştuğunu — ileride başka bir yerel/bulut modele geçmek istersem kod neredeyse
  değişmeden kalır.

## Lisans

MIT — `data/` klasöründeki belgeler eğitim amaçlı, sadeleştirilmiş özetlerdir; resmi kanun/standart
metinlerinin yerine geçmez.

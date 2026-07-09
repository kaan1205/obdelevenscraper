# OBDeleven Customizations Scraper

Kullanıcının Make → Model → Year seçtiği bir form üzerinden, obdeleven.com'daki
customization başlıklarını çekip (Playwright ile), önbelleğe alıp, çevirip
listeleyen küçük bir Node.js + Express uygulaması.

## Kurulum

```bash
npm install
npx playwright install chromium
```

## 1) Araç listesini keşfet (bir kere, sonra periyodik olarak)

```bash
npm run discover
```

Bu script `obdeleven.com/customizations` sayfasına gidip Make/Model/Year
`<select>`'lerini teker teker dolaşır ve sonucu `data/vehicles.json`'a yazar.
İlk çalıştırmadan önce repoda duran `data/vehicles.json` sadece örnek/placeholder
veridir — gerçek veriyi almak için bu script'i **siteye ağ erişimi olan bir
ortamda** çalıştırman gerekiyor (bu sandbox'ın obdeleven.com'a erişimi
politika gereği kapalı, o yüzden selector'ları canlı DOM üzerinde doğrulayamadım).

Faydalı env değişkenleri:

- `HEADLESS=false` → tarayıcıyı görerek çalıştır, selector'ları doğrula
- `ONLY=volkswagen,audi` → sadece belirli markaları yeniden tara
- `DISCOVER_DELAY_MS=1200` → adımlar arası bekleme (nezaket için)

Eğer script "Expected 3 <select> elements..." gibi bir hata verirse veya
0 model/yıl buluyorsa, `src/scraper/selectors.js` içindeki `select.*.labelKeywords`
değerlerini gerçek DOM'a göre güncelle.

## 2) Sunucuyu başlat

```bash
npm start
```

`http://localhost:3000` adresinde form açılır. Make → Model → Year seçilip
"Devam Et"e basınca `GET /api/customizations` çağrılır.

## Nasıl çalışıyor

- `GET /api/vehicles` → `data/vehicles.json`'ı olduğu gibi döner (cascading select verisi).
- `GET /api/customizations?make=&model=&year=` :
  1. Önce `data/cache/customizations/` altındaki dosya cache'ine bakar (varsayılan TTL: 1 hafta, `CACHE_TTL_HOURS` ile ayarlanabilir).
  2. Cache yoksa Playwright ile `https://obdeleven.com/customizations/{make}/{model}/{year}` sayfasına gidip tüm sayfaları gezer (`src/scraper/scrapeCustomizations.js`), başlıkları tekilleştirir ve cache'e yazar.
  3. Başlıkları `data/translations.json` sözlüğünden çevirir; sözlükte olmayan başlıklar İngilizce olarak döner.

## Çeviri (translations.json)

Şu an statik bir sözlük (`data/translations.json`) kullanılıyor:
`{ "İngilizce başlık": "Türkçe çeviri" }`. Sözlükte olmayan başlıklar
olduğu gibi (İngilizce) gösteriliyor. Bir DeepL/Google Translate API key'in
olduğunda `src/lib/translate.js` içindeki `translate()` fonksiyonuna API
çağrısını ekleyip sonucu `translations.json`'a yazarak cache'lemen yeterli
(dosyanın üstünde nereye ekleneceğini belirten bir `TODO` yorumu var).

## Selector kırılganlığı hakkında not

`src/scraper/selectors.js` dosyasındaki değerler (`.chakra-button`,
`.chakra-text.css-1cuhfda` vb.) proje planındaki ipuçlarına dayanıyor ama bu
ortamdan obdeleven.com'a erişim engellendiği için canlı DOM'da doğrulanamadı.
`HEADLESS=false npm run discover` ile ilk çalıştırmada tarayıcıyı izleyip,
gerekirse bu dosyadaki selector'ları güncellemen gerekecek.

## Klasör yapısı

```
scripts/discover-vehicles.js   Make/Model/Year keşif script'i
src/scraper/selectors.js       Tüm CSS selector'lar tek yerde
src/scraper/scrapeCustomizations.js  Sayfalama + başlık toplama
src/lib/slugify.js             Label -> URL slug
src/lib/cache.js               Dosya tabanlı scrape cache'i
src/lib/translate.js           translations.json okuma/çeviri
src/routes/vehicles.js         GET /api/vehicles
src/routes/customizations.js   GET /api/customizations
src/server.js                  Express giriş noktası
public/                        Cascading select formu + sonuç listesi
data/vehicles.json             Discovery script'in çıktısı (placeholder ile geliyor)
data/translations.json         Statik çeviri sözlüğü
data/cache/customizations/     Scrape sonuçlarının dosya cache'i
```

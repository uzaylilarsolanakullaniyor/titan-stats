https://uzaylilarsolanakullaniyor.github.io/titan-stats/

# Titan PreStocks · Hacim Analizi

PreStocks kampanyasındaki tüm tokenlerin işlem hacimlerini ve toplamını gösteren
animasyonlu, liquid-glass tasarımlı analiz sayfası.

## Dosyalar

| Dosya | Görev |
|-------|-------|
| `index.html` | Sayfanın kendisi. Tek başına çalışır (veri gömülü yedek içerir). |
| `data.json` | Güncel hacim verisi. Sayfa açılırken bunu çeker. |
| `build_data.py` | titan.exchange'den veriyi çekip `data.json` üretir. |
| `.github/workflows/update-data.yml` | `data.json`'ı otomatik (saatlik) günceller. |
| `server.py` | (Opsiyonel) yerel test için mini sunucu. Pages'te gerekmez. |

## GitHub Pages'e yükleme

1. Bu klasörü bir GitHub reposuna gönder.
2. **Settings → Pages → Branch: `main` / root → Save**.
3. `https://<kullanıcı>.github.io/<repo>/` adresinden açılır.

## Otomatik güncelleme nasıl çalışır?

titan.exchange API'si yalnızca kendi sitesinden (`Origin: titan.exchange`) gelen
isteklere izin verdiği için tarayıcı **doğrudan** veri çekemez. Bu yüzden:

- **GitHub Actions** her 15 dakikada bir GitHub'ın sunucusunda çalışır (senin Mac'in kapalı olsa bile),
  `build_data.py` ile API'den güncel veriyi çeker ve `data.json`'ı günceller.
- Titan yeni bir tek-token ödül kampanyası yayınladığında duyuru/token bilgisi otomatik keşfedilir;
  slug doğrulanır; kampanya sekmesi, epoch'ları, ödül havuzu, başlangıç ve bitiş zamanı
  `data.json`'a eklenir.
- Daha önce keşfedilmiş kampanyalar duyuru süresi sona erse de sonraki güncellemelerde korunur.
- GitHub Pages değişikliği otomatik yeniden yayınlar.
- Sayfa açılırken `data.json`'ı çeker; bulamazsa `index.html` içine gömülü
  yedek veriyle yine de çalışır.
- Açık sayfa veriyi dakikada bir otomatik kontrol eder. Hızlı statik veri hemen gösterilir;
  Vercel canlı kaynağı önbellekten arka planda tazelenir ve gecikirse mevcut sağlam veri korunur.
- Başlangıç/bitiş bilgisi bulunan kampanyalarda seçili kampanya veya epoch'un kendi tarih aralığı
  ve canlı geri sayımı otomatik görünür.
- Kampanya sekmeleri `Yakında`, `Aktif`, `Son 24s` ve `Bitti` durumlarını otomatik gösterir.
- Birden fazla Titan kullanıcı adı/cüzdanı tarayıcıda saklanıp aynı tabloda karşılaştırılabilir.
- Tek-token kampanyalarında epoch bazlı ödül/maliyet/net dökümü ve hedef ödül hesaplayıcısı bulunur.
  Hedef ödül ile swap başına USD hacmi girildiğinde gereken ek hacim ve swap sayısı hesaplanır.
- Tarayıcı bildirimi açılırsa sayfa yeni kampanya başlangıçlarını, epoch bitişlerini ve kampanya
  bitişlerini bildirir. Bildirim kontrolü sayfa açıkken ve sonraki açılışta çalışır.
- Veri sağlık göstergesi güncellik yaşını ve engellenen eksik API yanıtlarını gösterir.

> Güncelleme sıklığını değiştirmek için `update-data.yml` içindeki `cron` satırını düzenle.
> Örn. yarım saatte bir: `*/30 * * * *`. (GitHub cron'u yoğun zamanlarda birkaç dk gecikebilir.)
>
> Actions'ın repoya yazabilmesi için: **Settings → Actions → General → Workflow permissions →
> "Read and write permissions"** seçili olmalı.

## Veri hakkında not

API her token için en fazla **ilk 100 işlemciyi** döndürür (sayfalama yok).
Gösterilen hacim, bu ilk 100 işlemcinin toplamıdır — gerçek toplamın büyük
kısmını kapsar ancak teknik olarak bir alt sınırdır. Bir token'da işlemci
sayısı 100'ün altındaysa o değer tam toplamdır.

## Yerel test (opsiyonel)

```bash
python3 build_data.py   # data.json'ı tazele
python3 server.py       # http://localhost:8000
```

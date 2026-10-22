# Deney protokolü

## Araştırma sorusu

Hazırlama önceliklerini ve ortak konveyör katılım sırasını birlikte seçmek,
yalnızca FIFO, açıklanabilir sipariş kuralı veya konveyör sırasını seçmeye kıyasla
siparişin gelişinden paketleme bitişine kadar geçen süreyi azaltıyor mu?
Ana ölçü sipariş akış süresidir. Sevkiyat sonrası taşıma ölçülmez.

## Karşılaştırılan yöntemler

| Yöntem | Hazırlama | Konveyör |
|---|---|---|
| fifo | Geliş zamanı, görev ID | Aynı FIFO |
| order_aware | Son eksik bileşen; ardından yaş, eksik sayısı, ID | Aynı kural |
| gwo_conveyor | FIFO sabit | GWO |
| local_search | Takas komşulukları | Takas komşulukları |
| gwo_integrated | GWO rastgele anahtarlar | GWO rastgele anahtarlar |

Robot seçimi ve fizik bütün yöntemlerde aynıdır. Yerel tampon, bütün sipariş
birleştirme rezervasyonu, paketleme kapasitesi, taşıyıcı uzunluğu ve takip mesafesi
parametreleri politika bazında değiştirilmez.

## Sabit değerlendirme

1. Önce tek sipariş, eşzamanlı birleşme, kapasite, eksik bileşen ve kesinti testlerini
   çalıştırın. Sonra 2 dış tohumla küçük doğrulama deneyini çalıştırın.
2. En az 30 dış tohum kullanın. Aynı dış tohumda yöntemler aynı sipariş, kesinti ve
   ürün başına toplama süresini görür. Algoritma tohumu ayrıca kaydedilir.
3. Yöntemlerin arama bütçesi aynı aday değerlendirmesi sayısıdır. Referans kurallar
   arama yapmaz. Hesaplama süresi ve gerçekleşen değerlendirme sayısı birlikte raporlanır.
4. Her karar anında bütün adaylar aynı açık sipariş kohortuyla değerlendirilir.
   Gelecek siparişler/kesintiler ve gerçekleşmemiş gerçek toplama süreleri görülmez.
5. Adayın ortak, sabit değerlendirme ufku görev sayısı ve fiziksel sürelerden
   hesaplanır, 120–7200 s aralığına sınırlanır. Açık kalan her sipariş için
   `değerlendirme_bitişi - geliş + ufuk` maliyeti kullanılır. Zor siparişler çıkarılmaz.
6. Son simülasyon senaryo ufkunda veya tüm siparişler tamamlandığında durur. Açık
   siparişler ve henüz gelmemiş siparişler ayrıca raporlanır. Ufku artırma kararı
   bütün yöntemler için önceden aynı şekilde verilmelidir.

Önerilen ana komut:

```bash
apps/api/.venv/bin/python -m apps.runner batch --scenario all --policy all \
  --seed 100 --seeds 30 --algorithm-seed 7 --budget 24
```

Bu 1.200 koşudur. Önce `--scenario balanced --seeds 2 --budget 6` ile maliyeti
ölçün. Algoritma duyarlılığı için aynı 30 dış tohumu farklı algoritma tohumlarıyla
ayrı partilerde tekrarlayın; bu tekrarlar yeni bağımsız dış senaryo sayılmaz.

`--time-limit-ms` canlı çalışmada kullanılabilir, fakat aday bitişinde kontrol edilir;
sert bir zaman garantisi yoktur. Süre sınırlı sonuçları sabit bütçeli deneylerle
aynı etiket altında birleştirmeyin. Arama kaynaklı duvar gecikmesi simülasyon
işlem sürelerine eklenmez; `compute_ms` olarak ayrıca raporlanır.

## Çıktılar ve analiz

Her koşuda çözülmüş senaryo, fizik parametreleri, tohumlar, git commit/dirty bilgisi,
çekirdek kaynak SHA-256 özeti, Python sürümü, ürün/sipariş sonuçları ve bütün
operasyon/karar olayları yazılır. `summary.csv` her koşudan sonra güncellenir;
kesilen bir parti bitmiş koşularını kaybetmez. Web ZIP'leri ayrıca `commands.jsonl`
içerir; elle kesinti veya yeni sipariş verilen çalışmaları ana kontrollü partiden
ayrı değerlendirin.

Ölçümler:

- Tamamlanmış siparişlerin ortalama ve nearest-rank %95 akış süresi.
- Tamamlanan/açık/henüz gelmemiş sayıları; açık kimlikler, açık sipariş yaşı,
  hedefi aşmış açık sipariş sayısı.
- Tamamlananlar içindeki gecikme oranı (boş kümede null).
- Adım boyunca örneklenen görev/paketleme kuyrukları ve yerel/birleştirme doluluğu;
  maksimum yerel ayrılmış yuva ve birleştirme rezervasyonu.
- İleri zamanlı rezervasyon revizyonları ve gerçekten kaçırılan girişler ayrı.
- Ortalama/%95 duvar karar süresi ve gerçek aday değerlendirme sayısı.

`experiments/analyze.py` FIFO'ya göre eşleştirilmiş dış tohum farklarını ve 2.000
bootstrap örneklemli aralığı verir. Yalnızca iki tarafın da tüm siparişleri
bitirdiği çiftlerde tamamlanma farkı hesaplar; dışlanan eksik çift sayısını ve
bütün açık siparişleri açıkça raporlar. Eksik koşular varken bu koşullu farkla
başarı sıralaması yapmayın. Önce tamamlanma oranı ve açık iş yükünü karşılaştırın.
30 dış tohum belirsizlik değerlendirmesi için başlangıçtır; optimum veya genel
üstünlük iddiası için yeterli gerekçe sayılmaz.

## Tekrarlanabilirlik

Sabit tohum/bütçede olay ve sipariş sonuçları aynıdır; `compute_ms`, sürüm bilgisi
ve koşu dizininin duvar tarihini bit düzeyinde eşitlik karşılaştırmasına katmayın.
Bir kaydı yeniden çalıştırmak için `run.json` dosyasını `--scenario` olarak verin,
kaydedilmiş dış/algoritma tohumu, politika ve bütçeyi aynı seçin. Web komutlarının
tekrarı ayrıca aynı simülasyon zamanlarında uygulanmalıdır; CLI kendiliğinden web
komut günlüğünü replay etmez.

## Başlangıç uygulamaları ve sınırlar

Bu sürüm küçük bütçeli, rolling-horizon sezgisel aramalar sunar. GWO global
incumbent'ı korur fakat optimalite garantisi yoktur. Süre tahmini fiziksel/geçmiş
ortalama; ML yoktur. Taşıyıcılar eşit boydadır; bant tek yön ve ortak sabit hızdadır.
Bölgeler arası robot paylaşımı, yol trafik optimizasyonu, değişken paket hacmi ve
öğrenilmiş tahmin modelleri sonraki araştırmalara açık arayüzlerle ayrılmıştır.

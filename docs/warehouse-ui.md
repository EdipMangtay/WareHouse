# Mevcut büyük deponun operasyon arayüzü

Giriş: `http://127.0.0.1:5173/#warehouse`. Bu çalışma, mevcut WarehouseApp ve
Scene3D üzerinde yapılır. LARGE yerleşimindeki 180 × 120 m tesis, 247 raf,
48 robot, dış çevre konveyörü, istasyonlar, yürüyüş ve robot kameraları korunur.
Yeni depo geometrisi veya alternatif operasyon motoru kullanılmaz. Bölge ve
istasyon sayıları seçilmiş yerleşimden okunur. `#research` ayrı deney modelidir;
büyük deponun siparişleri veya ölçümleriyle birleştirilmez.

## Kullanım

- Üst çubuk: motorun simülasyon zamanı, duraklat/devam, hız ve sıfırlama.
  Duraklatılmışken hız seçmek simülasyonu başlatmaz. Ev simgesi genel görünüme döner.
- Sol panel: bölgeler, robotlar, arama/durum filtreli müşteri siparişleri ve kaynaklar.
  Panel daraltılabilir. Gösterilen siparişler admin servisinin son 250 kaydıdır;
  listede en fazla 80 eşleşme çizilir. Arama tüm alınan kayıtları tarar.
- Sağ panel: sahne veya listede seçilmiş robot, bölge, raf, istasyon, konveyör,
  taşıyıcı ya da müşteri siparişinin gerçek bilgileri. Odaklan, robotu takip et ve
  robotun gözünden bak kontrolleri mevcut kameralara bağlıdır.
- Bir sipariş seçildiğinde ilgili raflar, bölgeler, aktif robotlar ve taşıyıcılar
  vurgulanır. Üç bileşen ulaşmış, biri yoldaysa tek sipariş altında `1 / 4`
  beklenen bileşen gösterilir. Paketleme ve çıkışa taşıma ayrı aşamalardır.
- Katmanlar: raf görünürlüğü, aktarım/paketleme etiketleri ve gerçek konveyör takip
  adımı. Raf gizleme fiziksel engelleri kaldırmaz. Ayrıntılı etiketler yakınlık
  veya seçimle görünür. Mavi ürün taşıyıcısı, karton rengi paketleme sonrası çıkış
  yükü, açık turkuaz seçilmiş/ilişkili nesnedir.
- Alt olay kaydı varsayılan kapalıdır. Sipariş, robot ve olay türü filtreleri;
  ilgili nesneye odaklanma; gerçek aday puanlarını gösteren Decision Inspector
  ve mevcut konveyör/arıza/What-if araçları burada bulunur. Son 500 motor olayının
  en fazla 120 eşleşmesi çizilir; eski kayıtların hepsi burada bulunmaz.
- Geliştirici sekmesinde ölçülen FPS, çizim çağrıları, üçgenler ve motor adımı
  bulunur. Bunlar operasyonel başarı ölçüsü değildir.

## Dosyalar ve veri sahipliği

| Sorumluluk | Dosya / klasör |
|---|---|
| Ekran yerleşimi ve mevcut çekmeceler | `apps/web/src/WarehouseApp.tsx` |
| Ortak UI renkleri, ölçüler, duyarlı yerleşim | `apps/web/src/warehouse-workbench.css` |
| Kontroller, KPI, sol liste, sağ ayrıntı, olaylar | `apps/web/src/components/warehouse/` |
| Sipariş/taşıyıcı/istasyon salt okuma eşlemeleri | `components/warehouse/operations.ts` |
| Sipariş servisinin periyodik okunması | `apps/web/src/services/warehouseOperations.ts` |
| Sipariş yanıtı ve yerel görünüm tercihleri | `apps/web/src/state/warehouseOperations.ts` |
| Ortak sahne/liste seçimi, motor snapshot kopyası | `apps/web/src/state/store.ts` |
| Otoriter FULL/PATCH akışı ve yeniden bağlantı | `apps/web/src/services/ws.ts` |
| Kullanıcı komutlarının iletimi | `apps/web/src/simulation/runner.ts` |
| Mevcut depo ve kamera çerçevesi | `components/scene/Scene3D.tsx`, `components/views/Viewport.tsx` |
| Gerçek istasyon içerikleri ve operasyon etiketleri | `components/scene/OperationalOverlay.tsx`, `ResourceLabel.tsx` |
| Taşıyıcı görselleri / ortak renk anlamları | `components/scene/ConveyorParcels.tsx`, `parcelPresentation.ts` |
| Kamera ve yürüme kontrolleri | `components/views/CameraConsole.tsx`, `components/scene/WalkController.tsx` |

Kısaltılmış bileşen yolları `apps/web/src/` altındadır. Mevcut prosedürel raflar,
robot modelleri, malzemeler ve dokular yeniden kullanılır. İstasyonlarda sabit
süs paketleri yerine `unloading_points.items` kayıtları çizilir. Çekirdek istasyon
içi kesin paket koordinatı vermediğinden bu dizilim şematiktir; yeni yol veya
fiziksel kapasite modeli oluşturmaz. Tekrarlanan raf ve taşıyıcılarda mevcut
instancing korunur; istasyon içerikleri ve takip aralıkları da instancing kullanır.

`TwinState` tek operasyon kaynağının tarayıcıdaki kopyasıdır. `/ws` motor verisini,
`GET /api/commerce/admin` müşteri siparişlerini ve gerçek sipariş ölçümlerini verir.
Sipariş servisi 1,2 saniye arayla okunur; tek istek için 8 saniye zaman aşımı vardır.
İki akış arasında bu kadar gecikme olabilir. Arayüz, zamanı dolduğu için kendi
kendine görev/sipariş tamamlamaz; durumları backend değiştirir. Komut hataları
bildirimde, bağlantı/istek hataları kalıcı uyarıda gösterilir. Çevrimdışıyken eski
veri açıkça işaretlenir, komutlar kapanır; bağlantı döndüğünde FULL yeniden alınır.

## Birimler ve mevcut motorun sınırları

- Motor zamanı: `tick × tick_ms / 1000`, saniye. Üstteki saat aynı simülasyonun
  mevcut 08:00 başlangıç gösterimidir. 10× oynatma, tamamlanma süresini 10'a bölmez.
- KPI ortalaması: commerce veritabanındaki sevkiyata hazır siparişlerin gelişten
  çıkış alanına ulaşmasına kadar **gerçekleşmiş simülasyon süresi**. Paketleme
  bitişiyle aynı ölçü değildir. Henüz tamamlanmış sipariş yoksa `—` gösterilir.
- Giriş kapasitesi eşzamanlı aktarılan taşıyıcı sayısıdır. Giriş kuyruğu bu
  kapasiteye bölünmez; kuyruk üst sınırı olarak sunulmaz. Bu motorda ayrı,
  sınırlı yerel tampon alanı/kapasitesi snapshot ile sağlanmaz.
- İstasyonun fiziksel doluluğu taşıyıcı sayısıdır. Siparişin ayrılan kapasitesi
  ürün birimidir (mevcut toplama modelinde her ürün için bir taşıyıcı).
- Mevcut hedef kabul rezervasyonları gösterilir. Gelecek zamanlı birleşme slotu
  veya hazırlama rezervasyonu bu motorda bulunmaz; hayali slot çizilmez.
- Konveyör takip katmanı `pitch_m` değerini gösterir; bağımsız güvenlik sertifikası
  veya yeniden hesaplanmış geçiş izni değildir.
- Legacy SIM_CONTROL tek adım desteklemez. Bu ekrana adım düğmesi eklenmedi.
- Karar görünümü motorun `recent_decisions` kayıtlarıdır. Adayların hesaplanmamış
  tamamlanma etkileri, yeni GWO veya ML tahmini üretilmez.
- Genel sipariş ETA'sı gösterilmez. Taşıyıcı serbest akış tahmini mevcut kaynaktan
  gelir ve kuyruk/istasyon beklemesini içermediği açıkça yazılır.
- Admin yanıtı son 250 siparişle sınırlıdır. İstasyon/sipariş ayrıntıları da bu
  pencereye tabidir; büyük deneyler için sayfalı/aktif sipariş uçları ayrı iştir.
- Mevcut motorun uzun koşularda sıkışma, batarya veya arıza davranışı değiştirilmedi.
  Arayüz bu durumları gösterir; yeni bir koordinasyon algoritmasıyla düzeltmez.

## Çalıştırma ve doğrulama

Proje kökünde:

```bash
bash start.sh large
npm run build
npm run test:web
apps/api/.venv/bin/python -m pytest apps/api/tests/test_commerce.py apps/api/tests/test_conveyor.py -q
```

`npm run build` TypeScript kontrolünü de çalıştırır. Odaklı UI veri/bağlantı testi:

```bash
npm --prefix apps/web test -- tests/warehouse-operations.test.ts tests/stream.test.ts tests/experience.test.ts
```

Bu testler eksik bileşeni tamamlanmış saymama, gerçek paketleme durumunu koruma,
teslim edilmiş taşıyıcıya eski robot arızasını bağlamama, aynı sipariş kimliği,
mevcut yerleşime kamera odağı, katmanların motor durumunu değiştirmemesi,
snapshot birleştirme ve bağlantı yaşam döngüsünü doğrular.

Tarayıcı doğrulama kaydı: [warehouse-ui doğrulaması](../validation/warehouse-ui.md).

# Phase 2 — Premium 3D Warehouse Experience

10 Ekim 2026. Phase 1'deki depo, mevcut React Three Fiber / Three.js sahnesi, Zustand durumu ve WebSocket motoru üzerinde genişletildi. Ayrı uygulama veya yeni simülasyon motoru oluşturulmadı.

## Uygulanan özellikler

### Kamera

- Sinematik genel bakış: tesisi çerçeveleyen yumuşak geçiş ve yavaş otomatik yörünge. Kullanıcı etkileşimi serbest kameraya geçer. Azaltılmış hareket tercihinde otomatik dönme kapalıdır.
- Taktik üst görünüm: ortografik kamera; döndürme kilitli, kaydırma ve yakınlaştırma kullanılabilir.
- İzometrik görünüm: eşit eksen açılı ortografik kamera; perspektif küçülmesi olmadan tesis incelemesi.
- Serbest yörünge, robot takibi ve robotun gözünden görünüm.
- Nesnenin gerçek sınırlarına ve ekran oranına göre odaklama. Raf veya istasyon arama sonucu seçildiğinde kamera nesneyi çerçeveler.
- Takipte motor pozisyonlarının ve dönüş açısının yumuşatılması; mevcut çarpışma mesafesi sınırlamasının korunması. Kat/asansör yüksekliği hesaba katılır.

### Etkileşim

Robotlar, raflar, istasyonlar ve bölgeler sahneden seçilir. Hover durumunda raf/istasyon kenarları ve robot halkaları vurgulanır. Seçim tek bir ortak durum üzerinden yönetilir; farklı nesneye geçince robot takibi bırakılır. Statik seçim hacimleri fiziksel modeli değiştirmez ve instanced mesh ile çizilir.

Arama robot kimliklerini, raf kimliklerini, raf erişim adreslerini (örneğin SHELF-A01), istasyonları, bölgeleri ve diğer layout konumlarını bulur. Tam eşleşme üstte gösterilir; sonuç sayısı 12 ile sınırlandırılır. Enter ilk sonucu açar; aşağı ok sonuçlara klavye odağı taşır. Olmayan bir kimlik için açık hata metni gösterilir.

Nesne paneli tam ekran kapsayıcısının içindedir. Robot bataryası, hızı, yükü, durumu, mevcut görevi ve hedefi canlı TwinState'ten; bölge durumu, robot sayısı ve yoğunluğu motorun bölge durumundan gelir. Raf ölçüleri/erişim adresleri ortak layout'tan, ilişkili aktif görev sayısı motorun görevlerinden türetilir. Stok adedi veya istasyon meşguliyet durumu uydurulmaz. Bağlantı kaynağı canlı backend / yerel motor / bağlanıyor olarak belirtilir.

### Katmanlar

3D görünümünde Katmanlar menüsü:

1. Robot rotaları: motorun mevcut yolları.
2. Robot durumları: gerçek durum renklerini taşıyan halkalar ve uyarılar.
3. Gezilebilir koridorlar: ortak navigasyon ızgarasının açık hücreleri; yatay şeritler birleştirilerek instanced çizim.
4. Depolama bölgeleri: bölge sınırları, durum işaretleri ve ilgili etiketler.
5. İstasyon noktaları: gerçek istasyon ve konum işaretleri.
6. Engel sınırları: navigasyon ızgarasındaki bloke hücrelerin dış kenarları, güvenlik payı dahil.
7. Rota yönleri: mevcut robot yolundaki ilerleme yönlerinden türetilen oklar; sabit veya zorunlu tek yönlü yol kuralı değildir.
8. Metre ızgarası: ortak cell_size üzerinden çizilir.
9. Endüstriyel etiketler.

Koridor ve engel katmanları statik yerleşimi temsil eder; anlık yaya engellerini, robot rezervasyonlarını veya tüm dinamik yasakları temsil ettiği iddia edilmez. Legacy çok katlı görünümde navigasyon katmanı seçili sayısal katı kullanır; Tüm katlar / Katları ayır görünümünde zemin kat navigasyonu gösterilir. Yeni Large tek katlıdır.

### Görsel ve performans

Aşırı parlaklığı azaltan ışık/pozlama ayarı, okunabilir bilgi paneli, tutarlı seçim renkleri ve sahnenin fiziksel ayrıntıları korundu. Küçük ekran etiketleri küçültüldü; bilgi paneli dar pencerede alta alınarak yükseklik sınırı ve kaydırma eklendi. Kalite seçenekleri, gölge çözünürlüğü sınırları, uzak raf/robot LOD ve instancing korunuyor.

Statik seçilebilir nesneler tek paylaşılan kutu geometrisi kullanır. Izgara ve engel çizgileri birleştirilmiş BufferGeometry ile çizilir; her hücreye ayrı mesh oluşturulmaz. Rota yönleri yalnızca motor verisi değişince üretilir. Kullanılmayan geometri temizlenir. Hover aynı nesnede kaldığında Zustand'a yeni durum yazılmaz. Katman ve seçim ayarları simülasyon durumunu değiştirmez.

## Değişen dosyalar

Yeni:
- `frontend/src/components/scene/experience.ts`: nesne indeksleme, arama, kamera/katman tipleri ve sınır kutusuna göre çerçeveleme.
- `frontend/src/components/scene/InteractionLayers.tsx`: instanced seçim hacimleri, hover/seçim çizgileri, navigasyon ve trafik katmanları.
- `frontend/src/components/views/ExperienceControls.tsx`: arama, katman menüsü ve gerçek veriye bağlı nesne paneli.
- `frontend/tests/experience.test.ts`: kamera sınırları, arama, seçim ve katman regresyonları.

Güncellenen:
- `frontend/src/state/store.ts`: ortak nesne seçimi, hover, katmanlar, kamera presetleri, odak sınırları.
- `frontend/src/components/scene/Scene3D.tsx`: kamera sistemi, ortografik görünümler, geçişler, ışık ve yeni sahne katmanları.
- `frontend/src/components/scene/Robots.tsx`: hover vurgusu ve robot durum katmanı.
- `frontend/src/components/scene/ZoneOverlay.tsx`: bölge seçimi ve katman görünürlüğü.
- `frontend/src/components/scene/IndustrialDetails.tsx`: bölge tabelalarının katmanla eşleşmesi ve bakım etiketi.
- `frontend/src/components/scene/Fixtures.tsx`: kalite kontrol / bakım etiketlerinin doğru türden gösterilmesi.
- `frontend/src/components/views/Viewport.tsx`: yeni kamera seçenekleri, arama, katman menüsü, tam ekran nesne paneli.
- `frontend/src/WarehouseApp.tsx`: yeni kamera modlarıyla mevcut operasyon panelinin uyumu.
- `frontend/src/warehouse-console.css`: komut satırı, panel, katman menüsü ve dar ekran düzeni.

Backend, sipariş akışı ve fiziksel yerleşim algoritması bu aşamada değiştirilmedi. `active_layout.json`, başlangıç betiği tarafından Large seçimi için yeniden yazıldı.

## Doğrulama

- Backend: **79 test geçti**, 118,87 saniye (`validation/phase2-backend-tests.txt`).
- Frontend: **50 test geçti**, 6 test dosyası (`validation/phase2-frontend-tests.txt`). Önceki 40 test korunur; yeni 10 test kamera köşelerinin dar/geniş oranlarda kadraja sığmasını, raf erişim adresi aramasını, seçim tutarlılığını ve katmanların motor verisini değiştirmemesini kapsar.
- TypeScript kontrolü ve Vite üretim derlemesi başarılı (`validation/phase2-build.txt`). Depo parçasının 500 kB üzerindeki paket boyutu uyarısı devam eder.
- Large uygulama backend ve frontend birlikte başlatıldı. Canlı motor bağlantısı, değişen robot görev/hız bilgileri ve tick ilerlemesi arayüzde gözlendi.
- SHELF-A01 araması RACK-A001'i buldu ve kamera rafı çerçeveledi.
- Sahnede doğrudan tıklamayla RACK-A012 ve SORT-01 seçildi; bilgi paneli eşleşti.
- A bölgesinin gerçek motor durumu / yoğunluğu panelde okundu.
- Taktik ve izometrik görüntüler gerçek renderer'da incelendi. Koridor, engel, grid, istasyon ve yön katmanlarının birlikte açılması denendi.
- Tam ekran açıldı; panel ve kontroller tam ekranda kullanılabildi.
- Robot takibi ve birinci şahıs görünümü incelendi. Duraklat / devam ettir kontrolü çalıştı.
- Test öncesindeki durmuş Vite sunucusuna ait eski bağlantı/modül hataları loglarda vardı; çalışan sürüm incelemesinde yeni React/WebGL hata kaydı gözlenmedi.

### Gözlenen performans

Bu Mac, Codex tarayıcısı, Large / Dengeli kalite. Bunlar kısa süreli canlı sayaç örnekleridir; ortalama, p95 veya donanımdan bağımsız garanti değildir. Doğrulama sırasında test süreçleri de çalışıyordu.

| Görünüm | Ekran | FPS örneği | Çizim | Üçgen |
|---|---|---:|---:|---:|
| İzometrik, katmanlar açık | 1728 × 1084 | 115 | 823 | 177 bin |
| Taktik üst | 1728 × 1084 | 119 | 825 | 177 bin |
| Birinci şahıs, canlı robot | 1728 × 1084 | 107 | 1453 | 424 bin |
| Yakın raf odaklama | 1728 × 1084 | 119 | 284 | 116 bin |

Ekran görüntüleri: `validation/phase2-isometric.png`, `phase2-first-person.png`, `phase2-robot-follow.png`. Son dosya dar ekran panel iyileştirmesinden önceki kontrolü gösterir.

## Açık doğrulama sınırı

Ek, izole bir tarayıcı doğrulama sekmesi açma isteği otomatik onay incelemesinde kullanım limiti nedeniyle engellendi. Bu nedenle son dar ekran panel düzeni ve sinematik otomatik dönüşün son düzeltmesi için ek görsel tur tamamlanamadı. Bu değişiklikler TypeScript / üretim derlemesinden geçti; sinematik mod seçimi daha önce arayüzde denendi. Ek görsel turun tamamlandığı iddia edilmez. Blokajı aşmak için başka tarayıcı aracı kullanılmadı.

Ortoğrafik/perspektif projeksiyon değişimi ayrı kamera değişimidir; konum/hedef yumuşatılır, projeksiyonlar matematiksel olarak birbirine morph edilmez. Yoğun raf içlerinde serbest kameranın her uçuş güzergâhı için çarpışmasız planlama yapılmaz; takip kamerasının mevcut çarpışma sınırı korunur. Mega için bu aşamada yeni FPS ölçümü yapılmadı. Mantıksal stok slotları ayrıntılı envanter doluluğu değildir; Phase 1 sınırları geçerlidir.

Şehir, drone, yeni rota optimizasyonu veya sonraki aşama başlatılmadı.

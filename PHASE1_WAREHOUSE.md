# Phase 1 — Endüstriyel depo genişletmesi

9 Ekim 2026. Mevcut React / React Three Fiber / Three.js, FastAPI ve WareTwin motoru üzerinde uygulandı. Yeni proje kurulmadı; mağaza, sipariş, takip, admin, WebSocket ve mevcut robot görev akışı korunuyor. Masaüstündeki orijinal kaynak değiştirilmedi.

## Yerleşim ve kapasite

| Preset | Boyut (m) | Alan (m²) | Raf | Mantıksal adres | Robot | Paketleme / ayrıştırma |
|---|---:|---:|---:|---:|---:|---:|
| Small | 80 × 60 | 4.800 | 32 | 1.280 | 12 | 2 / 2 |
| Medium | 120 × 80 | 9.600 | 84 | 3.360 | 20 | 3 / 3 |
| Large | 180 × 120 | 21.600 | 280 | 11.200 | 32 | 5 / 5 |
| Mega | 240 × 160 | 38.400 | 560 | 22.400 | 48 | 7 / 7 |

Yeni presetler tek katlıdır. Tesis yüksekliği 14 m; raflar 4 × 2 × 8 m, beş seviye, dört göz ve iki yüz içerir. Her rafın 40 benzersiz depolama adresi bulunur. Ana koridor 8 m, ikincil koridorlar en az 4 m. Dünya koordinatları metre, navigasyon hücresi 1 m'dir.

- A: iki giriş rampası, kabul alanı, kalite kontrol / barkod çalışma noktası.
- B: yüksek yoğunluklu raf blokları ve adreslenmiş stok alanı.
- C: raf erişim noktaları, robot toplama koridorları ve alternatif geçişler.
- D: ayrıştırma / konsolidasyon istasyonları ve malzeme akışı.
- E: paketleme istasyonları, yaklaşım alanları ve mevcut kapasiteli paketleme kuyruğu.
- F: iki çıkış rampası, sevkiyat hazırlık ve yükleme noktaları.
- G: şarj noktaları, robot park yerleri ve bakım istasyonu.

## Ortak mimari

`backend/app/layout_generator.py` merkezi `LayoutConfig` üzerinden deterministik yerleşim üretir. Raf sayısı boyut, raf ölçüsü ve koridor aralıklarından türetilir. İstasyon, rampa, şarj, kolon, duvar ve robot başlangıçları aynı koordinat sistemiyle oluşturulur. Çıktılar `shared/layouts/` altında tek otoritedir.

Backend seçilen dosyayı doğrudan yükler. `scripts/select_layout.py`, aynı yerleşimin görselleştirme kopyasını `frontend/src/layout/active_layout.json` dosyasına yazar; binlerce mantıksal slotu tarayıcı paketine taşımaz. Slotlar ana dosyada korunur; renderer kapasite sayısını ve raf geometrisini kullanır. FULL WebSocket mesajındaki yerleşim sürümü frontend ile karşılaştırılır. Uyuşmazlıkta yanlış koordinatlı canlı akış uygulanmaz ve kullanıcıya bildirilir.

Navigasyon raf, istasyon, kolon, duvar, konveyör ve şarj gövdelerini engel olarak kullanır. Üretilen presetlerde engeller çevresine bir hücre güvenlik payı eklenir. Robot yarıçapı 0,65 m'dir. Görsel gövdeler kendi tanımlı sınırlarında kalır; zemindeki boya engel oluşturmaz, çatı elemanları robot yüksekliğinin üzerindedir. Duvar navigasyon zarfı görünür duvardan daha geniş, koruyucu bir sınırdır.

Üretici çakışmaları, sınırları, benzersiz adresleri, robot açıklığını, başlangıçları, istasyon erişimini ve boş navigasyon hücrelerinin bağlantısını denetler. Python ve TypeScript navigasyon ızgaraları SHA-256 eşitliğiyle dört preset için karşılaştırılır. Boyut değişiminde eski katalog/sipariş raf referansları mevcut raflara taşınır; stok tekrar düşülmez, aktif siparişler kurtarma akışına girer.

## Görsel ve performans değişiklikleri

Raf çerçeveleri, çapraz destekler, paletler ve kartonlar paylaşılan materyal/geometri ve instanced mesh kullanır. 24 m mekânsal gruplama kamera dışındaki grupların elenmesini sağlar. Uzak raflarda ayrıntı azaltılır; histerezis eşikleri sürekli kalite geçişini önler. Uzak robotlar düşük geometrili temsil kullanır; seçili ve yakındaki robotlar eklemli insansı görünümü korur. Animasyon gerçek simülasyon hareketine bağlıdır.

Beton/metal yüzeyler, endüstriyel raflar, çatı kirişleri, aydınlatma armatürleri, kolonlar, kapılar, çalışma tezgâhları, zemin yönlendirmeleri ve güvenlik işaretleri eklendi. Tabelalar mesafeye göre gizlenir/küçülür; her stok adresi için HTML üretilmez. Yakın kamera tabelalarının görüntüyü kaplaması düzeltildi.

İlk kamera depo boyutuna ve ekran oranına göre tesisin tamamını çerçeveler. Tam ekran / operasyon paneli geçişi, serbest kamera, robot takibi ve birinci şahıs görünümü korunur. Takip kamerası duvar, raf, kolon ve istasyonlara göre yaklaşma mesafesini sınırlar. Ekonomik, dengeli, yüksek kalite seçenekleri vardır.

### Ölçülen örnekler

9 Ekim 2026, bu Mac üzerindeki Codex tarayıcısı, çalışan yerel Vite ve backend, Dengeli kalite. Bunlar kısa süreli gerçek ekran sayaçlarıdır; ortalama/p95 benchmark veya başka cihazlar için FPS garantisi değildir. Çizim/üçgen sayaçları gölge ve görüntü işleme geçişlerini içerir.

| Sahne | Görünüm boyutu | FPS örneği | Çizim | Üçgen |
|---|---|---:|---:|---:|
| Small genel | 1100 × 904 | 120 | 351 | 37 bin |
| Medium genel | 1100 × 904 | 120 | 447 | 55 bin |
| Large genel | 1100 × 904 | 120 | 731 | 147 bin |
| Large robot takip | 1100 × 904 | 118 | 1428 | 430 bin |
| Large geniş ekran | 1728 × 1084 | 119–121 | 918 | 188 bin |

Dengeli kalite piksel oranını 1,5 ile sınırlar; geniş ekranda çizim tuvali 2592 × 1423 olarak gözlendi. Yakın kamera daha çok robot geometrisi açtığı için genel görünümden pahalıdır. Mega için tarayıcı FPS ölçümü yapılmadı.

## Çalıştırma ve ayarlar

```bash
./start.sh large
# Diğer seçenekler: small, medium, mega, legacy
```

Önce çalışan oturumu Ctrl+C ile durdurun. Betik dolu 8000/5173 portlarında yerleşimi değiştirmeyi reddeder. Varsayılan Large'dır. `legacy`, orijinal iki katlı yerleşimi ve asansörleri açar.

```bash
# Dört varsayılan yerleşimi yeniden üretip doğrula
backend/.venv/bin/python scripts/generate_layout.py --preset all
# Tek preset üzerinde örnek konfigürasyon
backend/.venv/bin/python scripts/generate_layout.py --preset large --corridor 6 --robot-count 24
# Large görsel çıktısını seç ve üretim derlemesi al
backend/.venv/bin/python scripts/select_layout.py large
npm --prefix frontend run build
```

Üretim ve seçim işlemlerini sunucular kapalıyken yapın. Özel değerler raf sayısını/kapasiteyi değiştirir; örnek komut varsayılan tablodaki Large ile aynı değildir. `--preset all` varsayılanlara döndürür. Desteklenen CLI parametreleri `--help` ile listelenir; istasyon sayıları ve raf boyutları da ayarlanabilir. Konumlar merkezi üreticiden türetilir; tek tek bağımsız dosyalarda değiştirilmez.

## Değişen dosyalar

- `backend/app/layout_generator.py`: üretici, presetler, fiziksel yerleşim doğrulaması.
- `shared/layouts/{small,medium,large,mega}.json`: ortak yerleşimler ve mantıksal stok adresleri.
- `scripts/generate_layout.py`, `scripts/select_layout.py`, `start.sh`: üretim, seçim ve birlikte başlatma.
- `backend/app/sim/navgrid.py`, `frontend/src/layout/navgrid.ts`: eşleşen navigasyon / açıklık hesapları.
- `backend/app/commerce.py`: preset değişiminde eski ürün ve sipariş referanslarının kurtarılması.
- `backend/app/main.py`, `backend/app/schema.py`, `frontend/src/schema/twin_state.ts`, `frontend/src/services/ws.ts`: yerleşim sürümü sözleşmesi.
- `frontend/src/layout/types.ts`, `frontend/src/layout/active_layout.json`, `frontend/src/state/store.ts`: ortak yerleşim tipleri ve aktif veri.
- `frontend/src/components/scene/RackInstances.tsx`: raf gruplama ve LOD.
- `frontend/src/components/scene/IndustrialDetails.tsx`: işaretleme, kiriş, ışık ve tabela örnekleri.
- `frontend/src/components/scene/WarehouseShell.tsx`, `Fixtures.tsx`: bina, kapılar, çalışma istasyonları ve konveyör görselleştirmesi.
- `frontend/src/components/scene/Robots.tsx`, `People.tsx`, `ZoneOverlay.tsx`: robot LOD, yerleşimle tutarlı sahne ve etiketler.
- `frontend/src/components/scene/Scene3D.tsx`, `cameraCollision.ts`: boyuta göre kamera, ışık, çarpışma sınırlama, gerçek render sayaçları.
- `frontend/src/components/views/Viewport.tsx`, `frontend/src/WarehouseApp.tsx`, `frontend/src/warehouse-console.css`: geniş sahne, kapasite özeti, tam ekran ve kamera kontrolleri.
- `backend/tests/test_layout_generator.py`, `backend/tests/conftest.py`, `frontend/tests/layout-presets.test.ts`: preset, sipariş, geçiş ve navigasyon regresyonları.
- `README.tr.md`, `NEXT_STEPS.md`, bu belge ve `validation/phase1-*`: kullanım ve doğrulama kanıtları.

## Doğrulama ve sınırlar

Small, Medium ve Large çalışan arayüzde açıldı ve ekran görüntüleri alındı. Robot yakın kamera ve tam ekran düğmesi denendi. Large API sağlığı: 32 robot, canlı simülasyon döngüsü, sağlıklı veritabanı, sıfır döngü hatası; backend/frontend yerleşim sürümleri eşit. Servis yeniden başlatılırken eski sekmede bağlantı/modül yükleme hataları görüldü; yeniden yüklenen çalışan sürümde yeni konsol hatası görülmedi.

Backend test paketinin tamamı geçti: **79 test, 101,48 saniye**. Testler eski davranışları ve yeni presetleri kapsar. Üç boyutta gerçek motorla siparişin received → picking → packing → loading → ready akışı, robot gövdelerinin sabit engellere mesafesi ve eski raf referanslarının taşınması test edilir. Frontend 40 test geçti; TypeScript ve Vite üretim derlemesi başarılı. Tam test çıktıları `validation/phase1-backend-tests.txt`, `phase1-layout-tests.txt`, `phase1-frontend-tests.txt`, `phase1-frontend-build.txt` içindedir.

- Slotlar mantıksal adreslerdir; her raf seviyesine fiziksel tırmanma/kol uzatma ve ayrıntılı bin-picking modellenmez. Robot görevleri raf erişim noktaları üzerinden çalışır.
- İnsansı robotlar mevcut kinematik motorun görsel temsilidir; yürüyüş dengesi / eklem fiziği simülasyonu değildir.
- Yeni bakım/kabul geometrileri operasyon noktalarıdır; ayrıntılı bakım iş emirleri ve mal kabul envanter yaşam döngüsü bu aşamada eklenmedi.
- Yeni presetler tek katlıdır; eski çok katlı depo `legacy` seçeneğiyle korunur.
- Preset değişimi iki servisin yeniden başlatılmasını gerektirir. Fiziksel operasyonun kesintisiz taşınması iddia edilmez.
- Mega yerleşim/navigasyon testlerini geçti; görsel FPS ve uzun süreli yük dayanıklılığı ölçülmedi.
- Yakın görüntüde çizim sayısı artar; daha ileri karakter batching yapılabilir. Vite yaklaşık 1,29 MB depo JS parçası için boyut uyarısı verir; derleme hatası değildir.
- Mevcut rota algoritmaları korunmuştur. Yeni optimizasyon algoritmaları, şehir/drone ve sonraki aşamalar başlatılmadı. Bu yerel geliştirme prototipi, sertifikalı fiziksel robot kontrolü veya üretim işletim sistemi değildir.

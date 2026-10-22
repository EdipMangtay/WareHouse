# Özelliği nerede değiştirmeliyim?

| Özellik | Dosya/modül | Kullanan |
|---|---|---|
| Ürün, sipariş, görev, taşıyıcı, müşteri paketi | `packages/warehouse_core/domain/models.py` | Bütün çekirdek |
| Birimler, fizik parametreleri ve doğrulama | `domain/config.py` | Scenario, fizik ve planlayıcı |
| Senaryo yükleme, bağımsız RNG tohumları | `simulation/scenario.py` | API, runner |
| Saat, komut etkileri, kesintiler, adım sırası | `simulation/engine.py` | API, runner, aday evaluator |
| Ürün korunum ve kapasite denetimi | `simulation/invariants.py` | Her gerçek/aday adımı, testler |
| Robot aşamaları ve sabit robot seçimi | `resources/robots.py` | Bölge agent'ı, simülasyon |
| Bant giriş/ilerleme kuralları | `resources/conveyor.py` | Simülasyon |
| Paketleme başlangıç/bitiş kuralları | `resources/packing.py` | Simülasyon |
| Sipariş kabulü, yerel yuva hesabı | `resources/buffers.py` | Koordinatör, agent, invariant |
| Bölge gözlemi ve görev atama | `coordination/zone.py` | Global koordinatör, snapshot |
| Yeniden planlama, karar kayıtları | `coordination/coordinator.py` | Simülasyon |
| Bütün birleşmeler için atomik rezervasyon | `planning/reservations.py` | Ortak çizelgeleyici |
| Bağlılık aralığı ve rezervasyon onarımı | `planning/scheduler.py` | Bütün politikalar |
| FIFO / son eksik bileşen ve yaş kuralı | `policies/reference.py` | Koordinatör |
| İki sıra ve rastgele anahtar temsili | `optimization/representation.py` | Arama ve evaluator |
| GWO / yerel arama / bütçe / incumbent | `optimization/search.py` | Koordinatör |
| Geleceği görmeyen aday simülasyonu | `optimization/evaluation.py` | Bütün arama yöntemleri |
| Değiştirilebilir süre tahmini | `prediction/duration.py` | Robot tahmini, evaluator |
| Snapshot, KPI, olay/karar/koşu dosyaları | `telemetry/` | API, runner |
| Web/API giriş mesajları | `packages/contracts/research.py`, `.ts`, `.schema.json` | API/web; core bunlara bağlı değil |
| Eski TwinState sözleşmeleri | `packages/contracts/legacy/` | Eski ekran ve API uyumluluk importları |
| Oturum, yaşam döngüsü, duvar saati | `apps/api/app/research/sessions.py` | Router |
| HTTP/WS ve ZIP aktarımı | `apps/api/app/research/routes.py` | Birleşik ve bağımsız API |
| Arayüzsüz toplu koşu | `apps/runner/main.py` | `python -m apps.runner` |
| Deney senaryoları / analiz | `experiments/scenarios/`, `experiments/analyze.py` | CLI, API kataloğu |
| Deney ekranı kompozisyonu | `apps/web/src/ResearchApp.tsx` | `#research` |
| 3D deney sahnesi, sipariş ve karar panelleri | `apps/web/src/components/research/` | ResearchApp |
| İletişim ve yeniden bağlantı | `apps/web/src/services/research.ts` | ResearchApp |
| Snapshot kopyası/seçim | `apps/web/src/state/research.ts` | Deney bileşenleri |
| Paylaşılan prosedürel robot/raf varlıkları | `apps/web/src/assets/models/` | Eski ve yeni sahne |
| Paylaşılan robot geometri/malzemeleri | `apps/web/src/assets/materials/humanoid.ts` | HumanoidRobot varlığı |
| Büyük deponun kontrol, sipariş ve ayrıntı panelleri | `apps/web/src/components/warehouse/` | WarehouseApp / mevcut motor verisi |
| Büyük deponun sipariş veri bağlantısı / görünüm durumu | `apps/web/src/services/warehouseOperations.ts`, `state/warehouseOperations.ts` | Depo panelleri ve mevcut 3D vurgular |
| Büyük deponun sahne ve kameraları | `apps/web/src/components/scene/`, `components/views/` | WarehouseApp |
| Eski navigasyon ve asansör operasyonları | `packages/warehouse_core/legacy/` | Eski API, eski regresyonlar |
| Kalıcı mağaza kataloğu/checkout | `apps/api/app/commerce.py` | Mağaza uçları; operasyonlar core OrderFlow'da |

Klasörler proje köküne göre verilmiştir; kısaltılmış core yolları
`packages/warehouse_core/` altındadır. `utils` veya bütün sistemi sahiplenen yeni
bir manager yoktur. `Simulation` yalnızca gerçek durum ve adım sırasının sahibidir;
robot, paketleme, tahmin, rezervasyon ve arama algoritmaları ayrı modüllerdir.

Görsellerin çoğu prosedürel geometri ve CanvasTexture ile üretilir. Projede taşınacak
GLB, harici model veya fotoğraf dokusu bulunmadığından boş texture klasörü açılmadı.
Web kökündeki `public/favicon.svg` statik sunulan varlıktır. Layout geometrileri
`shared/layouts` altında, web'in seçilmiş görünümü `src/layout/active_layout.json`dadır.

Eski `app/sim` fiziksel dosyaların kopyası değildir; core legacy modülüne taşınabilir Python paket
yolu adaptörüdür. `app/schema.py` ve `src/schema/*` canonical sözleşmelere re-export yapar.

Büyük depo UI veri akışı ve sınırları: [warehouse-ui.md](warehouse-ui.md).

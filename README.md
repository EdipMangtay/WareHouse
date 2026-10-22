# WareTwin — depo koordinasyon ve optimizasyon laboratuvarı

Aynı siparişin farklı bölgelerdeki ürünlerinin hazırlanmasını, ortak konveyöre
katılmasını, birleştirilmesini ve paketlenmesini birlikte araştıran çalışan sistem.
Operasyonun yetkili kaynağı Python çekirdeğidir. Web ve arayüzsüz deney çalıştırıcısı
aynı `Simulation.step()` olay modelini kullanır.

Mevcut mağaza, büyük depo, asansörler, kamera/yürüyüş kontrolleri ve robot görselleri
korundu. Bunlar `#warehouse` / `#shop` üzerinden erişilen navigasyon/mağaza modudur.
Yeni `#research` ekranı deneyler için ayrılmış bölge koridorlarını ve ortak bant
modelini gösterir. Bu iki modelin ölçümleri karıştırılmaz.

## Kurulum ve başlatma

Python 3.11+ ve Node 20+ kullanın. Komutlar proje kökünden çalıştırılır.

```bash
python3 -m venv apps/api/.venv
apps/api/.venv/bin/python -m pip install -r apps/api/requirements-dev.lock
npm --prefix apps/web ci

# Mağaza, mevcut büyük depo, araştırma API'si ve web birlikte
bash start.sh large
# http://127.0.0.1:5173/#research
# http://127.0.0.1:5173/#warehouse
# http://127.0.0.1:8000/docs
```

Bağımlılıklar zaten kuruluysa `npm run dev` de aynı başlatıcıyı çalıştırır.
`backend → apps/api`, `frontend → apps/web` eski yollar için uyumluluk bağlantılarıdır.
Windows'ta doğrudan `apps` yollarını ve `dev.ps1` dosyasını kullanın.

Araştırma API'sini mağaza/veritabanı olmadan ayrı çalıştırmak için iki terminal:

```bash
apps/api/.venv/bin/python -m uvicorn apps.api.research:app --host 127.0.0.1 --port 8000
npm run dev:web
```

`#research` ekranında senaryo, politika ve iki tohumu seçip **Deneyi oluştur**
düğmesine basın. Oturum başlangıçta duraklatılır. Devam, duraklat, tek adım,
10 simülasyon saniyesi, sıfırlama, hız ve kesinti komutları sunucuya gönderilir.
Bağlantı koparsa son doğrulanmış durum gösterilir; tarayıcı bağımsız motor başlatmaz.

## Mevcut büyük depo arayüzü

`http://127.0.0.1:5173/#warehouse` mevcut raf, robot ve dış bant yerleşimini açar.
Daraltılabilir operasyon listesi, seçime bağlı ayrıntılar, sipariş/bileşen takibi,
konveyör ve paketleme durumları, kamera/katman kontrolleri ile filtreli olay ve
karar kayıtları bu ekrandadır. 3D sahne ve listeler aynı seçimi kullanır;
veriler mevcut motor ve commerce servisinden gelir. Bağlantı kesildiğinde eski
veri işaretlenir ve komutlar kapanır.

[Kullanım, veri kaynakları ve dosya rehberi](docs/warehouse-ui.md) ·
[Tarayıcı ve test doğrulaması](validation/warehouse-ui.md).

## Doğrulama

```bash
apps/api/.venv/bin/python -m pytest tests apps/api/tests -q
npm run test:web
npm run build
apps/api/.venv/bin/python scripts/export_contracts.py --check
# Hepsi: npm run validate
```

Testler ürün korunumunu, robot sahipliğini, tam sipariş kapasite ayırmasını,
birleşme takip mesafesini, kesinti/yeniden başlatmayı, aday izolasyonunu,
tekrarlanabilirliği ve API/runner olay eşliğini kontrol eder.
Eski motorun navigasyon, asansör, mağaza ve konveyör regresyonları korunur.

## Simülasyon ve deneyler

Çekirdek standart Python kütüphanesiyle çalışır; CLI için FastAPI veya 3D gerekmez.

```bash
# Tek koşu
apps/api/.venv/bin/python -m apps.runner run --scenario multi_zone --policy fifo --seed 42

# Küçük doğrulama: 2 dış tohum, 5 politika, sabit 6 aday değerlendirmesi
apps/api/.venv/bin/python -m apps.runner batch --scenario balanced --policy all --seeds 2 --budget 6

# Ana karşılaştırmayı başlat: 8 senaryo × 30 dış tohum × 5 politika
apps/api/.venv/bin/python -m apps.runner batch --scenario all --policy all --seed 100 --seeds 30 --algorithm-seed 7 --budget 24

# Eşleştirilmiş tohum farkları, açık siparişler ve bootstrap aralığı
apps/api/.venv/bin/python experiments/analyze.py experiments/results/KOŞU_DİZİNİ/summary.csv
```

Politikalar: `fifo`, `order_aware`, `gwo_conveyor`, `local_search`, `gwo_integrated`.
GWO bir sezgiseldir; optimum garantisi vermez. Bütün yöntemler aynı robot seçimi,
kapasite kuralları ve rezervasyon çizelgeleyicisini kullanır.

Her koşu `run.json`, `orders.json`, `events.jsonl`, `decisions.jsonl`,
`samples.jsonl`, `metrics.json`, `final_snapshot.json` üretir. Konfigürasyon,
çözülmüş sipariş/kesinti listesi, ayrı rastgelelik tohumları, git sürümü ve kaynak
özeti kaydedilir. Sonuçlar `experiments/results/` altında git dışında tutulur.
Web'deki **Kayıtları indir** aynı kayıtları ve kullanıcı komutlarını ZIP olarak verir.
Tamamlanan/kapatılan/sıfırlanan web oturumları ayrıca `experiments/results/live/`
altına arşivlenir. Devam eden oturumlar sunucu belleğindedir.

## Kodun konumu

| Konum | İşlev |
|---|---|
| `apps/web` | React/Three.js, dashboard, kamera/seçim, salt snapshot istemci durumu |
| `apps/api/app/research` | Oturumlar, doğrulanmış komutlar, REST, WebSocket ve dışa aktarma |
| `apps/runner` | Aynı çekirdekle tek/çoklu deney CLI'si |
| `packages/warehouse_core` | Domain, simülasyon, fiziksel kaynaklar, koordinasyon, planlama, politikalar, optimizasyon, tahmin, kayıt |
| `packages/warehouse_core/legacy` | Taşınmış eski navigasyon/mağaza motoru; FSM, lift, trafik, konveyör |
| `packages/contracts` | V2 Python/TypeScript/JSON sözleşmeleri ve eski v1 sözleşmeleri |
| `experiments` | Sekiz senaryo ve eşleştirilmiş sonuç analizi |
| `tests` | Yeni çekirdek ve API entegrasyon testleri |
| `docs`, `scripts` | Mimari, protokol, doğrulama, yerleşim ve sözleşme üretimi |

Ayrıntılar: [mimari ve durum sahipliği](docs/architecture.md),
[klasör/özellik rehberi](docs/folder-guide.md), [senaryo biçimi](docs/scenarios.md),
[deney protokolü](docs/experiment-protocol.md),
[geçiş haritası](docs/migration-map.md), [doğrulama kaydı](docs/validation.md).

## Modelin kapsamı

Araştırma modeli tek yönlü, sabit hızlı ortak bant, eşit uzunlukta taşıyıcılar ve
robot başına ayrılmış servis koridorları kullanır. Genel robot yol çakışması,
araştırma modelinde asansör planlama, stok yenileme ve sevkiyat sonrası dağıtım
bu sürümün kapsamında değildir. Şarj, tamamlanan görev sayısına bağlı başlangıç
modelidir; ayrıntılı batarya/enerji modeli değildir. Tahmin fiziksel süreler ve
geçmiş ortalamasıdır; makine öğrenmesi henüz eklenmedi.

Sabit adım süresi varsayılan 0,5 s'dir. İşlem süreleri yukarı yuvarlanır.
Canlı `--time-limit-ms` sınırı bir aday değerlendirmesinin sonunda kontrol edilen
yumuşak sınırdır; tekrarlanabilir deneylerde yalnızca sabit `--budget` kullanın.
Açık siparişler ortalamadan ayrı sayılır ve aday değerlendirmesinde cezalandırılır.

Yerel araştırma kullanımı hedeflenir: oturumlar kullanıcı hesabına bağlı değildir,
8 oturum sınırı vardır ve tek API worker kullanılır. Docker'ı kökten
`docker build -f apps/api/Dockerfile .` ile oluşturun. Üretim barındırmasında kalıcı
sonuç diski ve erişim denetimi ayrıca yapılandırılmalıdır.

Özgün proje açıklaması [arşivde](docs/legacy-readme.md), lisans [MIT](LICENSE).

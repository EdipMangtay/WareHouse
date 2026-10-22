> Güncel kurulum, mimari ve deney komutları: [WareTwin README](README.md). Aşağıdaki metin önceki navigasyon sürümünün tarihsel rehberidir.

# WareTwin — E-ticaret ve depo dijital ikizi

Bu geliştirme kopyası, sağlanan WareTwin 3D depo simülatörünü e-ticaret ve operasyon yönetimiyle birleştirir. Masaüstündeki orijinal kaynak korunmuştur. Şehir ve drone simülasyonu bu sürümün kapsamı dışındadır.

## Çalıştırma

Bağımlılıklar bu çalışma kopyasında kuruludur. macOS/Linux üzerinde:

```bash
./start.sh large
```

- Mağaza: http://127.0.0.1:5173/#shop
- Sipariş takibi: http://127.0.0.1:5173/#track
- Yönetim: http://127.0.0.1:5173/#admin
- 3D depo: http://127.0.0.1:5173/#warehouse
- API dokümantasyonu: http://127.0.0.1:8000/docs

Depo boyutu için `./start.sh small|medium|large|mega` seçeneklerinden birini kullanın (tek isim seçin). Varsayılan Large, eski iki katlı depo `./start.sh legacy` ile açılır. [Phase 1 raporu](PHASE1_WAREHOUSE.md) boyutları, mimariyi, testleri ve ölçülen performansı açıklar.

Sunucuları durdurmak için Ctrl+C. Betik yalnızca yerel makineden bağlantı kabul eder. Mevcut bir servis 5173 veya 8000 portunu kullanıyorsa önce onu durdurun.

Temiz kurulum için Node.js 20+ ve Python 3.11+ kullanın (bu sürüm Python 3.13 ile test edildi):

```bash
cd backend
python3.13 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.lock
cd ../frontend
npm ci
cd ..
./start.sh
```

Windows başlatma betiği henüz uyarlanmadı. Terminalden frontend/backend ayrı çalıştırılabilir; kaynak proje talimatları README.md içindedir.

## Sipariş nasıl ilerler?

1. Katalog, fiyat ve stok backend'den okunur. Sepet tarayıcıda korunur.
2. Checkout, fiyatı sunucuda hesaplar; stok rezervasyonu ve sipariş kaydı tek SQLite işlemiyle yapılır. Aynı işlem anahtarının tekrar gönderilmesi ikinci sipariş veya stok kesintisi oluşturmaz.
3. Sipariş satırları depodaki gerçek raf erişim noktalarından paketleme istasyonuna `PICK` görevleri üretir. Mevcut filo yöneticisi robot atar; ürünler aynı 3D depoda taşınır.
4. Toplama tamamlanınca sınırlı kapasiteli paketleme kuyruğuna girer. Paketleme zamanı simülasyon saatine bağlıdır.
5. `TRANSPORT` görevleri paketleri çıkış yükleme alanına taşır. Ancak bu görevler tamamlanınca sipariş `ready` / **Sevke hazır** olur.
6. Takip ekranı durumu, olay geçmişini ve görevli robotları üç saniyede bir günceller. Yönetim paneli iki saniyede bir yenilenir. Depo görselleştirmesi mevcut WebSocket FULL/PATCH akışını kullanır.

Standart, öncelikli ve depodan teslim tercihleri vardır. Demo ücretleri sırasıyla 49,90 TL, 99,90 TL ve 0 TL'dir; gerçek ödeme alınmaz. Öncelikli siparişler depo görevinde yüksek öncelik alır. Araç önerisi ağırlık/adet eşiklerinden üretilen bir sevk planıdır; adres veya hacme dayalı gerçek araç rotalama değildir.

Robot arızasında devredilen görevlerin miktarı korunur. Backend yeniden başlatılır veya simülasyon sıfırlanırsa tamamlanmamış siparişler stok ikinci kez azaltılmadan yeniden kuyruğa girer; takip geçmişine kurtarma olayı eklenir. Tamamlanmış siparişler ve stok SQLite'da saklanır. Fiziksel bir deponun kesintisiz kurtarma garantisi modellenmez.

## Yönetim ve deneyler

- Aktif/tamamlanmış siparişler, hazırlık süresi, robot kullanımı, paketleme doluluğu, kuyruk ve performans ölçümleri.
- 5 / 100 / 500 / 1000 sipariş/dakika hızında, 10–300 saniyelik sınırlı stres senaryoları. Mevcut deponun arka plan demo görevleri de çalışmaya devam eder; sipariş metrikleri ve tüm filo görev metrikleri bu yüzden aynı şey değildir. Test siparişleri ayrı `source=stress` etiketi taşır; müşteri stoklarını tüketmez, gerçek depo görevleri oluşturur.
- Panelin stres testi **aynı backend sürecinde sipariş üretir**. Hedef hız, başarıyla oluşturulan gerçek hız ve hata sayısı farklı kavramlardır. CPU süreç CPU'sudur; RAM göstergesinin anlamı API notunda yer alır. API süresi sunucu işlem süresidir; ağ gecikmesini içermez.
- Gerçek HTTP trafiği için ayrı `scripts/http_load.py` vardır. Örneğin:

```bash
backend/.venv/bin/python scripts/http_load.py --rate 100 --seconds 30 --output validation/http-read.json
backend/.venv/bin/python scripts/http_load.py --mode checkout --rate 100 --seconds 30 --output validation/http-checkout.json
```

Checkout modu gerçek demo stoklarını rezerve eder ve sipariş geçmişinde test kayıtları bırakır. 429 hız/kuyruk sınırı, 409 stok veya işlem çakışması sonuçları da raporlanır; bunlar başarı gibi sayılmaz. Varsayılan koruma yazma isteklerini sınırlar. Yük deneyi için yalnızca yerel test ortamında backend'i `TWIN_RATE_LIMIT=0 ./start.sh` ile başlatabilirsiniz. Tek makinedeki bu ölçümler dağıtık üretim kapasitesini kanıtlamaz.

## Rota ve kamera

Yönetim panelindeki rota karşılaştırması, aynı anlık depo ızgarasında A*, Dijkstra ve kuyruk tabanlı Bellman-Ford uygular. Dinamik engeller, yaya alanı maliyeti ve trafik yoğunluğu üç algoritmaya eşit uygulanır. Maliyet, mesafe, süre ve incelenen düğüm sayısı döner. Kapalı hedef veya erişilemeyen yol açıkça raporlanır; iş bütçesi aşılırsa sonuç optimalmiş gibi sunulmaz. Deney salt okunurdur; çalışan robot filosunun rotacısı mevcut A* motorudur. Katlar arası algoritma karşılaştırması henüz yoktur.

3D görünümünde önce bir robot seçin; kamera menüsünden **Birinci şahıs** veya **Üçüncü şahıs** seçin. Serbest kameraya geçmek için kamera menüsünü veya sıfırlama düğmesini kullanın. Asansör ve kat yüksekliği kamera takibine yansır. Takip kamerası duvar, raf, kolon ve istasyon sınırlarına göre yaklaşma mesafesini kısaltır. Ekran ilk açılışta tesisin tamamını gösterir; **Tam ekran** düğmesi cihaz tam ekranını, **Operasyon paneli** düğmesi kontrol panellerini açar. Cihaz tam ekranını desteklemeyen tarayıcıda sahne pencereyi kaplar.

## Phase 2: etkileşimli 3D deneyim

Kamera menüsünde sinematik, taktik üst, izometrik, serbest, robot takip ve birinci şahıs modları bulunur. Arama alanına `R08`, `RACK-A001`, `SHELF-A01` veya `PACK-01` girin; sonucu seçerek odaklanın. Raf, istasyon, bölge ve robotlara doğrudan tıklayarak bilgi panelini açabilirsiniz. **Katmanlar** menüsü rotaları, durumları, koridorları, bölgeleri, istasyonları, engel sınırlarını, yön oklarını ve metre ızgarasını kontrol eder.

Dosya değişiklikleri, test sonuçları ve son görsel doğrulama sınırı [Phase 2 raporunda](PHASE2_EXPERIENCE.md) kayıtlıdır.

## Kaynak haritası

- `backend/app/commerce.py`: katalog, stok, sipariş, paketleme ve yükleme orkestrasyonu, stres ve metrikler.
- `backend/app/main.py`: FastAPI uçları, simülasyon döngüsüne bağlantı ve middleware ölçümleri.
- `backend/app/routing.py`: aynı depo görüntüsü üzerinde algoritma karşılaştırması.
- `frontend/src/commerce/`: mağaza, sepet, takip, yönetim arayüzleri.
- `frontend/src/WarehouseApp.tsx`: korunmuş depo ekranı.
- `frontend/src/components/scene/Scene3D.tsx`: robot kamerası.
- `scripts/http_load.py`: bağımsız HTTP yük üreticisi.
- `NEXT_STEPS.md`: sonraki görüşme için kapsam ve devam noktası.

## Doğrulama

```bash
cd backend && .venv/bin/python -m pytest -q
cd ../frontend && npm test && npm run build
```

Yeni backend testleri stok atomikliği, işlem tekrarları, gerçek robotlarla uçtan uca hazırlık/yükleme, arıza sonrası miktar korunması, kalıcılık, paketleme kuyruğu ve algoritma tutarlılığını doğrular. Önceki depo testleri korunmuştur. Kontrol sonuçları `validation/` altında tutulur.

Bu sürüm yerel, tek süreçli geliştirme prototipidir. Kullanıcı girişi/yetkilendirme, ödeme sağlayıcısı, dağıtık iş kuyruğu, üretim dağıtımı ve gerçek kargo teslimi henüz yoktur. “Sevke hazır” müşteriye teslim edildi anlamına gelmez. Orijinal deponun bazı kontrolleri İngilizcedir; eklenen mağaza ve operasyon ekranları Türkçedir.

## Phase 3 — ortak navigasyon

Depo ekranındaki **Navigasyon** düğmesi graf, erişim/kavşak noktaları, canlı hücre/kenar kapatmaları ve erişilebilirlik tanılamasını açar. `./start.sh large` ortak navigasyon manifestini yeniden üretir ve iki servisi aynı yerleşimle başlatır. Tüm depo boyutlarını kontrol etmek için `backend/.venv/bin/python scripts/validate_navigation.py --preset all` çalıştırın. Yapılandırma, API ve doğrulama ayrıntıları [PHASE3_NAVIGATION.md](PHASE3_NAVIGATION.md) içindedir.

# Mevcut durum ve uygulama sırası

İnceleme: 16 Ekim 2026. Proje ve üst dizinlerde AGENTS.md bulunmadı.
Başlangıçtaki değiştirilmiş ve yeni dosyalar korunur; git reset kullanılmaz.

## Başlangıç haritası

| Eski konum | Gerçek sorumluluk |
|---|---|
| `backend/app/sim/engine.py` | 100 ms sabit adım; robot FSM, A*, batarya, asansör, görev atama; yaklaşık 1.725 satır |
| `backend/app/sim/conveyor.py` | Fiziksel paket sahipliği, bağlantılı bantlar, anlık birleşme kilitleri ve istasyon rezervasyonları |
| `backend/app/commerce.py` | SQLite katalog/siparişler ile hazırlama, paketleme ve çıkış akışının birlikte yönetimi |
| `backend/app/main.py` | Ortak canlı oturum, gerçek zaman biriktirici, REST, WS FULL/PATCH, kayıtlar |
| `frontend/src/simulation` | Ayrı TypeScript motoru; bazı yerleşimlerde bağlantı kesilince bağımsız çalışıyor |
| `frontend/src/state/store.ts` | Zustand snapshot kopyası, kamera/seçim ve istemci kontrolleri |
| `frontend/src/components/scene` | Prosedürel modeller/malzemeler, görüntü interpolasyonu, kamera ve yürüyüş |
| `frontend/src/components/ops`, `commerce` | Eski operasyon panelleri ve mağaza deneyimi |

Gerçek durum Python motorundadır; görsel interpolasyon robot/taşıyıcı koordinatlarını
yumuşatır. TypeScript yedek motorunun otomatik devralması araştırma için uygun değildir.
Eski ticari paketleme API içindedir ve başlı başına deney çekirdeği değildir.

## Uygulama sırası ve kabul kapıları

1. Web/API taşıması, uyumlu eski yollar, eski fiziksel motorun core içine taşınması.
   Kapı: mevcut testler ve web derlemesi.
2. Bağımsız sipariş koordinasyon çekirdeği: açık birimler, robot aşamaları,
   yerel tampon, tüm sipariş için birleştirme kapasitesi, zaman tabanlı bant rezervasyonu.
   Kapı: korunum, kapasite, sıra ve kesinti testleri.
3. Ortak iki dizi temsili, açıklanabilir referanslar, yerel arama, iki GWO,
   izole aday değerlendirmesi ve tahmin arayüzü. Kapı: tekrarlanabilirlik ve aday izolasyonu.
4. Yapılandırılmış senaryolar, arayüzsüz çalıştırıcı, ayrı tohumlar ve tam kayıtlar.
   Kapı: küçük çoklu politika deneyi; 30 dış tohum komutu.
5. Oturum API/WS, mevcut 3D varlıklarla deney ekranı, gerçek Decision Inspector.
   Kapı: API/runner olay eşliği, komutlar, web derleme ve tarayıcı kontrolü.
6. Mimari, senaryo, deney protokolü ve sınırlamaları belgelemek.

Python/FastAPI ve React/TypeScript/Three.js korunur. Araştırma modeli, mevcut karmaşık
çok katlı navigasyonu açıkça adlandırılmış eski mod olarak korurken deneylere uygun
yapılandırılabilir bölge koridorları kullanır. İki modun ölçümleri karıştırılmaz.

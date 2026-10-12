# Phase 3 — Warehouse navigation and spatial graph

10 Ekim 2026. Mevcut WareTwin uygulamasında tamamlandı. Şehir/drone, filo optimizasyonu ve sonraki aşamalar kapsam dışındadır.

## Ortak uzamsal veri

`shared/layouts/{small,medium,large,mega}.json` fiziksel yerleşimin kaynağıdır. `backend/app/sim/spatial.py` bu yerleşimden sürümlü `navigation_graph` üretir. `load_layout()` her yüklemede yeniden derler ve doğrular; hatalı yerleşimin uygulamaya alınmasını durdurur. `scripts/select_layout.py` aynı derlenmiş grafı frontend `active_layout.json` dosyasına yazar. Backend motoru, frontend yerel motoru, A*/Dijkstra/Bellman-Ford karşılaştırması ve 3D geliştirici katmanları bu hücre ve komşuluk verisini kullanır. İçerik revizyonu WebSocket bağlantısında ve navigasyon panelinde kontrol edilir.

Graf sürüm 1: her kat için row-major `cells` (0: açık, 1: engel, 2: yavaş koridor), dört bitlik `outgoing` komşuluk maskesi (+X, −X, +Z, −Z), kavşak hücreleri ve SHA-256. Raf, giriş/çıkış, paketleme, ayrıştırma, bakım, şarj ve robot başlangıç düğümleri kimlik, kat, dünya koordinatı ve hücre koordinatı taşır. Izgarada en az üç çıkışı olan hücreler kavşak sayılır; açık apronlarda çok sayıda kavşak bulunması normaldir.

Raflar, duvarlar, kolonlar, istasyon gövdeleri, konveyörler ve şarj kabinleri mevcut yerleşim geometrisinden engel olarak üretilir. Robotlara kapalı yaya yolları engellenir. Robot yarıçapı ve güvenlik payı, engellerin etrafında konservatif bir hücre zarfı oluşturur:

`padding = max(clearance_padding, ceil((robot_radius + safety_margin) / cell_size))`

Bu, dünya geometrisini büyütmez; robot merkezinin girebileceği alanı daraltır. Large için yarıçap 0,65 m, hücre 1 m, padding 1 hücredir. Legacy yerleşimin mevcut sıfır padding ayarı korunur. Hücre zarfı tüm katlara uygulanır.

Dünya → hücre: `floor(x / cell_size), floor(z / cell_size)`. Hücre → dünya merkezi: `(c + 0.5) * cell_size, (r + 0.5) * cell_size`. Koordinatlar sıfırdan başlar; sınır dışındaki noktalar sessizce sınır içine kırpılmaz.

## Koridor yapılandırması

Yerleşimde `navigation.corridors` kullanılır. Varsayılan üretilen depoların ana omurgası ve ön/arka geçişleri çift yönlüdür. Yeni bir tek yön kuralı örneği:

```json
{"id":"AISLE-EAST","floor":1,"rect":[20,14,40,17],"mode":"one_way","direction":"+x"}
```

`mode`: `one_way` veya `two_way`. Yön: `+x`, `-x`, `+z`, `-z`. Dik doğrultudaki kavşak geçişleri izinlidir; ters yönde giriş/çıkış yasaktır. Çift yön kuralı örtüştüğü tek yön kuralını kaldırmaz. Karşıt yönlü örtüşmeler, geçersiz yön/kat/koridor sınırları ve yinelenen koridor kimlikleri reddedilir. Sekiz yönlü mevcut A* korunur; çapraz adımın iki ortogonal ayrıştırmasının tamamı geçerli olmalıdır. Böylece köşe kesme veya çapraz adımla tek yön/kenar kısıtını aşma önlenir.

Yapılandırma değişince iki servisi durdurup `./start.sh large` çalıştırın. Bu komut frontend ve backend'in aynı yerleşim revizyonuyla başlamasını sağlar. Doğrulama:

```sh
backend/.venv/bin/python scripts/validate_navigation.py --preset all --output validation/phase3-navigation.json
```

## Dinamik kısıtlar ve robot hareketi

- `GET /api/navigation?floor=1`: motorun güncel kapalı hücreleri, manuel hücreleri, yönlü kapalı kenarları, revizyonu ve tick'i.
- `GET /api/navigation/validate`: o andaki kısıtlarla gidiş/dönüş erişilebilirliği, geçersiz erişim/başlangıç noktaları, erişilemeyen düğümler ve yalıtılmış bölgeler.
- `POST /api/navigation/disruptions`: `floor`, `action` (`block`/`unblock`), `cells`, `edges`, `bidirectional` (varsayılan true). İstek başına en fazla 256 hücre ve 256 kenar. Tüm girdi değişiklikten önce doğrulanır; bir hata varsa hiçbiri uygulanmaz. Mevcut mutation hız sınırı ve origin/body korumaları kullanılır.

```json
{"floor":1,"action":"block","cells":[[90,14]],"edges":[],"bidirectional":true}
```

```json
{"floor":1,"action":"block","cells":[],"edges":[[[90,14],[91,14]]],"bidirectional":false}
```

Robotun bulunduğu hücre kapatılamaz. Geçersiz/statik engel hücreleri ve statik grafın parçası olmayan kenarlar reddedilir. Kapatmalar hem arama hem her sonraki hareket adımında uygulanır; mevcut rota eskimişse robot durur ve yeniden planlar. Alternatif yoksa hedef korunur, sahte varış üretilmez; yol açılınca robot devam eder. Rota aramasının diğer robotların geçici doluluğunu gevşeten mevcut yedek denemeleri artık sert hücre/kenar/tek yön kısıtlarını atlayamaz. Bölge kapatmaları da aynı sert hücre kümesine katılır. What-if klonları kendi kısıtlarını taşır; asıl motorla paylaşmaz.

Manuel kısıtlar geçicidir: motor yeniden başlatılınca/sıfırlanınca kalkar; veritabanına yazılmaz. Kapatılan hücre bir yasak robot-merkezi hücresidir; yeni bir fiziksel nesnenin boyutunu otomatik modellemez. Nesne genişliği gerekiyorsa ilgili tüm hücreleri kapatın veya yerleşimde fiziksel engel tanımlayın. Tek yön kuralları yapılandırma tabanlıdır; canlı panel geçici hücre/kenar kısıtlarını değiştirir.

## 3D geliştirici araçları

Depo üst çubuğundaki **Navigasyon** paneli:

- Graf ve tek yön okları, erişim düğümleri, kavşaklar, canlı kapatmalar için çalışan katman kontrolleri.
- Mevcut koridor/engel/grid katmanlarıyla birlikte inceleme.
- Hücre → dünya koordinatı gösterimi ve kamerayı hücreye odaklama.
- Hücre/komşu kenar kapatma ve açma; tek veya çift yönde işlem.
- Başlangıç doğrulaması ile tick damgalı canlı doğrulama ayrı gösterilir.
- Online motor verisi iki saniyede bir, yalnızca panel veya kapatma katmanı açıkken alınır. Bağlantı/sürüm hatasında eski kısıt verisi temizlenir. Offline görünüm başlangıç grafını gösterir; canlı müdahale kapalıdır.

Graf çizgileri kat başına önbelleklenir. Düğümler ve kapalı hücreler instancing ile renk başına tek grupta çizilir. Tam ekran ve dar panel görünümü gerçek tarayıcıda kontrol edildi.

## Doğrulama

| Depo | Yürünebilir hücre | Erişim + başlangıç düğümü | Gidiş/dönüş |
|---|---:|---:|---|
| Small | 2.814 | 58 | Tümü erişilebilir |
| Medium | 5.777 | 121 | Tümü erişilebilir |
| Large | 12.046 | 336 | Tümü erişilebilir |
| Mega | 21.102 | 640 | Tümü erişilebilir |

Legacy yerleşimde 401 düğüm; F1 5.030, F2 808 yürünebilir hücre. Her iki kat kendi içinde erişilebilir. Mevcut asansör durum makinesi ve katlar arası hareket testleri korunmuştur; bu aşamada yeni bir asansör planlayıcısı eklenmemiştir.

**Son test sonuçları:** 97 backend testi geçti (140,97 sn), 55 frontend testi geçti (7 dosya). TypeScript kontrolü ve Vite üretim derlemesi başarılı. Kayıtlar: `validation/phase3-backend-tests.txt`, `phase3-frontend-tests.txt`, `phase3-build.txt`, `phase3-navigation.json`. Son çalışan sürümün tarayıcı error/warn kayıtları boştu.

18 yeni backend testi: dört boyutta tüm operasyon düğümleri, yön/çapraz geçiş, üç algoritmada ortak kısıtlar, dinamik hücre/kenarlar, hatalı koridor, geçersiz spawn/erişim, yalıtılmış bölgeler, clearance, koordinat dönüşümü, hareket halindeki robotun beklemesi ve tekrar ilerlemesi, hedefin korunması, klon izolasyonu, bölge kapatması, atomik API sınırları ve Python/TypeScript ortak fixture'ı. 5 yeni frontend testi aynı veri sözleşmesini, derlenmiş manifest hash'ini ve yerel motorun dur/kalk davranışını doğrular. Önceki mağaza/sipariş, hareket, algılama ve asansör testleri korunur.

Tarayıcıda Large motor bağlantısı, tick ilerlemesi, tüm yeni katmanlar, canlı doğrulama, `90,14` hücresini kapatma/açma, `90,14 → 91,14` kenarını tek yönde kapatma/açma ve `SHELF-A01` erişim hücresi kapatıldığında kimlikli hata raporu gözlendi. `validation/phase3-blocked-cell.png` tam ekranda kırmızı kapatma hücresini gösterir. Son teslimde test kısıtları kaldırılmıştır; yeniden başlatılan motorda 0 kapalı hücre / 0 yönlü kenar ve başarılı canlı doğrulama gözlendi. Son görünüm: `validation/phase3-navigation-final.png`.

## Uygulama sınırları

Mevcut hareket/asansör sistemi 1 m hücre gerektirir; farklı çözünürlükle motor başlatma açık hata verir. Dönüşüm yardımcıları farklı çözünürlüklerle test edilmiştir. Mevcut raflar eksenlere paraleldir; döndürülmüş raf yapılandırması sessizce hatalı çarpışma üretmek yerine reddedilir. Bu aşama mevcut dikdörtgen depo/floor/zone geometrisini kullanır; serbest biçimli mimari mesh için navmesh çözümü değildir. Navigasyon tanılaması kat içindedir; legacy katlar arası taşıma mevcut asansör durum makinesindedir. Gelişmiş çok robotlu optimizasyon eklenmedi.

Üretim derlemesindeki mevcut büyük Three.js/depo parçası (>500 kB) uyarısı devam eder; derlemeyi engellemez. Ekranda gözlenen anlık FPS değerleri kapsamlı performans benchmark'ı olarak raporlanmaz.

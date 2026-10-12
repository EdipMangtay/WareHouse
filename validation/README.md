# Doğrulama kaydı — 5 Ekim 2026

## Otomatik kontroller

- `backend-tests.txt`: tüm backend testleri; depo, lift, algılama, API, korumalar, AI fallback, what-if, commerce ve rota algoritmaları.
- `frontend-tests.txt`: mevcut simülasyon motorunun 32 testi.
- `frontend-build.txt`: TypeScript ve Vite üretim derlemesi. 3D depo paketi için boyut uyarısı vardır; mağaza ve yönetim ayrı yüklenir.
- Commerce testleri, siparişi gerçek motor adımlarıyla `received → picking → packing → loading → ready` boyunca ilerletir. Stok geri alma, tekrar gönderilen işlem, yeniden başlatma, arızada görev devri, paketleme kapasitesi, stres stok ayrımı ve geçmiş görev kimliklerinin yeni robotlarla karışmaması doğrulanır.
- Test koleksiyonu `TWIN_DB=:memory:` kullanır; açık geliştirme veritabanını sıfırlamaz veya sipariş kurtarması yapmaz.

## Tarayıcı doğrulaması

- Mağaza kataloğu backend'den 8 ürün yükledi; “termos” araması tek ürün verdi.
- Bir kulaklık sepete eklendi. Checkout 2.499,00 TL + 49,90 TL = 2.548,90 TL gösterdi.
- Yerel test siparişi `WT-7C84C35E99CB4ACA` oluşturuldu. Gerçek robot görevleri, paketleme ve çıkış taşıması tamamlandı; takip ekranında **Sevke hazır** görüldü. Son teslimat oluşturulmadı.
- Yönetim paneli sipariş, robot ve ölçümleri gösterdi. Simülasyon hızı panelden değiştirildi.
- Aynı depo snapshot'ında A*, Dijkstra ve kuyruk tabanlı Bellman-Ford aynı 56,32 ağırlıklı maliyet ve 54,7 m mesafe buldu. Bu tek anlık örnek için 218 / 2.124 / 5.297 düğüm incelendi; genellenmiş benchmark değildir.
- Depo ekranında BACKEND bağlantısı görüldü; R01 robotu filo listesinden seçildi. Birinci ve üçüncü şahıs kameraları çalıştı. Hız kontrolü yeniden 1× yapıldı.
- Mağaza sekmesinde hata düzeyinde tarayıcı kaydı görülmedi.

## Kısa yük deneyleri

`stress-1000.json`: UI'dan 1000 sipariş/dakika hedefiyle 10 saniyelik sunucu içi üretim çalıştırıldı. 167 test siparişi oluştu, 0 oluşturma hatası. Bu siparişler gerçek depo görevlerine dönüşür; müşterilerin satış stoklarını tüketmez. Sipariş kabul hızı, fiziksel hazırlama kapasitesi anlamına gelmez. Test kayıtları geliştirme veritabanında kalır.

`http-read-1000.json`: ayrı süreçten gerçek HTTP katalog okuması; 10 saniyelik planlı pencerede 166 istek, 166 HTTP 200. p50 2,2 ms, p95 3,5 ms, p99 5,37 ms. Bunlar yerel makinede kısa ölçümlerdir; checkout kapasitesi veya dağıtık üretim SLA'sı olarak yorumlanamaz.

`http-read-100.json`: önceki kısa okuma deneyi; 16/16 başarılı, p95 3,03 ms.

## Görseller

- `storefront.jpg`: mağaza ana görünümü.
- `tracking-ready.jpg`: siparişin tamamlanan depo akışı ve olay geçmişi.
- `warehouse-first-person.jpg`: gerçek 3D depoda robot kamerası.
- `admin-stress.jpg`: stres deneyi sonrası operasyon paneli.

## Henüz doğrulanmayan / uygulanmayanlar

Mobil cihazlarda tarayıcı testi, gerçek ödeme, kullanıcı/admin yetkilendirmesi, dağıtık backend, uzun süreli dayanıklılık, üretim dağıtımı, şehir/drone teslimatı ve araçların 3D hareketi bu doğrulamanın kapsamında değildir. Rota karşılaştırması mevcut A* motorunun stratejisini değiştirmez.

## 8 Ekim 2026 — Tam ekran sahne

Depo doğrudan geniş sahneyle açılır. Operasyon paneli / Sahneyi büyüt geçişi ve Fullscreen API ile Tam ekran düğmesi eklendi. Desteklenmeyen ortamlarda pencereyi dolduran sahne korunur ve açıklama gösterilir.

TypeScript ve Vite üretim derlemesi başarılı; 3D paket boyutu uyarısı devam ediyor. Tarayıcıda tam ekrana giriş, panel görünümü, geniş sahneye dönüş, R07 seçimi, birinci/üçüncü kişi ve duraklat/devam et doğrulandı. Konsol hata kaydı yok. Görsel: `warehouse-fullscreen.png`.

## Phase 3 — 10 Ekim 2026

- `phase3-backend-tests.txt`: 97 test, başarılı.
- `phase3-frontend-tests.txt`: 55 test / 7 dosya, yakalanan doğrulama özeti.
- `phase3-build.txt`: TypeScript ve üretim derlemesi başarılı; mevcut paket boyutu uyarısı.
- `phase3-navigation.json`: dört depo boyutunda tüm operasyon düğümleri ve bölgeler erişilebilir.
- `phase3-blocked-cell.png`: tam ekran 3D graf üstünde geçici kapatma.
- `phase3-navigation-final.png`: çalışan son sürüm ve başarılı canlı erişilebilirlik paneli.

Tarayıcı kontrolü: hücre kapatma/açma, yönlü kenar kapatma/açma, SHELF-A01 erişim engeli tanılama, koordinata odaklama, 3D katmanlar ve tam ekran. Son motor 0 kapalı hücre / 0 kenarla bırakıldı; son tarayıcı error/warn listesi boştu.

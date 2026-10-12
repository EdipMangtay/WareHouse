# Devam noktası — 10 Ekim 2026

## Üzerinde çalışılacak kopya

Bu klasör aktif geliştirme kopyasıdır. Masaüstündeki WareTwin-main 2 ilk kaynak olarak alınmıştır. Uygulama React 18 / Vite / Three.js, FastAPI, SQLite ve mevcut WareTwin simülasyon motorunu kullanır. Şehir/drone kullanıcının isteğiyle ertelendi.

## İlk dilimde yapılanlar

Mağaza, ürün filtreleme, sepet, checkout, stok rezervasyonu, kalıcı sipariş/takip, robot görevlerine bağlanan toplama/paketleme/çıkış süreci, operasyon paneli, stres üretimi, performans ölçümleri, rota karşılaştırması, birinci/üçüncü şahıs kamera ve yerel çalıştırma betiği. Detaylar README.tr.md içindedir. API sözleşmesinin güncel kaynağı `/docs` ve testlerdir.

## Tamamlanan Phase 1

Prosedürel Small/Medium/Large/Mega depoları, ortak fiziksel yerleşim ve navigasyon doğrulaması, instanced raflar, endüstriyel mimari, robot LOD, insansı animasyon, boyuta uyarlanan kamera ve tam ekran tamamlandı. Large varsayılan 180 × 120 m, 280 raf ve 11.200 mantıksal adrestir. Ayrıntılar ve sınırlamalar PHASE1_WAREHOUSE.md içinde. Sonraki aşama kullanıcı istemeden başlatılmamalı.

## Phase 2 teslimi

Gelişmiş kamera modları, ortografik üst/izometrik görünüm, nesne seçimi ve hover, canlı nesne paneli, kimlik araması ve 3D katmanlar uygulandı. 79 backend ve 50 frontend testi geçti; son üretim derlemesi başarılı. PHASE2_EXPERIENCE.md doğrulanan etkileşimleri ve ölçümleri içerir. Ek tarayıcı doğrulaması kullanım limiti incelemesi tarafından engellendi; sonraki kontrolde son dar ekran panel düzeni ve sinematik dönüşü tekrar gözle incele. Sonraki geliştirme aşamasına kendiliğinden geçme.

## Phase 3 teslimi

Ortak sürümlü navigasyon grafı, tek/çift yön koridorlar, robot clearance, dinamik hücre/kenar kapatmaları, hareket adımında kısıt doğrulaması ve 3D navigasyon laboratuvarı uygulandı. Dört depo boyutu ve legacy katlar erişilebilirlikten geçti. PHASE3_NAVIGATION.md veri sözleşmesini, kullanımını, testleri ve sınırları açıklar. 97 backend / 55 frontend testi geçti; üretim derlemesi başarılı. Son tarayıcı incelemesinde hata yok; uygulama Large deposuyla çalışıyor. Yeni aşamaya kullanıcı istemeden geçme.

## Kullanıcı istediğinde sonraki geliştirme seçenekleri

1. Müşteri/admin hesapları, oturum yönetimi ve API tarafında rol yetkisi; sipariş sahibine özel erişim. Mevcut admin ekranı yerel demo içindir.
2. Ürün/stok yönetimi, sipariş iptali ve atomik stok iadesi; depoda başlamış işin iptal koşulları, SKU bazlı stok hareket defteri.
3. Ürün boyutları, hacim/ağırlık bazlı araç kapasitesi, yükleme rampası rezervasyonu ve araç filosu. Mevcut çıkış taşıması rampaya kadardır; araç hareketi yoktur.
4. Kalıcı performans zaman serisi, geciken sipariş KPI'ları, CSV raporu ve daha uzun stres deneyi sonuçlarının karşılaştırılması.
5. A*/Dijkstra/Bellman-Ford deneyini robot motorunda seçilebilir stratejiye dönüştürme; yeniden planlama ve katlar arası performans deneyleri. Mevcut karşılaştırma salt okunur ve aynı kattadır.
6. Postgres, iş kuyruğu/worker ayrımı, çoklu servis çalıştırma ve kontrollü dağıtık yük testi. Önce tek motorun otoritesini ve olay sözleşmesini koruyacak tasarımı belirle.
7. Depo arayüzünün tam Türkçeleştirilmesi, erişilebilirlik ve mobil yönetim iyileştirmeleri.
8. Kullanıcı tekrar istediğinde şehir modeli ve drone modülü.

Gerçek ödeme veya bildirim hizmetleri kullanıcı tercihleri netleştikten sonra bağlanmalı. Şehir/drone aşamasını kendiliğinden başlatma. Sahte teslimat statüsü, uydurulmuş stres sonucu veya harita verisi ekleme.

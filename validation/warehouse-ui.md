# Büyük depo UI doğrulaması — 17 Ekim 2026

Kapsam: mevcut `#warehouse` ekranı. LARGE yerleşim, 180 × 120 m, 247 raf,
48 robot, orijinal dış konveyör. Chrome'da gerçek Vite/FastAPI bağlantısı,
`/tmp/waretwin-coordination-qa.db` yerel test veritabanı kullanıldı.
Yerleşim koordinatları, navigasyon ve karar algoritmaları değiştirilmedi.

## Otomatik kontroller

- `npm run build`: TypeScript ve Vite üretim derlemesi başarılı.
- `npm --prefix apps/web test`: **80 test, 11 dosya** başarılı.
- `apps/api/.venv/bin/python -m pytest apps/api/tests/test_commerce.py apps/api/tests/test_conveyor.py -q`:
  **30 test** başarılı.
- Eklenen testler: sipariş bileşenlerinin korunması, eksik bileşen ve paketleme
  kabulü ayrımı, tahmini bitiş zamanından durum üretmeme, birleştirme/paketleme
  ayrımı, canlı taşıyıcı kaynağı, eski robot arızası ilişkisinin temizlenmesi,
  seçim/odaklamanın operasyon durumunu değiştirmemesi, ağ kaybı ve StrictMode.
- Vite >500 kB chunk uyarısı ve test araçlarının mevcut esbuild/oxc deprecation
  uyarısı sürüyor; derlemeyi engellemiyor. Bundle boyutu iyileşmesi iddia edilmiyor.

## Gerçek tarayıcı kontrolleri

- Daraltılabilir operasyon paneli, seçime bağlı sağ panel ve kapalı/açık olay
  kaydı çalıştı. Masaüstü 1440 × 900 ve telefon 390 × 844 genişliklerinde yatay
  sayfa taşması yoktu. Mobil sahne için toolbar/kamera yoğunluğu azaltıldı.
- Genel görünüm, üstten plan, bölge ve istasyon odakları; robot takip (`third`)
  ve robotun gözünden (`first`) modlarına geçiş doğrulandı. Mevcut serbest yürüyüş
  kontrolleri korundu; yürüyüş fiziğinde değişiklik yapılmadı.
- Sahnedeki bölge etiketiyle yapılan seçim, sol listedeki seçim ve sağ ayrıntı
  panelinde aynı bölgeyi gösterdi.
- Raf görünürlüğü ve gerçek takip aralığı katmanları açılıp kapatıldı; varsayılan
  görünüm geri yüklendi. İstasyon ve giriş ayrıntılı etiketleri mesafeyle sınırlı.
- Duraklatma ve devam mevcut motor komutlarıyla çalıştı. Duraklatılmışken 10×
  seçimi zamanı ilerletmedi. Sıfırlama komutu mevcut QA motorunda doğrulandı.
- Son normal sayfa yüklemesinde tarayıcı konsolunda hata veya uyarı yoktu.
  Offline emülasyonu sırasında beklenen ağ hataları ayrıca incelendi.
- Sipariş araması: eşleşmeyen metin 0, tam takip kodu 1 sonuç verdi. `Sevkiyata
  hazır` filtresi tamamlanan siparişi gösterdi; aktif filtre tamamlanmışı dışladı.
- Olay robot filtresinde R01 seçildiğinde satırlar R01 kayıtlarıyla sınırlıydı.
  Decision Inspector gerçek TASK_ASSIGNMENT adaylarını, seçilen robotu, mesafe,
  batarya ve kayıtlı gerekçeleri gösterdi.
- Chrome Offline emülasyonunda eski veri uyarısı göründü ve üç oynatma kontrolü
  de kapandı. Online'a dönüşte FULL alındı ve kontroller açıldı. REST hatası da
  ayrıca eski sipariş verisi uyarısıyla gösterildi.

## Tek müşteri siparişinin uçtan uca izlenmesi

Yerel QA API'sinde dört bölgeli bir sipariş oluşturuldu:
`WT-8F9D1D9ECB024C14`. Ürünler SHELF-A01, SHELF-A141, SHELF-A71, SHELF-A211
adreslerinden geldi. Bu adresler A/B/C/D bölgelerine aittir.

- Aynı müşteri siparişine bağlı dört bileşen taşıyıcısı görünür oldu.
- Üçü PACK-01'e ulaşmış, dördüncüsü konveyördeyken panel **1 / 4 bekleniyor**
  gösterdi; kapasite ayırması **4 ürün birimi**, fiziksel biriktirme **3 / 400
  taşıyıcı** idi. Motor paketlemeyi başlatmamıştı.
- Gerçek kayıt zamanları: sipariş 46,9 s; paketleme sırası 1476,0 s; paketleme
  başlangıcı 1476,6 s; paketleme bitişi / çıkış taşıması 1497,1 s;
  sevkiyata hazır 2689,3 s.
- Motorun gerçekleşmiş sipariş süresi **2642,4 simülasyon saniyesi** idi.
  Bu, yoğun başlangıç demo görevleriyle aynı depoda yapılan işlev kontrolüdür;
  optimizasyon sonucu veya performans karşılaştırması değildir.
- Dört giriş taşıyıcısı ve tek paketleme sonrası çıkış yükü aynı sipariş
  altında kaldı. Çıkış yükünün hedefi OUT-01, son durumu DELIVERED idi.
- Sahnede animasyon veya UI süresi siparişi tamamlamadı; `ready` backend
  commerce kaydından okundu. Son müşteri teslimatı simüle edilmedi.

## Sınırlar

Bu çalışma yeni GWO/ML, yerel tampon fiziği, zamanlı birleşme rezervasyonları
veya legacy tek-adım komutu eklemez. Kabul kapasitesi rezervasyonları vardır;
gelecekteki bant slotları yoktur. Kesin istasyon içi paket koordinatları
sağlanmadığından çizim şematiktir. Uzun süreli legacy simülasyonda batarya,
arıza ve kuyruk davranışları olduğu gibi görünür; yeni algoritmayla giderilmiş
sayılmaz. 48 robotlu mevcut sahne üzerinde kullanım kontrolü yapıldı;
ölçülmüş önce/sonra FPS kazanımı veya benchmark sonucu ileri sürülmez.

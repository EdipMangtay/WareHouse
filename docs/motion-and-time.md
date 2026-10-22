# Depo hareketi ve zaman

Bu model `#warehouse` ekranındaki mevcut `warehouse_core.legacy` motorudur.
Araştırma oturumları (`#research`) ayrı model olarak korunur.

## Zaman ve sunum

- Çekirdek adımı 100 ms simülasyon zamanıdır. Monotonik gerçek saat farkı yalnızca
  API oynatma saatinde hızla çarpılır. 1×: duraklamalar hariç 1 gerçek saniye =
  1 simülasyon saniyesi. Sunucu gecikmesinin 250 ms üstünü atan eski kırpma kaldırıldı.
- Her çalışma turunda en fazla 40 adım hesaplanır; kalan zaman kaybolmaz. Duraklatma
  ve hız değiştirme önce eski hızda kazanılmış adımları işler. RESET zaman borcunu
  ve sunum geçmişini temizler; 1× ile yeniden başlar.
- Görünür seçenekler 0.25×, 0.5×, 1×, 2×, 4×. Hız seçmek duraklatılmış motoru
  çalıştırmaz. Eski istemciler için 5×/10× API uyumluluğu korunmuştur.
- Her gelen snapshot görsel zaman çizelgesine girer; React yayınları en fazla
  20 Hz birleşir. Robot, yük, bant ve takip kamerası aynı örnekleri kullanır.
  Tampon bir motor adımı + 25 ms: 1× için 125 ms, 0.25× için 425 ms gerçek zaman.
  Bu, her hızda yaklaşık 100–200 ms **simülasyon** gecikmesidir.
- Görsel zaman son doğrulanmış tick'i geçmez; veri kesilince durur. FPS bağımsız
  zaman örneklemesi kullanılır. Gecikmiş veriyi hızla tahmin ederek ilerletme yoktur.
  Reset/FULL, hız veya duraklama geçişi eski geçmişi bırakır.
- Hareket yollarında spline yoktur. Robotun yol köşeleri ve konveyörün bağlantı
  noktaları korunur. Yeni bir yolun iki uzak konumu arasında raf kesen kiriş çizilmez.
  Uzun bağlantı kopmasından sonraki FULL otoriter konuma yeniden eşitlenir.

## Fiziksel başlangıç değerleri

Yerleşim `units: m` ve `grid.cell_size: 1` kullanır; motor her ikisini doğrular.
Rastgele sahne koordinatlarından metre türetilmez.

| Parametre | Önce | Yeni varsayılan | Yapılandırma |
|---|---:|---:|---|
| Robot üst hızı | 1.5 m/s | 1.2 m/s | `TWIN_ROBOT_SPEED_MPS` |
| Robot ivmesi | 1.2 m/s² | 0.6 m/s² | `TWIN_ROBOT_ACCEL_MPS2` |
| Robot frenlemesi | Hız sınırına anlık kırpma | 0.8 m/s² | `TWIN_ROBOT_DECEL_MPS2` |
| Robot dönüş üst hızı | 4 rad/s | 1.2 rad/s | `TWIN_ROBOT_TURN_RAD_S` |
| Bant seyir hızı | 1.2 m/s | 1.2 m/s, korunur | Yerleşim `speed_mps`, üreticide `LayoutConfig.conveyor_speed` |
| Taşıyıcının banda kavrama ivmesi | Anlık seyir hızı | 0.8 m/s² | `conveyor_network.carrier_acceleration_mps2` |
| Toplama / bırakma | 4 s / 3 s | Korunur | Çekirdek `PICK_TICKS` / `DROP_TICKS` |

Robot ayarları ayrıca yerleşimin `robot_motion` nesnesinde `max_speed_mps`,
`acceleration_mps2`, `deceleration_mps2`, `turn_rate_rad_s` alanlarıyla verilebilir.
Ortam değişkenleri bunları ezer. Değerler sonlu ve pozitif olmalıdır. Ayarlar
başlangıçta yüklenir; çalışan robotların fiziksel parametrelerini görsel kontroller
üzerinden değiştirmez. Bant ayarını değiştirirken aynı yerleşimi API ve web için
`scripts/select_layout.py` ile seçmek gerekir.

Robot, bir sonraki dönüş veya son hedefe kalan mesafeyle frenler; hücre merkezine
ulaşır, orada yönlenir ve sonraki kenarda hızlanır. Eski 8 cm erken yol-noktası
atlaması kaldırıldı. Navigasyon ve gövde/robot mesafe kontrolleri korunur. Beklenmedik
engel, arıza veya fiziksel çarpışma riski normal frenleme sınırından önce **güvenli
acil duruş** uygular. ETA aynı hızlanma/frenleme/dönüş yasasını kullanır; kuyruk,
arıza ve gelecekteki trafik beklemelerini öngörmez. Görevler gerçek motor varışı
ve işlem bitişiyle tamamlanır.

Konveyör bir birikimli taşıyıcı hattıdır: kabulden sonra kısa kavrama ivmesiyle bant
hızına ulaşılır, dolu hatta taşıyıcı durabilirken bant çalışabilir. Bu ayrım çekirdekte
`velocity_mps` ile açıktır. Doku, çekirdeğin toplam `travelled_m` mesafesinden
çizilir; metre başına bir tekrar ve doğru yön kullanır. Segment geçişindeki kalan
mesafe kaybolmaz. Serbest akış ETA'sı kavrama ivmesini içerir. Konumsal takip adımı,
birleşme kilitleri, kapasite ve istasyon rezervasyonları aynı otoriter modeldedir.
Bant arızası taşıyıcıları hemen durdurur; devamda tekrar kontrollü hızlanırlar.

Toplama/bırakma hareketleri `operation_elapsed_ticks / operation_duration_ticks`
oranını kullanır. İstasyondaki mevcut yavaşlama gerçek işlem süresine yansır;
giriş izni beklerken ilerleme donuktur. Görsel bir bekleme görevi erken bitiremez.
İstasyon içi paket istifi mevcut modelde şematiktir; raf/istasyon içinde ayrı bir
mekanik kol veya taşıma güzergâhı modellenmez. Yeni gizli transfer süresi eklenmedi.

Kamera konumu sunum pozundan gelir; dönüş takibi ve odaklanma üstel, gerçek saniye
bazlıdır. Seçim halkasının sürekli nabzı kaldırıldı. Sayılar sabit genişlikli
rakamlarla gösterilir. Uyarılar güncel snapshot'tan gelir, görsel tamponu beklemez.

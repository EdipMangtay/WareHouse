# UI ve robot çalıştırma doğrulaması — 12 Ekim 2026

Yerel Large preset: 180 × 120 m, 247 raf, 32 robot (her bölgede 7,
servis alanlarında 4). Robot, paket, sipariş ve telemetri aynı backend motoruna bağlı.

## Değişiklikler

- WebSocket paketleri sırayla birleştirilir; React durum yayını en fazla 20 Hz.
  Eksik tick sonrası FULL beklenir; eski bekleyen yayın iptal edilir.
- Konveyör controller PATCH yalnız değişen üst düzey alanları taşır;
  değişmeyen rota tabloları ve bölge bilgileri tarayıcıda korunur.
- Viewport robot listesini yalnız kimlikler değişince günceller.
  Sabit SceneContent, parent telemetri ve FPS güncellemelerinde yeniden kurulmaz.
- Paket animasyonunda vektör yeniden kullanımı ve Set ile görünürlük temizliği.
- Sürdürülen düşük FPS durumunda piksel oranı azalır, yük azalınca kademeli toparlanır.
  Varsayılan kalite Dengeli; Yüksek seçeneği kullanılabilir.
- Robot arızası sonrası robot, yükünü koruyarak aktarım FIFO kuyruğuna geri döner.
- Çıkış istasyonu kontrolü aynı asyncio döngüsünde çalışır; yazma hız sınırı uygulanır.
- Panel açıldığında sahnenin küçülmesini engelleyen yükseklik ve kaydırma sınırları.

## Ölçümler

Chrome araçlarıyla requestAnimationFrame aralıkları ve PerformanceObserver longtask
olayları, her koşul için 8 saniye boyunca ölçüldü. Bunlar bu makine ve tarayıcıdaki
kısa örneklerdir; her cihazda kesintisiz akıcılık garantisi değildir.

| Koşul | p95 kare aralığı | 50 ms üzeri kare | Uzun işlem |
|---|---:|---:|---:|
| Başlangıç, genel bakış 1× | 16,7 ms | 0 | 0 |
| Başlangıç, operasyon paneli 10× | 25 ms | 0 | 0 |
| Optimize üretim, benzer 32 robot / 15 hat paketi, panel 10× | 9,3 ms | 0 | 0 |
| Daha büyük sahne + açılan konveyör paneli, 131 paket kaydı, yüksek kalite | 25 ms | 2 | 2 (76 / 77 ms) |
| Aynı görünüm, yüksek kalite tekrar | 25,6 ms | 0 | 0 |
| Dengeli kalite, panel açık, 10× | 16,7 ms | 0 | 0 |

Kalite ve sahne alanı değiştiği için son üç koşul ilk iki satırla aynı yük değildir.
100 PATCH'in 100 ms içinde aktarılması testte yalnız 2 UI yayını oluşturdu;
100 görevin tamamı ve son tick eksiksiz korundu.

## Doğrulama

- `cd backend && .venv/bin/python -m pytest -q`: 116 geçti, 201,64 saniye.
- `cd frontend && npm test`: 69 geçti, 9 dosya, 35,96 saniye.
- `cd frontend && npm run build`: TypeScript ve üretim derlemesi başarılı.
  Büyük Three.js bundle uyarısı devam ediyor.
- Canlı tarayıcı konsolunda error/warn bulunmadı; ürün, yönetim ve state validation
  uçları 200 yanıt verdi. Canlı sağlık kontrolü sıfır motor hatası gösterdi.
- 10× kontrolde motor yaklaşık 99,7 tick/sn işledi; sonrasında 1× hızına döndürüldü.

## Çalıştırma

```bash
TWIN_FRONTEND_MODE=production ./start.sh large
```

Depo: http://127.0.0.1:5173/#warehouse
Mağaza: http://127.0.0.1:5173/#shop
Yönetim: http://127.0.0.1:5173/#admin

Bu yerel üretim derlemesi Vite preview ile sunulur; internete dağıtım yapılmadı.
Kaynak geliştirme için `./start.sh large` kullanılabilir.

# 48 robotlu görev akışı — 12 Ekim 2026

Large preset artık 48 robot içerir: ZONE_A/B/C/D için 11'er,
ortak servis alanları için 4 robot. Raflar, tesis boyutları ve koridorlar korunur.

Backend mevcut deterministik görev yöneticisini kullanır. Her iki simülasyon
saniyesinde, uygun ve boş robotlar için eksik işleri üretir. Bölge robotları
kendi raflarından paketlemeye PICK; servis robotları paketlemeden OUT-01'e
TRANSPORT işi alır. Bekleyen müşteri işleri bu ihtiyaca sayılır; kapalı bölgeler
için yeni demo işi üretilmez. Şarj, arıza ve FIFO istasyon beklemeleri sürer.

Doğrulama:

- `cd backend && .venv/bin/python -m pytest tests/test_fleet_tasks.py tests/test_conveyor.py tests/test_layout_generator.py -q`: 30 geçti, 25,99 saniye.
- `cd frontend && npm test -- --run tests/layout-presets.test.ts tests/stream.test.ts`: 9 geçti, 2,07 saniye.
- Üretim derlemesi ve mekânsal yerleşim doğrulaması başarılı.
- Canlı snapshot: 48 robot / 48 atanmış görev; dört bölgenin her birinde 11 ACTIVE robot.
- 8 saniyede 35 robotun konumu değişti; diğerleri gerçek istasyon/iş beklemesindeydi.
- Aynı 8 saniyelik tarayıcı ölçümünde 718 kare, p95 25,9 ms, 50 ms üzeri 0 kare,
  PerformanceObserver longtask 0. Bu makinedeki kısa ölçümdür.
- Motor yaklaşık 10,1 tick/sn, 1× hız, sıfır motor hatası.

Çalışan sürüm: `TWIN_FRONTEND_MODE=production ./start.sh large`

http://127.0.0.1:5173/#warehouse

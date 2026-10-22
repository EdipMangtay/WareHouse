# Senaryo biçimi ve birimler

Senaryolar UTF-8 JSON dosyalarıdır. CLI `--scenario dosya.json` kabul eder;
web/API kataloğu `experiments/scenarios/*.json` dosyalarını listeler. Bilinmeyen
fizik parametreleri, geçersiz bölgeler ve birleştirme alanına sığmayan siparişler
başlamadan reddedilir.

```json
{
  "name": "ornek",
  "horizon_s": 600,
  "config": {
    "tick_s": 0.5,
    "zones": [
      {"id": "Z1", "entry_m": 0, "robots": 2, "buffer_slots": 3, "pick_distance_m": 6},
      {"id": "Z2", "entry_m": 12, "robots": 1, "buffer_slots": 2, "pick_distance_m": 8},
      {"id": "Z3", "entry_m": 24, "robots": 2, "buffer_slots": 3, "pick_distance_m": 5},
      {"id": "Z4", "entry_m": 36, "robots": 2, "buffer_slots": 3, "pick_distance_m": 7}
    ],
    "robot_speed_mps": 1.5,
    "pick_s": 3,
    "drop_s": 1,
    "preparation_cv": 0.4,
    "belt_length_m": 48,
    "belt_speed_mps": 1,
    "carrier_length_m": 0.8,
    "safe_gap_m": 0.6,
    "consolidation_slots": 12,
    "packing_stations": 2,
    "packing_s": 8,
    "packing_per_item_s": 1,
    "commitment_s": 2,
    "replan_s": 15,
    "reservation_horizon_s": 1200,
    "battery_tasks": 20,
    "charge_s": 20
  },
  "orders": [
    {"id": "O1", "arrival_s": 0, "due_s": 120, "zones": ["Z1", "Z3", "Z3"]},
    {"id": "O2", "arrival_s": 8, "due_s": 100, "zones": ["Z2", "Z4"]}
  ],
  "incidents": [
    {"kind": "ROBOT_FAILURE", "at_s": 5, "target": "Z1-R1", "duration_s": 25},
    {"kind": "BELT_STOP", "at_s": 30, "duration_s": 15, "jitter_s": 3},
    {"kind": "PACKING_FAILURE", "at_s": 60, "target": "P1", "duration_s": 20}
  ]
}
```

Her `zones` girdisi bir ürün birimidir; tekrar edilen bölge birden çok ayrı ürün
anlamına gelir. O1'in Z3'ten iki ürünü vardır: iki görev, iki taşıyıcı ve bir
müşteri paketinin iki bileşeni. `arrival_s` sipariş geliş zamanı; `due_s` mutlak
simülasyon saniyesi cinsinden hedeftir. Ondalıklı geliş/kesinti zamanı ilk uygun
adıma alınır, gerçek geliş zamanı akış süresi hesabında korunur.

`orders` yerine aşağıdaki üretim tanımı kullanılabilir:

```json
{"name":"uretilen","horizon_s":900,"demand":{
  "count":30,"interval_s":4,"min_items":1,"max_items":4,
  "zone_weights":[1,1,1,1],"due_after_s":120,"distinct_zones":false
}}
```

`distinct_zones` açıksa bölgeler tekrarsız seçilir; en fazla bölge sayısı kadar
bileşen üretilir. Kapasite bir siparişin bütün bileşenlerini karşılamalıdır.
Eksik alanlar `domain/config.py` varsayılanlarını kullanır. Bölge ve robot sayısı
kod değiştirmeden ayarlanır; web sahnesi snapshot konfigürasyonundan oluşur.

`preparation_cv` pozitif toplama süresinin lognormal değişim katsayısıdır. Ortalama
`pick_s` kalır. Gerçek toplama süresi tohum ve ürün kimliğinden türetilir; politika
sırasından bağımsızdır. Sonuçlar yukarı doğru bir adım hassasiyetine yuvarlanır.

Rastgelelik akışları dış senaryo tohumu ve `orders`, `disruptions`, `preparation`
etiketlerinin SHA-256 özetinden üretilir. Arama RNG'si ayrı `algorithm_seed` kullanır.
Kesinti jitter'ı `[0,jitter_s]` aralığında, yalnızca kesinti akışından alınır.
Çözülmüş listeler ve gerçek akış tohumları `run.json` içinde saklanır.

## Hazır senaryolar

| Ad | Araştırdığı durum |
|---|---|
| balanced | Dengeli bölge talebi |
| hot_zone | Z1 ağırlıklı talep ve bölge darboğazı |
| multi_zone | Her sipariş dört bölgeden bileşen bekler |
| limited_buffer | Dört birleştirme yuvası, bölge başına bir yerel yuva |
| preparation_uncertainty | Değişken toplama süreleri, rezervasyon düzeltme |
| robot_failure | Yük/görev kaybetmeden bölge robotu arızası ve onarım |
| belt_stop | Aktif bant hareketinin durması, gelecek rezervasyonların yenilenmesi |
| packing_outage | Tek paketleme istasyonunda kesinti ve aşağı akış sıkışması |

Senaryo dosyası yürütücüye tam geleceği verir; karar politikası yalnızca gelmiş
siparişlerin ve başlamış kesintilerin gözlemini kullanır. CandidateEvaluator
gelecekteki listeleri çıkarır. Devam eden, süreli kesintinin bildirilmiş onarım
zamanı bilinen bilgi sayılır; henüz gerçekleşmemiş arıza bilinmez.

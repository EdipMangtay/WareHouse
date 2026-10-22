# Uygulama ve doğrulama kaydı

16–17 Ekim 2026. Mevcut değiştirilmiş/izlenmeyen dosyalar korunarak çalışıldı;
git reset, checkout veya commit yapılmadı.

## Aşama kapıları

| Aşama | Gerçekleştirilen değişiklik | Doğrulama |
|---|---|---|
| Mevcut harita ve taşıma | Web/API apps altına, mevcut motor core legacy altına; uyumlu eski yollar | Eski 117 Python testi ve web üretim derlemesi geçti |
| Fiziksel araştırma çekirdeği | Ayrı sipariş/ürün/görev/taşıyıcı/paket; FSM, yerel ve birleştirme kapasitesi, zaman rezervasyonları | İlk 26 çekirdek testi ve sekiz senaryo tamamlandı |
| Karar yöntemleri | FIFO, sipariş kuralı, konveyör GWO, ortak yerel arama, ortak GWO; izole aday değerlendirmesi | Sabit bütçe tekrarlanabilirlik, geleceği görmeme ve canlı durum izolasyonu |
| Deney/oturum altyapısı | CLI, bağımsız oturumlar, komut doğrulama, WS, kayıtlar/ZIP | API ile headless aynı adımlarda aynı olay/taşıyıcı/sipariş sonuçlarını üretti |
| Kod ayrımı | 1.725 satırlık eski motor fleet/lifts/navigation/monitoring/runtime dosyalarına bölündü; eski ticari operasyonlar core'a taşındı | İlgili 54 eski test; ardından 146 testlik tam paket geçti |
| Web entegrasyonu | Yeni araştırma sahnesi, mevcut robot varlıkları, gerçek sipariş/rezervasyon ve karar panelleri, backend-only kontroller | 71 frontend testi; TypeScript + Vite üretim derlemesi; gerçek tarayıcı kontrolleri |
| Ek sınır testleri | Incumbent/warm start, açık aday cezası, şarj, veri bozulması, çıkışa çok yakın girişte kuyruk güvenliği | Yeni core/API paketinde 36 test geçti |

Son tam Python koşusu **152 test** geçti. Ardından eklenen çıkış açıklığı testiyle
yeni çekirdek/API paketi **36 test** geçti; son ağaç **117 eski + 36 yeni = 153**
Python testi içerir. Frontend toplamı **71** testtir.

## Kullanılan komutlar

```bash
apps/api/.venv/bin/python -m pytest tests apps/api/tests -q
apps/api/.venv/bin/python -m pytest tests -q
npm run test:web
npm run build
apps/api/.venv/bin/python scripts/export_contracts.py --check
apps/api/.venv/bin/python scripts/validate_navigation.py --preset all
apps/api/.venv/bin/python -m compileall -q packages apps/api/app apps/runner
git diff --check
```

Dört yerleşimin navigasyon doğrulaması geçti: small 55, medium 111, large 331,
mega 601 operasyonel düğüm; her birinde yürünebilir alan ileri/geri bağlı.
TypeScript motoru korunmuş eski regresyonlarda kullanılır; artık uygulama
runner'ı tarafından çalıştırılmaz.

## Küçük deneyler

```bash
apps/api/.venv/bin/python -m apps.runner batch --scenario all --policy all \
  --seed 42 --seeds 2 --budget 6 --output experiments/results/validation
apps/api/.venv/bin/python -m apps.runner batch --scenario balanced --policy all \
  --seed 43 --seeds 2 --budget 6 --output experiments/results/final-validation
apps/api/.venv/bin/python -m apps.runner batch --scenario all --policy all \
  --seed 42 --seeds 2 --budget 6 --output experiments/results/release-validation
```

İlk parti: sekiz senaryo × beş politika × iki dış tohum = **80 koşu**, sıfır açık
sipariş ve sıfır henüz gelmemiş sipariş. İkinci kontrol: dengeli senaryoda **10 koşu**,
sıfır açık sipariş. Son çıkış açıklığı düzeltmesinden sonra sekiz senaryo ve beş
politikanın tamamı yeniden çalıştırıldı: **80 koşunun tamamı**, sıfır açık sipariş
ve sıfır henüz gelmemiş siparişle bitti. Son kayıt
`experiments/results/release-validation/20261016T230310.033628Z/summary.csv`.
Bunlar doğrulama deneyleridir; istatistiksel üstünlük iddiası
üretilmedi. 30 dış tohumlu ana deney komutu hazırdır; 1.200 koşuluk ana parti
bu geliştirme sırasında çalıştırılmadı.

Küçük, kaynak kontrolüne uygun özet:
[`experiment-checks.json`](../validation/coordination/experiment-checks.json).
Tam yapılandırma, olaylar, kararlar ve sonuçlar ilgili `experiments/results/`
dizinlerindedir ve git tarafından dışlanır. Kaynak sürümü bu koşuların içinde
kaydedilmiştir; daha sonraki bir değişiklik önceki kaydı sessizce değiştirmez.

## Tarayıcı

`/#research` üzerinden oturum oluşturuldu. Tek adım 0,5 s ilerletti. 20,5 s'de
bant durduruldu; 30,5 s'de üç mevcut taşıyıcı hâlâ 20 m, 4 m ve 28 m konumlarındaydı.
Duruş bitince hareket yeniden başladı. 20× oynatma ilerledi; duraklatma sonrası
110. adım aynı kaldı. GWO seçilerek gerçek 12 adaylı karar kaydı ve sabit sipariş
kohortu Inspector'da görüldü. API testleri kayıt ZIP içeriğini ve yeniden bağlantıda
aynı oturum modelini ayrıca doğrular.

1440 px ve 390 px görünümde yatay taşma yok. 390 px'de 3D canvas 360 × 328 px.
[`browser-checks.json`](../validation/coordination/browser-checks.json) gözlenen
sayısal sonuçları tutar. Vite geliştirme modunun yeniden yüklemesinde görülen
bağlantı kapanış uyarısı için istemci cleanup düzenlendi. Son temiz sayfa
yüklemesinde tarayıcı konsolunda hata veya uyarı görülmedi.

## Açık sınırlar

- Araştırma modelinin özel bölge koridorları, eski büyük deponun çok katlı A*
  trafik modeliyle aynı fiziksel topoloji değildir. İkisi açıkça ayrılmış modlardır.
- Tek yön/sabit hızlı bant, eşit taşıyıcı boyu, basit şarj, fiziksel/geçmiş süre
  tahmini başlangıç modelleridir. ML ve genel robot rota optimizasyonu yoktur.
- API tek worker ve yerel araştırma kullanımına göre tasarlandı. Oturumlar
  bellektedir; bitiş/sıfırlama/kapatmada arşivlenir. Çökmeden devam ettiren
  dayanıklı oturum kurtarma ve kullanıcı hesabı bazlı yetkilendirme yoktur.
- Canlı arama zaman sınırı aday bitişinde kontrol edilir. Sabit bütçe koşuları
  tekrar üretilebilir; duvar zaman ölçümleri tekrar üretilebilir değildir.
- Web üretim derlemesi büyük 3D chunk uyarısı verir. Derleme hatası yoktur;
  büyük sahne ve mevcut Three.js bağımlılıkları korunmuştur.

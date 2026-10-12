# Dış çevre bant yerleşimi

11 Ekim 2026

- Small, medium, large ve mega yerleşimleri dış çevrede kapalı bir bant döngüsü kullanır. Ana hat bina duvarlarından 4 m dışarıdadır; tüm bant hacimleri dış zeminin sınırları içindedir.
- Dört bölgenin aktarım noktaları yan duvarlara alındı. Robotların bina içindeki navigasyon sınırları korundu. Paketleme/çıkış bağlantıları çevre hattından ayrılır.
- 3D dış zemin ve aktarım açıklıkları, dış hat korkulukları, 2D akış yönleri ve aktarım etiketleri güncellendi. Kamera/harita sınırları aynı dış zemin verisini kullanır.
- Arayüzde “Dış bant hattı” ve bant panelinde “Hattın tamamını göster” kontrolleri üstten görünümü açar.

Doğrulama:

- `npm run test`: 7 dosyada 59 test geçti.
- `npm run build`: TypeScript ve üretim derlemesi başarılı; mevcut büyük paket uyarısı sürüyor. Kayıt: `exterior-belt-build.txt`.
- `python -m pytest backend/tests -q`: 114 test geçti. Backend test kaydı: `exterior-belt-backend-tests.txt`.
- Aktif frontend yerleşimi ile canonical large backend konveyör geometrisi eşleşiyor.
- Tarayıcı görsel doğrulaması yapılamadı: yerel sunucu portlarına erişim ortam tarafından engellendi; yükseltilmiş izin isteği otomatik olarak reddedildi.

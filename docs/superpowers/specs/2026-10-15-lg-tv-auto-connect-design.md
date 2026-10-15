# LG TV Kumandası — Otomatik Bağlanma + TR/EN Taşma + Yapılabilir İyileştirmeler Tasarımı

Tarih: 2026-10-15
Kapsam: `artifacts/netcast-remote` (Expo 57 + React Native 0.86 + expo-router)

## Niyet ve neden

Evde daha önce bir kez eşleştirme kodu alınmış bir LG NetCast TV varsa, kullanıcı uygulamayı açtığında eşleşme ekranıyla uğraşmak istemiyor. Beklenti: uygulama doğrudan kumanda sayfasına gelsin, düğmeler çalışsın, bağlanma işi arka planda sessizce olsun. Telefon ve TV aynı Wi-Fi ağındayken ek dokunuş gerekmesin.

İkinci sorun: Samsung S24 Ultra gibi büyük ekranlı telefonda bile bağlantı ekranının sağ üstündeki TR/EN dil düğmesi ile hemen yanındaki küçük bağlantı noktası neredeyse üst üste geliyor. Nedeni kodda görüldü: başlık satırında dil düğmesi ile nokta arasında boşluk yok, dil düğmesi iri (yaklaşık 100px genişlik, 50px yükseklik). Kumanda ekranındaki üst TV kartında da dil düğmesi ile ayar simgesi arasında boşluk yok. Samsung yazı büyütme açıkken sıkışma artıyor.

Üçüncü istek: genel küçük ekran taşmaları ve benim önereceğim güncelleştirmelerden yapılabilir olanların yapılması, sonra Expo ile tekrar APK üretilmesi.

## Hedefler

1. Kayıtlı eşleşme varsa açılışta kurulum kartı gösterilmeden kumanda ekranına girilmesi.
2. Kayıtlı `host + accessToken` ile `AuthReq` oturumunun arka planda sessizce tazelenmesi, butonlar hazır olana kadar kısa bir bağlanıyor durumu gösterilmesi.
3. TV kapalıysa veya farklı ağdaysa kumanda ekranında kalınması, üstteki TV kartında tema uyumlu küçük bir yeniden bağlanılıyor uyarısı gösterilmesi, bloklayan pencere veya ek dokunuş istenmemesi.
4. TR/EN düğmesinin kompakt hale getirilmesi, başlık ve TV kartında nefes payı bırakılması, nokta ile düğmenin ayrılması, yazı büyütmede taşmanın kesilmesi.
5. Genel Türkçe uzun etiket taşmalarının azaltılması (`Önceki Kanal`, `Kanal Listesi`, `Hızlı Menü` gibi).
6. Yapılabilir iyileştirmeler: IP değişiminde TV'yi ID'den yeniden bulma, bağlantı koptuğunda sessiz yeniden deneme, komut kaybını önleme, yazı ölçekleme sınırı.
7. Sonunda Expo EAS `preview` profiliyle tekrar APK üretilmesi.

## Hedef dışı

- Çoklu TV hafızası ve TV listesi yönetimi. Tek kayıtlı TV varsayımı korunur.
- Yeni protokol desteği (HDCP, pre-2012 modeller). Sadece ROAP NetCast 3-4.
- Web desteğinde SSDP tarama. Web'de manuel IP yolu aynen kalır.
- push notification, arka plan servisi, TV kapalıyken uyandırma (Wake-on-LAN).
- Dil sayısının artırılması. Sadece mevcut TR/EN korunur.

## Anti-hedefler (başarısız sayılacak durumlar)

- Açılışta kullanıcıyı tekrar kod girmeye zorlamak, buna rağmen token geçerliyken.
- Bağlanılamıyor diye tam ekran hata penceresıyla kumandayı kapatmak.
- Düğmeye basıldığında sessizce hiçbir şey olmaması.
- TR/EN düzeltmesi yaparken temayı bozmak veya başka bir taşma yaratmak.

## Kısıtlar

- NetCast ROAP port 8080 cleartext HTTP kullanır, Android `usesCleartextTraffic` açık kalmalı.
- SSDP taraması fiziksel cihazda çalışır, Expo Go ve web'de manuel IP fallback kalmalı.
- SecureStore'da `netcast-remote-connection-secure` v3 formatı korunmalı, migration bozulmamalı.
- Mevcut testler (`tests/storage.test.ts`, `tests/i18n.test.ts`, `tests/netcast-protocol.test.ts` vb.) geçmeye devam etmeli.
- Android paket: `com.cmtrkr83.netcastremote`, EAS projectId korunmalı.

## Kullanıcının karar verdikleri (değiştirilemez)

- Kayıtlı TV varsa direkt kumanda sayfası açılacak, düğmeler çalışacak.
- Bağlantı uyarısı temaya uygun ve kullanıcıyı yormayan küçük bir gösterge olacak, kumanda ekranında kalınacak.
- TR/EN düğmesi sağ üstte kalacak ama noktacıkla üst üste gelmeyecek.
- Yapılabilir olan iyileştirmeler yapılacak, kullanıcı tek tek seçmek istemiyor.

## Builder'a bırakılanlar (benim kararlarım, builder uygulayabilir)

- Boot akışı: `loadPersistedConnection` sonucu `ready` ise `connected=false` iken bile kumanda düzenini göster, `status.storedTvSearching` ile sessiz `createSession` dene, başarılı olunca `activateConnection`, geçici ağ hatasında 2-3 denemelik sessiz retry, sadece `auth` hatasında kayıt silinip eşleşme ekranına düş.
- IP değişimi: ilk `createSession` başarısız olursa SSDP `searchStream` ve güvenli subnet `scanLocalSubnet` ile aynı TV ID aranır, bulunursa host güncellenip `savePersistedConnection` yapılır. Benim çağrım: tam subnet taraması değil, önce SSDP unicast, sonra `getSafeScanHosts` ile sınırlı tarama.
- Uyarı UI: `connectedCard` içindeki `connectedMeta` satırında durum metni, nokta sarı tonunda, `accessibilityLiveRegion=polite`, bloklayan modal yok, haptics yok.
- LanguageToggle kompakt: container `minHeight` 50'den 36'ya, option `minWidth/minHeight` 44'ten 32'ye, header ve connectedCard'a `gap: 8`, `connectionDot` ve ayar butonuna `marginLeft: 4`, toggle'a `flexShrink: 0`. Benim çağrım: metin boyutu 10 olarak kalır.
- Genel taşma: uzun buton etiketlerinde `numberOfLines={1}`, `ellipsizeMode=tail`, `allowFontScaling` yerine `maxFontSizeMultiplier={1.2}`, `buttonLabel` font 10 olarak kalır, `quadRow` satırlarında `flexShrink: 1` ve `minWidth: 0`. Benim çağrım: çeviri metinleri kısaltılmayacak, sadece kesme ve ölçek sınırı uygulanacak.
- Komut kuyruğu: mevcut `protocol/requestQueue.ts` kullanılacak, basılı tutma tekrarları kuyruktan geçecek, 3 ardışık hata sonrası oturum düşürme korunacak.
- APK: `eas build -p android --profile preview` ile APK, `appVersionSource: remote` korunacak. Benim çağrım: version bump yapılmayacak.

## Doğrulama

- `pnpm install`, `pnpm run typecheck`, `pnpm --filter @workspace/netcast-remote run typecheck`.
- İlgili testler: `pnpm exec vitest run tests/storage.test.ts tests/i18n.test.ts tests/netcast-protocol.test.ts`.
- Fiziksel Android cihazda: kayıtlı TV ile açılışta direkt kumanda, uçak modu ve TV kapalı senaryolarında uyarı kontrolü, S24 Ultra'da sağ üst TR/EN ve nokta aralığı göz kontrolü.
- EAS preview build ile APK çıktısı alınması.

## Builder check sonrası netleşenler (benim kararlarım)

- Aynı TV kararı: SSDP USN/UUID birincil anahtar, yoksa `friendlyName + model` eşleşmesi, en son kayıtlı host. `probeNetCastHost` id formatı değişmeyecek, eşleştirme SSDP katmanında yapılacak.
- Kumandadan kurulum ekranına dönüş: bağlanıyor durumunda bile üst karttaki ayar simgesi her zaman görünür ve dokunulabilir olacak, dokununca kayıt silinmeden kurulum ekranına geçilecek, sadece kullanıcı isterse kayıt silinecek.
- Ulaşılamazken buton davranışı: butonlar basılabilir kalacak ama komut gönderilmeyecek, üst karttaki durum metni güncellenecek, güç/ses gibi komutlar kuyrukta biriktirilip sonra patlatılmayacak.
- Yeniden deneme ömrü: açılışta 3 sessiz deneme (1sn/2sn/4sn), sonra duracak, uygulama öne gelince bir kez daha denenecek, durum metnine dokununca manuel yeniden deneme yapılacak, sonsuz poll yok.

## Açık kalan tek konu (kullanıcıya sorulacak)

- EAS preview APK için giriş/keystore kimde ve test TV modeli ile APK teslim yeri neresi olacak.

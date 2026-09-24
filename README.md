# LG TV Kumandası

[![Buy Me A Coffee](https://img.shields.io/badge/Buy_Me_A_Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/cmtrkr)

LG NetCast 3.0 / 4.0 televizyonları aynı Wi-Fi ağı üzerinden keşfedip kumanda eden yerel uygulama. Apk yı telefonunuza yükleyerek doğrudan çalıştırabilirsiniz. 
kodlarda değişiklik yapmak için lütfen aşağıdaki adımları takip ediniz.
reklam telemetry vs yok. ücretsiz

## Stack
- pnpm workspaces, Node.js >=24.3.0, TypeScript 6.0.3
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- App: Expo 57 + React Native 0.86 + expo-router
- Keşif: `expo-ssdp` (SSDP M-SEARCH/B-SEARCH) + `expo-network` subnet fallback (ROAP `http://<tv>:8080/roap/api/`)
- Doğrulama: Zod, Orval (OpenAPI)

## Çalıştırma
```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test
pnpm run lint
PUBLIC_ORIGIN=https://example.test pnpm run build

# API Server (PORT gerekli)
PORT=5000 pnpm --filter @workspace/api-server run dev
# veya build sonrası
# pnpm --filter @workspace/api-server run build && pnpm --filter @workspace/api-server run start

# NetCast Kumanda (Expo)
pnpm --filter @workspace/netcast-remote run dev
# PUBLIC_ORIGIN=https://example.test pnpm --filter @workspace/netcast-remote run build
# PUBLIC_ORIGIN=https://example.test pnpm --filter @workspace/netcast-remote run serve

# Mockup Sandbox
pnpm --filter @workspace/mockup-sandbox run dev
```

CI ve yerel doğrulama için `pnpm run verify`, `pnpm run audit` ve `pnpm run doctor` komutları da kullanılabilir. `verify`, Orval generated-diff kontrolünü, typecheck, test, lint ve format kontrolünü sırayla çalıştırır.

## Dil
NetCast Kumanda varsayılan olarak Türkçe açılır. Kurulum ekranındaki `TR / EN` anahtarıyla dili anında değiştirebilirsiniz; seçim `netcast-remote-language` AsyncStorage anahtarında saklanır ve sonraki açılışlarda kullanılır. Uygulama metinleri `artifacts/netcast-remote/i18n` içindeki `LanguageProvider` ve `useTranslation` (`t`) hook'u üzerinden çözülür.

## Ortam Değişkenleri
- `PUBLIC_ORIGIN` — NetCast static build ve serve için zorunlu canonical origin; origin dışında path, query veya fragment içermez. CI smoke build için `https://example.test` kullanabilir.
- `BASE_PATH` — NetCast static build/serve ve mockup Vite için güvenli absolute path; varsayılan `/`. `..`, backslash ve geçersiz percent encoding kullanılmaz.
- `DATABASE_URL` — Postgres bağlantısı (api-server ve reviewed DB akışı için)
- `PORT` — API/mockup için port (varsayılan: api 5000, mockup 5173)
- `EXPO_PUBLIC_DOMAIN` / `DEPLOYMENT_DOMAIN` — `PUBLIC_ORIGIN` verilmediğinde netcast-remote static build için fallback domain

## Expo Doctor

Expo Doctor netcast-remote paketinde çalıştırılır ve SDK 57 eşleşmelerini doğrular. Doctor için Node >=24.3.0 ve repository `packageManager` sürümü (`pnpm@12.6.0`) kullanılmalıdır. Beklenen bağlantı sürümleri `expo ~57.0.24`, `expo-build-properties ~57.0.21`, `expo-constants ~57.0.19`, `expo-image-picker ~57.0.19`, `expo-location ~57.0.19` ve `expo-router ~57.0.22` değerleridir:

```bash
pnpm run doctor
```

## Güvenlik override'ları

`xcode@3.0.1` için `uuid@11.1.1` ve `query-string@7.1.3` için resmi `decode-uri-component@0.5.0` hedefli olarak override edilir. İkinci paket ESM olduğu için `query-string` CJS çağrısına yalnızca default export interop ekleyen `tests/fixtures/patches/query-string@7.1.3.patch` uygulanır; bu uyumluluk `tests/dependency-compatibility.test.ts` ve Expo build ile doğrulanır.

## DB akışı

DB değişiklikleri için doğrudan force push kullanılmaz. Şema değişikliği üretilir, gözden geçirilir ve uygulanır:

```bash
pnpm --filter @workspace/db run generate
pnpm --filter @workspace/db run check
pnpm --filter @workspace/db run migrate
```

## Yapı
```
artifacts/api-server    -> Express API (/api/healthz)
artifacts/netcast-remote -> Expo kumanda uygulaması (ana ürün)
artifacts/mockup-sandbox -> Vite component preview
lib/api-spec            -> OpenAPI spec (openapi.yaml) + Orval
lib/api-client-react    -> React Query client (codegen)
lib/api-zod             -> Zod schemas (codegen)
lib/db                  -> Drizzle schema
```

## Notlar
- SSDP taraması fiziksel cihazda çalışır; web/Expo Go'da manuel IP fallback kullanılır.
- NetCast ROAP port 8080, cleartext HTTP kullanır (Android `usesCleartextTraffic`).

## Destek
Bu projeyi faydalı bulduysanız bana bir kahve ısmarlayabilirsiniz:

[![Buy Me A Coffee](https://img.shields.io/badge/Buy_Me_A_Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/cmtrkr)

https://www.buymeacoffee.com/cmtrkr

# LG TV Kumandası

LG NetCast 3.0 / 4.0 televizyonları aynı Wi-Fi ağı üzerinden keşfedip kumanda eden yerel uygulama.

## Stack
- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- App: Expo 57 + React Native 0.86 + expo-router
- Keşif: `expo-ssdp` (SSDP M-SEARCH/B-SEARCH) + `expo-network` subnet fallback (ROAP `http://<tv>:8080/roap/api/`)
- Doğrulama: Zod, `drizzle-zod`, Orval (OpenAPI)

## Çalıştırma
```bash
pnpm install
pnpm run typecheck
pnpm run build

# API Server (PORT gerekli)
PORT=5000 pnpm --filter @workspace/api-server run dev
# veya build sonrası
# pnpm --filter @workspace/api-server run build && pnpm --filter @workspace/api-server run start

# NetCast Kumanda (Expo)
pnpm --filter @workspace/netcast-remote run dev
# pnpm --filter @workspace/netcast-remote run build  # static build
# pnpm --filter @workspace/netcast-remote run serve

# Mockup Sandbox
pnpm --filter @workspace/mockup-sandbox run dev
```

## Ortam Değişkenleri
- `DATABASE_URL` — Postgres bağlantısı (api-server, db push için)
- `PORT` — API/mockup için port (varsayılan: api 5000, mockup 5173)
- `BASE_PATH` — Vite base path (mockup)
- `EXPO_PUBLIC_DOMAIN` / `DEPLOYMENT_DOMAIN` — netcast-remote static build için domain

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

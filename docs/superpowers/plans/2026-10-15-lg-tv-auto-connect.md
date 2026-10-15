# LG TV Auto-Connect + TR/EN Overlap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kayıtlı TV varsa direkt kumandaya giren, TR/EN taşması olmayan, sessiz yeniden bağlanan Expo APK üretmek.

**Architecture:** Boot kararları saf fonksiyonlara taşınır (`sessionRestore`, `tvIdentity`), UI sadece bu kararları render eder; mevcut `SecureStore` v3, `SerialRequestQueue`, SSDP + `getSafeScanHosts` aynen kullanılır.

**Tech Stack:** Expo 57, React Native 0.86, TypeScript 6, Vitest 5, EAS preview APK.

**Spec:** `docs/superpowers/specs/2026-10-15-lg-tv-auto-connect-design.md`

## Global Constraints

- ROAP port 8080 cleartext HTTP, Android `usesCleartextTraffic` açık kalır.
- SSDP fiziksel cihazda, web/Expo Go'da manuel IP fallback kalır.
- SecureStore `netcast-remote-connection-secure` v3 formatı bozulmaz.
- Android paket `com.cmtrkr83.netcastremote`, EAS projectId korunur.
- `pnpm run typecheck` ve `vitest run` geçmeden commit yok.

## Review Focus

- Samsung yazı büyütme %150 iken sağ üst TR/EN ile nokta çakışmaz, başlık tek satırda kalır.
- TV kapalıyken butona basmak sessizce yutulmaz, üst kartta durum metni değişir ve güç komutu sonradan patlamaz.
- IP değişmiş TV (DHCP) aynı cihaz olarak tanınır, farklı isimdeki komşu TV ile karışmaz.
- Token iptal edilmişse (TV reset) kayıt silinip eşleşme ekranına düşülür, ölü kumandada kilitlenilmez.
- Uçak modunda açılış sonsuz taramaya girmez, batarya/network yakmaz.

---

### Task 1: Kompakt TR/EN + başlık boşlukları

**Files:**
- Modify: `artifacts/netcast-remote/components/LanguageToggle.tsx`
- Modify: `artifacts/netcast-remote/app/index.tsx:1927-1942` (header, connectionDot)
- Modify: `artifacts/netcast-remote/app/index.tsx:1973-1978` (connectedCard, disconnectButton)
- Test: `tests/language-toggle-layout.test.ts`

**Interfaces:**
- Consumes: mevcut `useColors`, `useTranslation`.
- Produces: `LANGUAGE_TOGGLE_METRICS = { containerMinHeight: 36, optionMinWidth: 32, optionMinHeight: 32 }`, header `gap: 8`, dot `marginLeft: 4`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { LANGUAGE_TOGGLE_METRICS } from "@/components/LanguageToggle";
describe("language toggle metrics", () => {
  it("stays compact so the header dot never touches it", () => {
    expect(LANGUAGE_TOGGLE_METRICS.containerMinHeight).toBeLessThanOrEqual(36);
    expect(LANGUAGE_TOGGLE_METRICS.optionMinWidth).toBeLessThanOrEqual(32);
    expect(LANGUAGE_TOGGLE_METRICS.optionMinHeight).toBeLessThanOrEqual(32);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/language-toggle-layout.test.ts`
Expected: FAIL with "LANGUAGE_TOGGLE_METRICS not defined"

- [ ] **Step 3: Implement `LANGUAGE_TOGGLE_METRICS` export in `artifacts/netcast-remote/components/LanguageToggle.tsx` and apply compact styles (container minHeight 36, option minWidth/minHeight 32, padding 2)**

- [ ] **Step 4: Add `gap: 8` to `header`/`connectedCard` styles and `marginLeft: 4` to `connectionDot`/`disconnectButton` in `artifacts/netcast-remote/app/index.tsx`**

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run tests/language-toggle-layout.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add artifacts/netcast-remote/components/LanguageToggle.tsx artifacts/netcast-remote/app/index.tsx tests/language-toggle-layout.test.ts
git commit -m "feat: compact language toggle and header gaps"
```

### Task 2: Açılışta direkt kumanda kabuğu + sessiz retry

**Files:**
- Create: `artifacts/netcast-remote/boot/sessionRestore.ts`
- Modify: `artifacts/netcast-remote/app/index.tsx:1022-1108` (boot effect)
- Test: `tests/session-restore.test.ts`

**Interfaces:**
- Consumes: `loadPersistedConnection(): Promise<LoadConnectionResult>` from `@/storage/connectionStorage`.
- Produces: `shouldShowRemoteShell(status: "missing"|"invalid"|"ready", hasStoredHost: boolean) -> boolean`, `BOOT_RETRY_DELAYS_MS = [1000, 2000, 4000]`, `isRetryableRestoreError(kind: NetcastErrorKind) -> boolean`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { BOOT_RETRY_DELAYS_MS, isRetryableRestoreError, shouldShowRemoteShell } from "@/boot/sessionRestore";
describe("session restore", () => {
  it("shows remote shell when a stored host exists", () => {
    expect(shouldShowRemoteShell("ready", true)).toBe(true);
    expect(shouldShowRemoteShell("invalid", true)).toBe(true);
    expect(shouldShowRemoteShell("missing", false)).toBe(false);
  });
  it("retries transient but never auth", () => {
    expect(isRetryableRestoreError("transient")).toBe(true);
    expect(isRetryableRestoreError("auth")).toBe(false);
    expect(BOOT_RETRY_DELAYS_MS).toEqual([1000, 2000, 4000]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/session-restore.test.ts`
Expected: FAIL with "sessionRestore not defined"

- [ ] **Step 3: Implement `shouldShowRemoteShell`, `isRetryableRestoreError`, `BOOT_RETRY_DELAYS_MS` in `artifacts/netcast-remote/boot/sessionRestore.ts`**

- [ ] **Step 4: Wire boot effect in `artifacts/netcast-remote/app/index.tsx` to render `connectedRoot` shell while restoring, run `createSession` with retry delays, keep settings gear tappable, only `auth` errors clear storage and show pairing**

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run tests/session-restore.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add artifacts/netcast-remote/boot/sessionRestore.ts artifacts/netcast-remote/app/index.tsx tests/session-restore.test.ts
git commit -m "feat: boot straight into remote with silent session restore"
```

### Task 3: IP değişiminde aynı TV'yi bulma

**Files:**
- Create: `artifacts/netcast-remote/protocol/tvIdentity.ts`
- Modify: `artifacts/netcast-remote/app/index.tsx:1110-1200` (restore fallback path)
- Test: `tests/tv-identity.test.ts`

**Interfaces:**
- Consumes: `DiscoveredTv { id, host, name, model? }`, stored `{ host, name }`.
- Produces: `resolveSameTv(candidates: DiscoveredTv[], stored: { host: string; name: string }) -> DiscoveredTv | null` (önce USN/UUID eşleşmesi, sonra `friendlyName+model`, yoksa null).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { resolveSameTv } from "@/protocol/tvIdentity";
describe("resolveSameTv", () => {
  it("prefers USN match over host and falls back to name", () => {
    const stored = { host: "192.168.1.10", name: "Salon" };
    expect(resolveSameTv([{ id: "uuid:abc", host: "192.168.1.42", name: "Salon" }], stored)?.host).toBe("192.168.1.42");
    expect(resolveSameTv([], stored)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/tv-identity.test.ts`
Expected: FAIL with "tvIdentity not defined"

- [ ] **Step 3: Implement `resolveSameTv` in `artifacts/netcast-remote/protocol/tvIdentity.ts` (USN/UUID eşitliği, sonra normalize edilmiş isim+model, host asla tek başına yeterli değil)**

- [ ] **Step 4: Call it in boot fallback: SSDP unicast sonra `getSafeScanHosts` sınırlı tarama, bulunursa `savePersistedConnection` ile host güncelle**

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run tests/tv-identity.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add artifacts/netcast-remote/protocol/tvIdentity.ts artifacts/netcast-remote/app/index.tsx tests/tv-identity.test.ts
git commit -m "feat: rediscover same TV after DHCP IP change"
```

### Task 4: Ulaşılamazken buton sözleşmesi + yazı taşma koruması

**Files:**
- Modify: `artifacts/netcast-remote/app/index.tsx:795-819` (quadRow butonları), `1990-1992` (navSide), `1982-1985` (buttonLabel)
- Test: `tests/command-availability.test.ts`

**Interfaces:**
- Consumes: `connection?.session`, `BOOT_RETRY_DELAYS_MS` state.
- Produces: `getCommandAvailability(hasSession: boolean) -> { enabled: boolean; statusKey: "status.connectionReady" | "status.storedTvSearching" }`, `MAX_FONT_MULTIPLIER = 1.2` (Task 2'nin `sessionRestore.ts` dosyasına eklenir).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { MAX_FONT_MULTIPLIER, getCommandAvailability } from "@/boot/sessionRestore";
describe("command availability", () => {
  it("never queues power while unreachable", () => {
    expect(getCommandAvailability(false).enabled).toBe(true);
    expect(getCommandAvailability(false).statusKey).toBe("status.storedTvSearching");
    expect(getCommandAvailability(true).statusKey).toBe("status.connectionReady");
    expect(MAX_FONT_MULTIPLIER).toBe(1.2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/command-availability.test.ts`
Expected: FAIL with "getCommandAvailability not defined"

- [ ] **Step 3: Implement `getCommandAvailability` + `MAX_FONT_MULTIPLIER` in `artifacts/netcast-remote/boot/sessionRestore.ts`, unreachable basışta komut göndermeden `connectedMeta` durumunu güncelle**

- [ ] **Step 4: Apply text guards in `artifacts/netcast-remote/app/index.tsx`: uzun etiketlerde `numberOfLines={1}` + `ellipsizeMode="tail"`, `maxFontSizeMultiplier={1.2}`, `quadRow` çocuklarına `flexShrink: 1` + `minWidth: 0`**

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/command-availability.test.ts tests/session-restore.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add artifacts/netcast-remote/boot/sessionRestore.ts artifacts/netcast-remote/app/index.tsx tests/command-availability.test.ts
git commit -m "feat: unreachable command contract and text overflow guards"
```

### Task 5: Doğrulama + Expo preview APK

**Files:**
- Modify: none (verification only)
- Test: `pnpm run typecheck`, `pnpm exec vitest run`, `pnpm run lint`

**Interfaces:**
- Consumes: Tasks 1-4 output.
- Produces: `artifacts/netcast-remote` preview APK (EAS `preview` profili, `buildType: apk`).

- [ ] **Step 1: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS with no errors

- [ ] **Step 2: Run unit tests**

Run: `pnpm exec vitest run`
Expected: PASS all suites

- [ ] **Step 3: Run lint and format check**

Run: `pnpm run lint; if ($?) { pnpm run format:check }`
Expected: PASS

- [ ] **Step 4: Build Expo preview APK (requires EAS login + `com.cmtrkr83.netcastremote` keystore)**

Run: `pnpm --filter @workspace/netcast-remote exec eas build -p android --profile preview`
Expected: EAS returns APK artifact URL

- [ ] **Step 5: Commit any leftover fixes only**

```bash
git status --short
git commit -m "chore: verification fixes" (only if files changed)
```

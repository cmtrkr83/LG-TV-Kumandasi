import { beforeEach, describe, expect, it } from "vitest";
import { asyncStorageState } from "./helpers/async-storage-mock";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  chooseLoadedLanguage,
  createLanguageWriteController,
  en,
  interpolate,
  loadLanguage,
  loadLanguagePreference,
  pluralize,
  remoteTestID,
  saveLanguage,
  translate,
  tr,
} from "../artifacts/netcast-remote/i18n";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  asyncStorageState.values.clear();
  asyncStorageState.failures.get = false;
  asyncStorageState.failures.set = false;
});

describe("i18n dictionaries", () => {
  it("keeps both dictionaries at exact key parity", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort());
  });

  it("interpolates parameters and selects count variants", () => {
    expect(interpolate("Hello {name}", { name: "Cem" })).toBe("Hello Cem");
    expect(interpolate("Hello {name}", { name: "" })).toBe("Hello ");
    expect(interpolate("Hello {user.name}", { user: { name: "Cem" } })).toBe(
      "Hello Cem",
    );
    expect(interpolate("Hello {user.name}", { user: { name: "" } })).toBe(
      "Hello ",
    );
    expect(translate("en", "status.scanFound", { count: 1 })).toBe(
      "1 TV found. Select one to pair.",
    );
    expect(translate("en", "status.scanFound", { count: 0 })).toBe(
      "0 TVs found. Select one to pair.",
    );
    expect(translate("en", "status.scanFound", { count: 2 })).toBe(
      "2 TVs found. Select one to pair.",
    );
    expect(translate("en", "status.scanFound", { count: Number.NaN })).toBe(
      "{count} TV found. Select one to pair.",
    );
    expect(translate("en", "status.scanFound", { count: "not-a-number" })).toBe(
      "{count} TV found. Select one to pair.",
    );
    expect(translate("en", "status.scanFound", {})).toBe(
      "{count} TV found. Select one to pair.",
    );
    expect(translate("tr", "status.scanFound", { count: 2 })).toBe(
      "2 TV bulundu. Eşleştirmek için birini seçin.",
    );
    expect(pluralize("en", 1, "one", "other")).toBe("one");
    expect(pluralize("en", 2, "one", "other")).toBe("other");
    expect(
      translate("tr", {
        key: "status.command.sent",
        params: { labelKey: "command.ok" },
      }),
    ).toBe("Tamam komutu TV’ye gönderildi");
    expect(
      translate("en", {
        key: "status.command.sent",
        params: { labelKey: "command.ok" },
      }),
    ).toBe("OK command sent to the TV");
  });

  it("falls back to the key when a message is missing", () => {
    expect(translate("en", "missing.message", { name: "Cem" })).toBe(
      "missing.message",
    );
  });

  it("keeps remote test IDs stable across locales", () => {
    expect(remoteTestID("command.digit", { digit: "1" })).toBe("remote-sayi-1");
    expect(remoteTestID("command.up")).toBe("remote-yukari");
    expect(remoteTestID("command.ok")).toBe("remote-tamam");
    expect(remoteTestID("command.power")).toBe("remote-power");
  });
});

describe("language preference storage", () => {
  it("uses Turkish for missing and invalid preferences", async () => {
    await expect(loadLanguage()).resolves.toBe(DEFAULT_LANGUAGE);
    asyncStorageState.values.set(LANGUAGE_STORAGE_KEY, "fr");
    await expect(loadLanguage()).resolves.toBe("tr");
  });

  it("returns a ready result for load failures and timeouts", async () => {
    asyncStorageState.failures.get = true;
    await expect(loadLanguagePreference()).resolves.toEqual({
      language: "tr",
      ready: true,
    });
    asyncStorageState.failures.get = false;
    await expect(
      loadLanguagePreference(() => new Promise(() => {}), 5),
    ).resolves.toEqual({ language: "tr", ready: true });
  });

  it("keeps a user selection when the cold-start load resolves", () => {
    expect(chooseLoadedLanguage("en", "tr")).toBe("en");
    expect(chooseLoadedLanguage(null, "en")).toBe("en");
  });

  it("loads and saves only supported language values", async () => {
    asyncStorageState.values.set(LANGUAGE_STORAGE_KEY, "en");
    await expect(loadLanguage()).resolves.toBe("en");
    await expect(saveLanguage("tr")).resolves.toBe(true);
    expect(asyncStorageState.values.get(LANGUAGE_STORAGE_KEY)).toBe("tr");
  });

  it("contains preference read and write failures", async () => {
    asyncStorageState.failures.get = true;
    await expect(loadLanguage()).resolves.toBe("tr");
    asyncStorageState.failures.get = false;
    asyncStorageState.failures.set = true;
    await expect(saveLanguage("en")).resolves.toBe(false);
  });

  it("serializes delayed writes so the newest language wins", async () => {
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    const writes: string[] = [];
    let stored: string | null = null;
    const controller = createLanguageWriteController(async (language) => {
      writes.push(language);
      if (writes.length === 1) {
        firstStarted.resolve();
        await releaseFirst.promise;
      }
      stored = language;
      return true;
    });

    const firstWrite = controller.enqueue("en");
    await firstStarted.promise;
    const secondWrite = controller.enqueue("tr");

    expect(controller.revision()).toBe(2);
    expect(writes).toEqual(["en"]);
    releaseFirst.resolve();
    await Promise.all([firstWrite, secondWrite, controller.drain()]);

    expect(stored).toBe("tr");
    expect(writes).toEqual(["en", "tr"]);
  });
});

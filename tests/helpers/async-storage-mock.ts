export const asyncStorageState = {
  values: new Map<string, string>(),
  failures: {
    get: false,
    set: false,
    remove: false,
  },
};

const asyncStorageMock = {
  getItem: async (key: string): Promise<string | null> => {
    if (asyncStorageState.failures.get) throw new Error("async read failed");
    return asyncStorageState.values.get(key) ?? null;
  },
  removeItem: async (key: string): Promise<void> => {
    if (asyncStorageState.failures.remove) {
      throw new Error("async remove failed");
    }
    asyncStorageState.values.delete(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (asyncStorageState.failures.set) throw new Error("async write failed");
    asyncStorageState.values.set(key, value);
  },
};

export default asyncStorageMock;

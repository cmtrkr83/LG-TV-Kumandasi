export const secureStoreState = {
  values: new Map<string, string>(),
  failures: {
    delete: false,
    get: false,
    set: false,
  },
};

export const deleteItemAsync = async (key: string): Promise<void> => {
  if (secureStoreState.failures.delete) {
    throw new Error("secure delete failed");
  }
  secureStoreState.values.delete(key);
};

export const getItemAsync = async (key: string): Promise<string | null> => {
  if (secureStoreState.failures.get) throw new Error("secure read failed");
  return secureStoreState.values.get(key) ?? null;
};

export const setItemAsync = async (
  key: string,
  value: string,
): Promise<void> => {
  if (secureStoreState.failures.set) throw new Error("secure write failed");
  secureStoreState.values.set(key, value);
};

declare module "virtual:mockup-components" {
  export type MockupModule = Record<string, unknown>
  export type MockupModuleMap = Record<
    string,
    () => Promise<MockupModule>
  >
  export const modules: MockupModuleMap
}

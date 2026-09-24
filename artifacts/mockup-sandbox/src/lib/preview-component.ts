import type { ComponentType } from "react"

const REACT_COMPONENT_WRAPPER_TYPES = new Set<symbol>([
  Symbol.for("react.forward_ref"),
  Symbol.for("react.lazy"),
  Symbol.for("react.memo"),
])

function isRenderableComponent(value: unknown): value is ComponentType {
  if (typeof value === "function") {
    return true
  }
  if (typeof value !== "object" || value === null || !("$$typeof" in value)) {
    return false
  }
  return REACT_COMPONENT_WRAPPER_TYPES.has(
    (value as { $$typeof: unknown }).$$typeof as symbol,
  )
}

export function resolvePreviewComponent(
  module: Record<string, unknown>,
  fileName: string,
): ComponentType | null {
  const baseName = fileName
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/\.tsx$/i, "")

  if (!baseName) {
    return null
  }

  for (const candidate of [module.default, module.Preview, module[baseName]]) {
    if (isRenderableComponent(candidate)) {
      return candidate
    }
  }

  return null
}

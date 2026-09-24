import {
  Component,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import { resolvePreviewComponent } from "@/lib/preview-component";
import {
  modules as discoveredModules,
  type MockupModuleMap,
} from "virtual:mockup-components";

function PreviewError({ title, message }: { title: string; message: string }) {
  return (
    <main
      role="alert"
      aria-live="assertive"
      className="flex min-h-dvh w-full items-center justify-center overflow-x-hidden bg-background p-4 text-foreground sm:p-8"
    >
      <div className="w-full max-w-3xl min-w-0 rounded-lg border border-destructive bg-background p-4 shadow-sm sm:p-6">
        <h1 className="mb-3 text-lg font-semibold">{title}</h1>
        <pre className="max-h-[70dvh] overflow-auto whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-foreground">
          {message}
        </pre>
      </div>
    </main>
  );
}

type PreviewErrorBoundaryProps = {
  children: ReactNode;
  title: string;
};

type PreviewErrorBoundaryState = {
  error: Error | null;
};

class PreviewErrorBoundary extends Component<
  PreviewErrorBoundaryProps,
  PreviewErrorBoundaryState
> {
  state: PreviewErrorBoundaryState = { error: null };

  static displayName = "PreviewErrorBoundary";

  static getDerivedStateFromError(error: Error): PreviewErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <PreviewError
          title={this.props.title}
          message={this.state.error.message}
        />
      );
    }
    return this.props.children;
  }
}

function PreviewRenderer({
  componentPath,
  modules,
}: {
  componentPath: string;
  modules: MockupModuleMap;
}) {
  const [Component, setComponent] = useState<ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setComponent(null);
    setError(null);

    async function loadComponent(): Promise<void> {
      const normalizedComponentPath = componentPath.replace(/\.tsx$/i, "");
      const key = `./components/mockups/${normalizedComponentPath}.tsx`;
      const loader = modules[key];
      if (!loader) {
        setError(`No component found at ${componentPath}.tsx`);
        return;
      }

      try {
        const module = await loader();
        if (cancelled) {
          return;
        }
        const fileName =
          normalizedComponentPath.split("/").at(-1) ?? normalizedComponentPath;
        const component = resolvePreviewComponent(module, fileName);
        if (!component) {
          setError(
            `No preview component exported from ${componentPath}.tsx. Export one as default, Preview, or ${fileName}.`,
          );
          return;
        }
        setComponent(() => component);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        const message =
          loadError instanceof Error ? loadError.message : String(loadError);
        setError(`Failed to load preview.\n${message}`);
      }
    }

    void loadComponent();

    return () => {
      cancelled = true;
    };
  }, [componentPath, modules]);

  if (error) {
    return <PreviewError title="Preview unavailable" message={error} />;
  }

  if (!Component) {
    return null;
  }

  return (
    <PreviewErrorBoundary
      key={componentPath}
      title="Preview render failed"
    >
      <Component />
    </PreviewErrorBoundary>
  );
}

function getBasePath(): string {
  const decodedBasePath = safeDecodePathname(import.meta.env.BASE_URL);
  return decodedBasePath ? decodedBasePath.replace(/\/$/, "") : "";
}

function getPreviewExamplePath(): string {
  const basePath = getBasePath();
  return `${basePath}/preview/ComponentName`;
}

function Gallery() {
  return (
    <div className="flex min-h-dvh w-full items-center justify-center overflow-x-hidden bg-background p-4 text-foreground sm:p-8">
      <main className="w-full max-w-xl min-w-0 text-center">
        <h1 className="mb-3 text-2xl font-semibold text-foreground">
          Component Preview Server
        </h1>
        <p className="mb-4 text-foreground/80">
          This server renders individual components for the workspace canvas.
        </p>
        <p className="text-sm text-muted-foreground">
          Access component previews at{" "}
          <code className="mt-2 block max-w-full overflow-x-auto rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
            {getPreviewExamplePath()}
          </code>
        </p>
      </main>
    </div>
  );
}

function safeDecodePathname(pathname: string): string | null {
  try {
    const decoded = decodeURIComponent(pathname);
    if (
      decoded.includes("\0") ||
      decoded.includes("\\") ||
      decoded.split("/").some((segment) => segment === "." || segment === "..")
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function getPreviewPath(): string | null {
  const basePath = getBasePath();
  const decodedPathname = safeDecodePathname(window.location.pathname);
  if (!decodedPathname) {
    return null;
  }
  const local =
    basePath &&
    (decodedPathname === basePath ||
      decodedPathname.startsWith(`${basePath}/`))
      ? decodedPathname.slice(basePath.length) || "/"
      : decodedPathname;
  const match = local.match(/^\/preview\/(.+)$/);
  return match ? match[1] : null;
}

function App() {
  const previewPath = getPreviewPath();

  if (previewPath) {
    return (
      <PreviewRenderer
        componentPath={previewPath}
        modules={discoveredModules}
      />
    );
  }

  return <Gallery />;
}

export default App;

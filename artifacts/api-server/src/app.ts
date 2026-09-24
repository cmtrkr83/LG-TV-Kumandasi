import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const DEFAULT_ALLOWED_ORIGIN = "http://localhost:5173";
const BODY_LIMIT = "1mb";
const app: Express = express();

app.disable("x-powered-by");

function normalizeOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin === "null" ? null : parsed.origin;
  } catch {
    return null;
  }
}

function getAllowedOrigins(): ReadonlySet<string> {
  const configured =
    process.env["CORS_ALLOWED_ORIGINS"] ??
    process.env["CORS_ALLOWED_ORIGIN"] ??
    process.env["CORS_ORIGIN"] ??
    process.env["CORS_ORIGINS"] ??
    "";
  const origins = new Set<string>();

  for (const candidate of configured.split(",")) {
    const value = candidate.trim();
    if (value === "") continue;
    if (value === "*") {
      throw new Error(
        "CORS wildcard origins are not supported; list explicit HTTP(S) origins.",
      );
    }

    const origin = normalizeOrigin(value);
    if (!origin) {
      throw new Error("CORS allowed origins must be valid HTTP(S) origins.");
    }
    origins.add(origin);
  }

  if (origins.size === 0) origins.add(DEFAULT_ALLOWED_ORIGIN);
  return origins;
}

type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail: string;
  requestId?: string;
};

function getRequestId(req: Request): string | undefined {
  const id = (req as Request & { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number"
    ? String(id)
    : undefined;
}

function getErrorStatus(error: unknown): number {
  if (!error || typeof error !== "object") return 500;

  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status = candidate.status ?? candidate.statusCode;

  if (
    typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
  ) {
    return status;
  }

  return 500;
}

function getProblemTitle(status: number): string {
  if (status === 400) return "Bad Request";
  if (status === 404) return "Not Found";
  if (status === 413) return "Payload Too Large";
  if (status === 503) return "Service Unavailable";
  return status >= 500 ? "Internal Server Error" : "Request Error";
}

function getProblemDetail(status: number): string {
  if (status === 400) return "The request could not be understood.";
  if (status === 404) return "The requested resource was not found.";
  if (status === 413) return "The request body is too large.";
  if (status === 503) return "The service is temporarily unavailable.";
  return status >= 500
    ? "An unexpected error occurred."
    : "The request could not be completed.";
}

function sendProblem(
  req: Request,
  res: Response,
  status: number,
  detail: string,
): void {
  const problem: ProblemDetails = {
    type: "about:blank",
    title: getProblemTitle(status),
    status,
    detail,
  };
  const requestId = getRequestId(req);
  if (requestId) problem.requestId = requestId;

  res.status(status).type("application/problem+json").json(problem);
}

const allowedOrigins = getAllowedOrigins();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  cors({
    credentials: false,
    origin(origin, callback) {
      const normalizedOrigin = origin ? normalizeOrigin(origin) : null;
      if (!origin || (normalizedOrigin && allowedOrigins.has(normalizedOrigin))) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
  }),
);

app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));
app.use("/api", router);

app.use((req, res) => {
  sendProblem(req, res, 404, getProblemDetail(404));
});

const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const status = getErrorStatus(error);
  const errorName = error instanceof Error ? error.name : "UnknownError";
  req.log.error({ errorName, status }, "Request failed");

  if (res.headersSent) {
    res.end();
    return;
  }

  sendProblem(req, res, status, getProblemDetail(status));
};

app.use(errorHandler);

export default app;

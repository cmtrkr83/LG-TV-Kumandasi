import { Router, type IRouter, type Request, type Response } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

export const HEALTH_STATUS = {
  OK: "ok",
  NOT_READY: "not_ready",
} as const;

export const HEALTH_CHECK_STATUS = {
  DATABASE_NOT_CHECKED: "not_checked",
} as const;

const router: IRouter = Router();

function sendLiveness(_req: Request, res: Response): void {
  res.json(HealthCheckResponse.parse({ status: HEALTH_STATUS.OK }));
}

router.get("/healthz", sendLiveness);
router.get("/livez", sendLiveness);

router.get("/readyz", (_req, res) => {
  res.json({
    status: HEALTH_STATUS.OK,
    checks: {
      database: HEALTH_CHECK_STATUS.DATABASE_NOT_CHECKED,
    },
  });
});

export default router;

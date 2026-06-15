import { z } from 'zod';

/**
 * Zod schema for the UC3 plan-change endpoints (preview + commit share the same
 * shape). `targetHandle` is not constrained to a known set — an unknown/invalid
 * handle must surface as `maxio_failed`, not a local validation error.
 */
export const planChangeSchema = z.object({
  sessionId: z.string().min(1).optional(),
  txnRef: z.string().trim().min(1, 'txnRef is required'),
  targetHandle: z.string().trim().min(1, 'targetHandle is required'),
  timing: z.enum(['prorate', 'at-renewal']),
});

export type PlanChangeInput = z.infer<typeof planChangeSchema>;

import { z } from 'zod';

/**
 * Zod schema for POST /api/lifecycle (UC4). `cancelType` is only meaningful when
 * action is `cancel` (defaults to `immediate` in the service if omitted).
 */
export const lifecycleSchema = z.object({
  sessionId: z.string().min(1).optional(),
  txnRef: z.string().trim().min(1, 'txnRef is required'),
  action: z.enum(['pause', 'resume', 'cancel', 'reactivate']),
  cancelType: z.enum(['immediate', 'end-of-period']).optional(),
  reasonCode: z.string().trim().max(50).optional(),
});

export type LifecycleInput = z.infer<typeof lifecycleSchema>;

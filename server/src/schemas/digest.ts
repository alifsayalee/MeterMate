import { z } from 'zod';

/** Zod schema for POST /api/digest (UC6, admin). */
export const digestSchema = z.object({
  sessionId: z.string().min(1).optional(),
  consultantId: z.string().trim().min(1, 'consultantId is required'),
  /** Look-back window in days for new-signups/churn (default 30). */
  windowDays: z.number().int().positive().max(365).optional(),
});

export type DigestInput = z.infer<typeof digestSchema>;

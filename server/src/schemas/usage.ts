import { z } from 'zod';

/**
 * Zod schema for POST /api/usage (UC2). Invalid input is rejected with 400
 * before any Maxio/Slack call. `componentHandle` is not constrained to a known
 * set — an unknown handle must surface as `maxio_failed`, not a local error.
 */
export const usageSchema = z.object({
  sessionId: z.string().min(1).optional(),
  /** Reference to an existing transaction (the UC1 txnId). */
  txnRef: z.string().trim().min(1, 'txnRef is required'),
  componentHandle: z.string().trim().min(1, 'componentHandle is required'),
  quantity: z
    .number({ invalid_type_error: 'quantity must be a number' })
    .finite('quantity must be a finite number')
    .positive('quantity must be greater than 0'),
  memo: z.string().trim().max(255).optional(),
  /** ISO-8601 timestamp; only meaningful for event-based components. */
  timestamp: z.string().datetime({ offset: true }).optional(),
});

export type UsageInput = z.infer<typeof usageSchema>;

import { z } from 'zod';

/**
 * Zod schema for POST /api/book (UC1). Invalid input is rejected with 400
 * before any Maxio/Slack call. Note: `productHandle` is intentionally NOT
 * constrained to a known set — an unknown handle must reach Maxio and surface as
 * `maxio_failed` (AC-06), not a local validation error.
 */
export const bookSchema = z.object({
  sessionId: z.string().min(1).optional(),
  firstName: z.string().trim().min(1, 'firstName is required').max(100),
  lastName: z.string().trim().min(1, 'lastName is required').max(100),
  email: z.string().trim().email('a valid email is required').max(254),
  consultantId: z.string().trim().min(1, 'consultantId is required'),
  productHandle: z.string().trim().min(1, 'productHandle is required'),
  collectionMethod: z.enum(['automatic', 'remittance']),
  couponCode: z.string().trim().min(1).max(50).optional(),
});

export type BookInput = z.infer<typeof bookSchema>;

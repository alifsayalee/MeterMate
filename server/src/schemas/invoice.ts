import { z } from 'zod';

/** Zod schema for POST /api/invoices (UC5, admin). At least one line item is
 * required — an ad-hoc invoice needs something to bill. */
export const invoiceSchema = z.object({
  sessionId: z.string().min(1).optional(),
  txnRef: z.string().trim().min(1, 'txnRef is required'),
  lineItems: z
    .array(
      z.object({
        title: z.string().trim().min(1, 'line item title is required').max(255),
        quantity: z.number().finite().positive('quantity must be greater than 0'),
        unitPrice: z.number().finite().nonnegative('unitPrice must be 0 or more'),
      }),
    )
    .min(1, 'at least one line item is required'),
  memo: z.string().trim().max(1000).optional(),
  sendEmail: z.boolean(),
});

export type InvoiceInput = z.infer<typeof invoiceSchema>;

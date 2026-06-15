import {
  ApiError,
  CollectionMethod,
  type CreateSubscriptionRequest,
  ErrorListResponseError,
} from '@maxio-com/advanced-billing-sdk';
import { maxioAdminBaseUrl, subscriptionsController } from '../maxioClient.js';
import type { CollectionMethodValue, SubscriptionResult } from '../types.js';

/**
 * Maxio operations, one function per use case. No Express/Slack imports — pure
 * billing logic, unit-testable with the SDK mocked. Errors are normalised to
 * `MaxioServiceError` carrying a human-readable summary for Slack + the API.
 */

export class MaxioServiceError extends Error {
  readonly statusCode: number | undefined;
  readonly details: string[];
  constructor(message: string, statusCode?: number, details: string[] = []) {
    super(message);
    this.name = 'MaxioServiceError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

/** Extract a readable error summary from a Maxio SDK error. */
function summarizeMaxioError(error: unknown): MaxioServiceError {
  if (error instanceof ErrorListResponseError) {
    const result = error.result as { errors?: unknown } | undefined;
    const raw = result?.errors;
    const details = Array.isArray(raw) ? raw.map((e) => String(e)) : raw ? [String(raw)] : [];
    const message = details.length ? details.join('; ') : 'Maxio rejected the request';
    return new MaxioServiceError(message, error.statusCode, details);
  }
  if (error instanceof ApiError) {
    const body = typeof error.body === 'string' ? error.body : '';
    return new MaxioServiceError(
      body || `Maxio API error (HTTP ${error.statusCode})`,
      error.statusCode,
    );
  }
  if (error instanceof Error) return new MaxioServiceError(error.message);
  return new MaxioServiceError('Unknown Maxio error');
}

function toCents(value: bigint | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  return typeof value === 'bigint' ? Number(value) : value;
}

export interface CreateSubscriptionInput {
  firstName: string;
  lastName: string;
  email: string;
  productHandle: string;
  collectionMethod: CollectionMethodValue;
  couponCode?: string;
}

/**
 * UC1 — create a subscription, creating the customer inline (or reusing one
 * matched by the email `reference`). Reads back plan, MRR, state, and next
 * assessment date.
 */
export async function createSubscription(
  input: CreateSubscriptionInput,
): Promise<SubscriptionResult> {
  const collectionMethod =
    input.collectionMethod === 'automatic'
      ? CollectionMethod.Automatic
      : CollectionMethod.Remittance;

  const body: CreateSubscriptionRequest = {
    subscription: {
      productHandle: input.productHandle,
      paymentCollectionMethod: collectionMethod,
      customerAttributes: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        // Email-based reference makes customer creation idempotent: a repeat
        // booking with the same email reuses the existing Maxio customer.
        reference: input.email.trim().toLowerCase(),
      },
      ...(input.couponCode ? { couponCodes: [input.couponCode] } : {}),
    },
  };

  let response;
  try {
    response = await subscriptionsController().createSubscription(body);
  } catch (error) {
    throw summarizeMaxioError(error);
  }

  const subscription = response.result?.subscription;
  if (!subscription || subscription.id === undefined) {
    throw new MaxioServiceError('Maxio returned no subscription');
  }

  const customerId = subscription.customer?.id;
  if (customerId === undefined) {
    throw new MaxioServiceError('Maxio returned a subscription without a customer');
  }

  const planName = subscription.product?.name ?? input.productHandle;
  const nextAssessmentAt = subscription.nextAssessmentAt ?? subscription.currentPeriodEndsAt ?? null;

  return {
    subscriptionId: subscription.id,
    customerId,
    customerReference: subscription.customer?.reference ?? null,
    planName,
    productHandle: input.productHandle,
    mrrInCents: toCents(subscription.productPriceInCents),
    state: subscription.state ?? 'unknown',
    collectionMethod: subscription.paymentCollectionMethod ?? input.collectionMethod,
    nextAssessmentAt,
    maxioUrl: `${maxioAdminBaseUrl()}/subscriptions/${subscription.id}`,
  };
}

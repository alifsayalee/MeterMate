import {
  Client,
  ComponentsController,
  Environment,
  ProductFamiliesController,
  ProductsController,
  SubscriptionComponentsController,
  SubscriptionProductsController,
  SubscriptionsController,
} from '@maxio-com/advanced-billing-sdk';
import { config, requireMaxioConfig } from './config.js';

/**
 * Singleton Maxio Advanced Billing client + controllers. Constructed lazily so
 * the server (and /api/health) can boot before Maxio credentials are filled in;
 * the first billing call validates config and throws a clear error if missing.
 */

let client: Client | undefined;

function getClient(): Client {
  if (client) return client;
  const { apiKey, apiPassword, siteSubdomain, environment } = requireMaxioConfig();
  client = new Client({
    basicAuthCredentials: { username: apiKey, password: apiPassword },
    environment: environment === 'EU' ? Environment.EU : Environment.US,
    site: siteSubdomain,
    timeout: 120000,
  });
  return client;
}

export function subscriptionsController(): SubscriptionsController {
  return new SubscriptionsController(getClient());
}

export function productsController(): ProductsController {
  return new ProductsController(getClient());
}

export function productFamiliesController(): ProductFamiliesController {
  return new ProductFamiliesController(getClient());
}

export function componentsController(): ComponentsController {
  return new ComponentsController(getClient());
}

export function subscriptionComponentsController(): SubscriptionComponentsController {
  return new SubscriptionComponentsController(getClient());
}

export function subscriptionProductsController(): SubscriptionProductsController {
  return new SubscriptionProductsController(getClient());
}

/** Base URL for deep links into the Maxio admin UI for this site. */
export function maxioAdminBaseUrl(): string {
  const sub = config.maxio.siteSubdomain ?? 'app';
  return `https://${sub}.chargify.com`;
}

import {
  ApiError,
  type CreateMeteredComponent,
  type CreateOrUpdateProductRequest,
  type CreateProductFamilyRequest,
  IntervalUnit,
  PricingScheme,
} from '@maxio-com/advanced-billing-sdk';
import { config } from './config.js';
import {
  componentsController,
  productFamiliesController,
  productsController,
} from './maxioClient.js';

/**
 * Phase-1 seed. Creates (idempotently):
 *  - the product family,
 *  - the two recurring plans UC1 subscribes against: `basic` ($99/mo) and
 *    `pro` ($299/mo),
 *  - the metered component UC2 reports usage against: `consulting-minutes`
 *    ($2.00/minute, per-unit).
 *
 * The event-based `api-calls` component is intentionally NOT seeded here: the
 * SDK cannot create the required Event-Based Billing metric, so it must be set
 * up in the Maxio UI. The usage service already dispatches to the event path.
 *
 * Idempotent: existing handles are detected (readProductByHandle /
 * listProductFamilies / findComponent) and left untouched, so re-running is safe.
 *
 * Run with:  npm run seed --workspace server
 */

const FAMILY_HANDLE = config.maxio.defaultProductFamily || 'metermate';
const FAMILY_NAME = 'MeterMate';

interface PlanSeed {
  handle: string;
  name: string;
  priceInCents: number;
}

const PLANS: PlanSeed[] = [
  { handle: 'basic', name: 'Basic Plan', priceInCents: 9900 },
  { handle: 'pro', name: 'Pro Plan', priceInCents: 29900 },
];

async function ensureProductFamily(): Promise<number> {
  const families = productFamiliesController();
  // Idempotency: look for an existing family with our handle.
  try {
    const list = await families.listProductFamilies({});
    for (const wrapper of list.result ?? []) {
      const pf = wrapper.productFamily;
      if (pf?.handle === FAMILY_HANDLE && pf.id !== undefined) {
        console.log(`✓ Product family "${FAMILY_HANDLE}" already exists (id ${pf.id})`);
        return pf.id;
      }
    }
  } catch (err) {
    if (err instanceof ApiError) {
      throw new Error(`Failed to list product families (HTTP ${err.statusCode}): ${err.body}`);
    }
    throw err;
  }

  const body: CreateProductFamilyRequest = {
    productFamily: { name: FAMILY_NAME, handle: FAMILY_HANDLE, description: 'MeterMate plans' },
  };
  const created = await families.createProductFamily(body);
  const id = created.result?.productFamily?.id;
  if (id === undefined) throw new Error('Product family creation returned no id');
  console.log(`+ Created product family "${FAMILY_HANDLE}" (id ${id})`);
  return id;
}

async function ensureProduct(familyKey: string, plan: PlanSeed): Promise<void> {
  const products = productsController();

  // Idempotency: read by handle; if present, skip creation.
  try {
    const existing = await products.readProductByHandle(plan.handle);
    const p = existing.result?.product;
    if (p?.id !== undefined) {
      console.log(
        `✓ Product "${plan.handle}" already exists (id ${p.id}, ${(Number(p.priceInCents ?? 0) / 100).toFixed(2)})`,
      );
      return;
    }
  } catch (err) {
    // A 404 means "not found" → proceed to create. Re-throw anything else.
    if (!(err instanceof ApiError) || err.statusCode !== 404) {
      if (err instanceof ApiError) {
        throw new Error(`readProductByHandle("${plan.handle}") failed (HTTP ${err.statusCode}): ${err.body}`);
      }
      throw err;
    }
  }

  const body: CreateOrUpdateProductRequest = {
    product: {
      name: plan.name,
      handle: plan.handle,
      description: `${plan.name} — flat monthly retainer`,
      priceInCents: BigInt(plan.priceInCents),
      interval: 1,
      intervalUnit: IntervalUnit.Month,
      // Test-mode friendly: no card required so remittance/automatic both work
      // without payment-profile tokens during manual verification.
      requireCreditCard: false,
    },
  };
  const created = await products.createProduct(familyKey, body);
  const p = created.result?.product;
  if (p?.id === undefined) throw new Error(`Product creation for "${plan.handle}" returned no id`);
  console.log(`+ Created product "${plan.handle}" (id ${p.id}, ${(plan.priceInCents / 100).toFixed(2)}/mo)`);
}

interface MeteredSeed {
  handle: string;
  name: string;
  unitName: string;
  /** Per-unit price in dollars (Maxio component prices are decimal dollars). */
  unitPrice: string;
}

// Note: a component must live in the SAME product family as the products that
// subscriptions use, or recording usage 404s. We therefore create components in
// the products' actual family (derived from `basic`), not from FAMILY_HANDLE.
// Handle: `consulting-minutes` is reserved site-wide on this test site from an
// earlier era, and Maxio handles are permanently unique per site, so we use the
// available `consulting-time` handle for the canonical metered component.
const METERED_COMPONENTS: MeteredSeed[] = [
  { handle: 'consulting-time', name: 'Consulting Time', unitName: 'minute', unitPrice: '2.00' },
];

/** The family that actually contains the products (where components must live). */
async function resolveProductsFamilyId(fallbackFamilyId: number): Promise<number> {
  try {
    const basic = await productsController().readProductByHandle(PLANS[0]!.handle);
    const id = basic.result?.product?.productFamily?.id;
    if (id !== undefined) return id;
  } catch {
    // fall through to the fallback (fresh site)
  }
  return fallbackFamilyId;
}

async function ensureMeteredComponent(familyId: number, comp: MeteredSeed): Promise<void> {
  const components = componentsController();

  // Idempotency: find by handle across the site.
  try {
    const existing = await components.findComponent(comp.handle);
    const c = existing.result?.component;
    if (c?.id !== undefined) {
      console.log(`✓ Component "${comp.handle}" already exists (id ${c.id}, kind ${c.kind}, family ${c.productFamilyId})`);
      return;
    }
  } catch (err) {
    if (!(err instanceof ApiError) || err.statusCode !== 404) {
      if (err instanceof ApiError) {
        throw new Error(`findComponent("${comp.handle}") failed (HTTP ${err.statusCode}): ${err.body}`);
      }
      throw err;
    }
  }

  const body: CreateMeteredComponent = {
    meteredComponent: {
      name: comp.name,
      handle: comp.handle,
      unitName: comp.unitName,
      pricingScheme: PricingScheme.PerUnit,
      taxable: false,
      prices: [{ startingQuantity: 1, unitPrice: comp.unitPrice }],
    },
  };
  // createMeteredComponent requires the NUMERIC product family id.
  const created = await components.createMeteredComponent(String(familyId), body);
  const c = created.result?.component;
  if (c?.id === undefined) throw new Error(`Component creation for "${comp.handle}" returned no id`);
  console.log(`+ Created metered component "${comp.handle}" (id ${c.id}, family ${c.productFamilyId}, $${comp.unitPrice}/${comp.unitName})`);
}

async function main(): Promise<void> {
  console.log(`Seeding Maxio site "${config.maxio.siteSubdomain}" (${config.maxio.environment})…`);
  const ensuredFamilyId = await ensureProductFamily();
  const familyKey = `handle:${FAMILY_HANDLE}`;
  for (const plan of PLANS) {
    await ensureProduct(familyKey, plan);
  }
  const componentFamilyId = await resolveProductsFamilyId(ensuredFamilyId);
  for (const comp of METERED_COMPONENTS) {
    await ensureMeteredComponent(componentFamilyId, comp);
  }
  console.log('\nSeed complete. Plans:');
  for (const plan of PLANS) {
    console.log(`  • ${plan.handle.padEnd(6)} ${plan.name.padEnd(12)} $${(plan.priceInCents / 100).toFixed(2)}/mo`);
  }
  console.log('Components:');
  for (const comp of METERED_COMPONENTS) {
    console.log(`  • ${comp.handle.padEnd(18)} ${comp.name.padEnd(16)} $${comp.unitPrice}/${comp.unitName} (metered)`);
  }
}

main().catch((err) => {
  console.error('\nSeed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

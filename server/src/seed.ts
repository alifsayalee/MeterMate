import {
  ApiError,
  type CreateOrUpdateProductRequest,
  type CreateProductFamilyRequest,
  IntervalUnit,
} from '@maxio-com/advanced-billing-sdk';
import { config } from './config.js';
import { productFamiliesController, productsController } from './maxioClient.js';

/**
 * Phase-1 seed. Creates (idempotently) the product family and the two recurring
 * plans UC1 subscribes against: `basic` ($99/mo) and `pro` ($299/mo). Metered /
 * event-based components are seeded later, when their use cases (UC2) are built.
 *
 * Idempotent: existing handles are detected via readProductByHandle /
 * listProductFamilies and left untouched, so re-running is safe.
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

async function main(): Promise<void> {
  console.log(`Seeding Maxio site "${config.maxio.siteSubdomain}" (${config.maxio.environment})…`);
  await ensureProductFamily();
  const familyKey = `handle:${FAMILY_HANDLE}`;
  for (const plan of PLANS) {
    await ensureProduct(familyKey, plan);
  }
  console.log('\nSeed complete. Plans:');
  for (const plan of PLANS) {
    console.log(`  • ${plan.handle.padEnd(6)} ${plan.name.padEnd(12)} $${(plan.priceInCents / 100).toFixed(2)}/mo`);
  }
}

main().catch((err) => {
  console.error('\nSeed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

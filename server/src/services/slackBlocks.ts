import type {
  DigestResult,
  InvoiceResult,
  LifecycleResult,
  PlanChangePreview,
  PlanChangeResult,
  SubscriptionResult,
  UsageResult,
} from '../types.js';

/**
 * Pure Block Kit builders. Each returns a Slack `blocks` array and touches no
 * SDK or network — so they are trivially unit-testable. slackService serializes
 * the returned array when posting.
 */

export type SlackBlock = Record<string, unknown>;

function header(text: string): SlackBlock {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } };
}

function section(markdown: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text: markdown } };
}

function context(markdown: string): SlackBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text: markdown }] };
}

function fields(pairs: Array<[string, string]>): SlackBlock {
  return {
    type: 'section',
    fields: pairs.map(([k, v]) => ({ type: 'mrkdwn', text: `*${k}*\n${v}` })),
  };
}

function linkButton(text: string, url: string): SlackBlock {
  return {
    type: 'actions',
    elements: [{ type: 'button', text: { type: 'plain_text', text, emoji: true }, url }],
  };
}

/** Format integer cents as a USD string, e.g. 9900 → "$99.00". */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Channel-opened banner posted once when a transaction channel is created. */
export function buildTransactionStarted(args: {
  consultantName: string;
  clientName: string;
  type: string;
}): SlackBlock[] {
  return [
    header(':wave: Transaction started'),
    fields([
      ['Consultant', args.consultantName],
      ['Client', args.clientName],
      ['Type', args.type],
    ]),
  ];
}

/** UC1 in-progress message. */
export function buildBookingProgress(planLabel: string): SlackBlock[] {
  return [
    section(':hourglass_flowing_sand: *Booking started* — creating your subscription…'),
    context(`Plan: *${planLabel}*`),
  ];
}

/** UC1 completion message with billing facts + a "View in Maxio" button. */
export function buildSubscriptionActive(args: {
  clientName: string;
  result: SubscriptionResult;
}): SlackBlock[] {
  const { result } = args;
  const nextBill = result.nextAssessmentAt
    ? new Date(result.nextAssessmentAt).toUTCString()
    : 'n/a';
  return [
    header(':tada: Subscription active'),
    fields([
      ['Customer', args.clientName],
      ['Plan', result.planName],
      ['MRR', `${formatCents(result.mrrInCents)}/mo`],
      ['State', result.state],
      ['Collection', result.collectionMethod],
      ['Next bill', nextBill],
    ]),
    linkButton('View in Maxio', result.maxioUrl),
  ];
}

/** UC2 in-progress message. */
export function buildUsageProgress(componentLabel: string): SlackBlock[] {
  return [section(`:bar_chart: *Recording usage* against *${componentLabel}*…`)];
}

/** UC2 completion message with quantity + running period total. */
export function buildUsageRecorded(args: { result: UsageResult }): SlackBlock[] {
  const { result } = args;
  const unit = result.unitName ?? 'units';
  const qty = `${result.recordedQuantity} ${unit}`;
  const period =
    result.periodTotal === null ? 'n/a (event-based)' : `${result.periodTotal} ${unit}`;
  const fieldPairs: Array<[string, string]> = [
    ['Component', result.componentHandle],
    ['Recorded', qty],
    ['Period total', period],
  ];
  if (result.memo) fieldPairs.push(['Memo', result.memo]);
  return [
    header(':white_check_mark: Usage recorded'),
    fields(fieldPairs),
    context('Accrues to the next invoice.'),
  ];
}

/** UC3 preview message — the prorated delta before committing. */
export function buildPlanChangePreview(args: {
  targetHandle: string;
  timing: string;
  preview: PlanChangePreview;
}): SlackBlock[] {
  const { preview } = args;
  return [
    header(':mag: Plan change preview'),
    fields([
      ['Target plan', args.targetHandle],
      ['Timing', args.timing === 'prorate' ? 'Prorate now' : 'At next renewal'],
      ['Prorated charge', formatCents(preview.chargeInCents)],
      ['Credit applied', formatCents(preview.creditAppliedInCents)],
      ['Due now', formatCents(preview.paymentDueInCents)],
    ]),
    context(
      args.timing === 'prorate'
        ? 'This amount will be charged immediately on confirm.'
        : 'At-renewal changes are not prorated; the full new price applies next period.',
    ),
  ];
}

/** UC3 completion message — old → new with effective date + proration. */
export function buildPlanChanged(args: { result: PlanChangeResult }): SlackBlock[] {
  const { result } = args;
  const effective = result.scheduled
    ? result.effectiveDate
      ? `Next renewal (${new Date(result.effectiveDate).toUTCString()})`
      : 'Next renewal'
    : 'Immediately';
  const fieldPairs: Array<[string, string]> = [
    ['From', result.oldPlanName],
    ['To', result.newPlanName],
    ['Timing', result.scheduled ? 'At next renewal (no proration)' : 'Prorated now'],
    ['Effective', effective],
    ['State', result.state],
  ];
  if (result.paymentDueInCents !== null) {
    fieldPairs.push(['Charged now', formatCents(result.paymentDueInCents)]);
  }
  return [
    header(':arrows_counterclockwise: Plan changed'),
    fields(fieldPairs),
    linkButton('View in Maxio', result.maxioUrl),
  ];
}

/** UC4 in-progress message. */
export function buildLifecycleProgress(actionLabel: string): SlackBlock[] {
  return [section(`:vertical_traffic_light: *${actionLabel}* in progress…`)];
}

/** UC4 completion message — the state transition + reason + effective date. */
export function buildLifecycleDone(args: { result: LifecycleResult }): SlackBlock[] {
  const { result } = args;
  const transition = `${result.previousState} → ${result.newState}`;
  const fieldPairs: Array<[string, string]> = [['Transition', transition]];
  if (result.action === 'cancel') {
    fieldPairs.push([
      'Cancellation',
      result.cancelAtEndOfPeriod ? 'At end of period' : 'Immediate',
    ]);
  }
  if (result.effectiveDate) {
    fieldPairs.push(['Effective', new Date(result.effectiveDate).toUTCString()]);
  }
  if (result.reasonCode) fieldPairs.push(['Reason', result.reasonCode]);
  return [
    header(`:vertical_traffic_light: ${transition}`),
    fields(fieldPairs),
    linkButton('View in Maxio', result.maxioUrl),
  ];
}

/** UC5 in-progress message. */
export function buildInvoiceProgress(): SlackBlock[] {
  return [section(':receipt: *Issuing invoice*…')];
}

/** UC5 completion message with amount due, due date, and a Pay Invoice button. */
export function buildInvoiceIssued(args: { result: InvoiceResult }): SlackBlock[] {
  const { result } = args;
  const fieldPairs: Array<[string, string]> = [
    ['Invoice', result.invoiceNumber ?? result.invoiceUid],
    ['Amount due', `$${result.dueAmount}`],
    ['Due date', result.dueDate ?? 'on issue'],
    ['Status', result.status],
  ];
  if (result.emailed && result.recipientEmail) {
    fieldPairs.push(['Emailed to', result.recipientEmail]);
  }
  const blocks: SlackBlock[] = [header(':receipt: Invoice issued'), fields(fieldPairs)];
  if (result.publicUrl) blocks.push(linkButton('Pay Invoice', result.publicUrl));
  return blocks;
}

/** UC6 — per-consultant billing digest. */
export function buildDigest(args: { result: DigestResult }): SlackBlock[] {
  const { result } = args;
  return [
    header(':chart_with_upwards_trend: Billing digest'),
    context(`Consultant *${result.consultantName}* · last ${result.windowDays} days`),
    fields([
      ['Active subscriptions', String(result.activeCount)],
      ['MRR', `${formatCents(result.mrrInCents)}/mo`],
      ['Total subscriptions', String(result.totalSubscriptions)],
      ['New signups', String(result.newSignups)],
      ['Churned', String(result.churned)],
      ['Overdue invoices', String(result.overdueInvoices)],
    ]),
    context(
      ':information_source: Reporting data is for reconciliation, not real-time confirmation — counts may lag live state slightly.',
    ),
  ];
}

/** Generic failure message for any use case. */
export function buildFailure(args: { useCase: string; error: string }): SlackBlock[] {
  return [
    header(`:warning: ${args.useCase} failed`),
    section(`*Reason:* ${args.error}`),
  ];
}

/** Note added when a party could not be invited (tier-2 fallback). */
export function buildEmailFallbackNote(clientName: string): SlackBlock[] {
  return [
    context(
      `:email: ${clientName} isn't a member of this Slack workspace — they'll be notified by email instead.`,
    ),
  ];
}

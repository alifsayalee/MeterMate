import type { SubscriptionResult, UsageResult } from '../types.js';

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

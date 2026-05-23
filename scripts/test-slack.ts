/**
 * One-off script to verify SLACK_WEBHOOK_URL works.
 * Run: `npx tsx scripts/test-slack.ts`
 *
 * Sends a sample change-report notification with two synthetic text changes.
 * Safe to delete after verification — kept around as a quick debug helper.
 */

import 'dotenv/config';
import { sendSlackChangeNotification, isSlackConfigured } from '../src/notifications/slack.js';

if (!isSlackConfigured()) {
  console.error('✗ SLACK_WEBHOOK_URL is not set in your environment. Nothing to test.');
  process.exit(1);
}

console.log('Sending test notification to Slack...');

await sendSlackChangeNotification({
  site: 'test.formping.local',
  rootUrl: 'https://example.com',
  checkedAt: new Date().toISOString(),
  previousSnapshot: 'snapshot-test.json',
  pagesScanned: 3,
  pagesChanged: 1,
  changesFound: 2,
  summary:
    '🧪 Test notification from FormPing — if you can read this in your Slack DMs, the integration is working end-to-end.',
  summaryProvider: 'test runner',
  details: [
    {
      url: 'https://example.com/about',
      changes: [],
      severity: 'medium',
      textChanges: [
        {
          type: 'edited',
          kind: 'heading',
          before: 'Old hero text',
          after: 'New hero text',
          meta: 'H1',
          location: { section: 'Hero', tag: 'h1' },
        },
        {
          type: 'added',
          kind: 'paragraph',
          after: 'A brand-new paragraph that was added to the page since last snapshot.',
          location: { heading: 'About us', tag: 'p' },
        },
      ],
    },
  ],
});

console.log('✓ Test sent. Check your Slack DMs.');

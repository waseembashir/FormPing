/**
 * Reading a form plugin's answer to "did that submission go through?".
 *
 * This is the highest-stakes judgement in the engine. Everything else describes
 * a form; this decides whether a real message reached somebody's inbox — and
 * the answer becomes "your contact form is working", a green tick on a client
 * status page, and the reason an alert does not fire.
 *
 * The two ways to be wrong are not equal. A false `failure` raises an alarm
 * somebody investigates and dismisses. A false `success` retires an alarm that
 * should have rung: the form stays broken, the leads keep not arriving, and the
 * app says everything is fine. So `unknown` is a real answer here, and the
 * default — never a guess dressed as a verdict.
 *
 * Each shape below is one plugin's convention, drawn from the wild. The reason
 * there are so many is that there is no standard: every form plugin invented
 * its own, which is exactly why "it returned 200" proves nothing.
 */

import { describe, it, expect } from 'vitest';
import { parseJsonOutcome } from '../../src/forms/submitForm.js';

describe('a response that is not JSON at all', () => {
  it('is unknown, not a failure', () => {
    // The common case: the form posts normally and the server answers with a
    // thank-you page. That is very often a SUCCESS, detected elsewhere by the
    // page that comes back — so calling it a failure here would invent one.
    expect(parseJsonOutcome('<!doctype html><h1>Thanks!</h1>')).toBe('unknown');
    expect(parseJsonOutcome('')).toBe('unknown');
  });

  it('is unknown for JSON that is not an object', () => {
    expect(parseJsonOutcome('"ok"')).toBe('unknown');
    expect(parseJsonOutcome('null')).toBe('unknown');
    expect(parseJsonOutcome('[1,2,3]')).toBe('unknown');
  });
});

describe('a plugin that answers with a success flag', () => {
  it('reads true as success and false as failure', () => {
    // FluentForms, WPForms, Forminator.
    expect(parseJsonOutcome('{"success":true}')).toBe('success');
    expect(parseJsonOutcome('{"success":false}')).toBe('failure');
  });

  it('ignores a truthy value that is not actually true', () => {
    // "success":"yes" is not the convention, and treating any truthy value as
    // success is how an error payload carrying `success: "no"` would pass.
    expect(parseJsonOutcome('{"success":"yes"}')).toBe('unknown');
    expect(parseJsonOutcome('{"success":1}')).toBe('unknown');
  });
});

describe('a plugin that answers with a status string', () => {
  it('recognises the ways plugins say it worked', () => {
    // Contact Form 7 says mail_sent; others say ok or sent.
    for (const status of ['success', 'ok', 'mail_sent', 'sent']) {
      expect(parseJsonOutcome(`{"status":"${status}"}`)).toBe('success');
    }
  });

  it('recognises the ways they say it did not', () => {
    // `spam` and `aborted` matter: the request succeeded, the message did not
    // arrive. A transport-level check would call both of those a working form.
    for (const status of ['error', 'fail', 'mail_failed', 'spam', 'aborted', 'invalid']) {
      expect(parseJsonOutcome(`{"status":"${status}"}`)).toBe('failure');
    }
  });

  it('does not care about case', () => {
    expect(parseJsonOutcome('{"status":"MAIL_SENT"}')).toBe('success');
    expect(parseJsonOutcome('{"status":"Spam"}')).toBe('failure');
  });

  it('is unknown for a status it does not recognise', () => {
    // "queued" might mean sent, or might mean sitting in a queue that never
    // drains. Without knowing the plugin, neither answer is honest.
    expect(parseJsonOutcome('{"status":"queued"}')).toBe('unknown');
    expect(parseJsonOutcome('{"status":"pending"}')).toBe('unknown');
  });
});

describe('plugins that bury the answer one level down', () => {
  it('reads FluentForms-style result.status', () => {
    expect(parseJsonOutcome('{"result":{"status":"success"}}')).toBe('success');
    expect(parseJsonOutcome('{"result":{"status":"error"}}')).toBe('failure');
  });

  it('reads Ninja-Forms-style data.status', () => {
    expect(parseJsonOutcome('{"data":{"status":"ok"}}')).toBe('success');
    expect(parseJsonOutcome('{"data":{"status":"fail"}}')).toBe('failure');
  });

  it('is unknown when the nested value is not a status it knows', () => {
    expect(parseJsonOutcome('{"result":{"status":"maybe"}}')).toBe('unknown');
    expect(parseJsonOutcome('{"data":{"id":42}}')).toBe('unknown');
  });
});

describe('the shape of an answer nobody anticipated', () => {
  it('is unknown rather than optimistic', () => {
    // The rule the whole module rests on. A plugin we have never met returns
    // 200 and some JSON; reading that as success would mean every unrecognised
    // form on earth reports as working.
    expect(parseJsonOutcome('{"message":"Thanks for getting in touch"}')).toBe('unknown');
    expect(parseJsonOutcome('{"errors":[]}')).toBe('unknown');
    expect(parseJsonOutcome('{}')).toBe('unknown');
  });

  it('prefers an explicit failure flag over a cheerful message beside it', () => {
    // Real payloads carry both. The flag is the plugin's own verdict; the
    // message is for a human and is often written before the outcome is known.
    expect(parseJsonOutcome('{"success":false,"message":"Thanks!"}')).toBe('failure');
  });
});

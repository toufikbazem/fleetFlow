/**
 * Email rendering — FF-1206 (FF-203, NTF).
 *
 * Two things are worth testing here and one is not. The exact markup is not:
 * it is presentational, and a test asserting on inline styles just breaks every
 * time someone adjusts the padding. What matters is:
 *
 *   1. **Escaping.** Notification bodies carry user-supplied text — a vendor
 *      name, a driver name, a maintenance title. Any of those can contain a
 *      quote or an angle bracket, and some email clients do render script.
 *   2. **The text alternative.** A multipart message with only an HTML part
 *      scores worse with spam filters, and this product fails silently if its
 *      reminders land in spam (PRD risk register). A text part that quietly
 *      drops the action URL is the same failure in slow motion.
 */

import { describe, expect, it } from 'vitest';
import { renderHtml, renderText, type EmailContent } from './layout.js';

const base: EmailContent = {
  heading: 'Maintenance due soon',
  paragraphs: ['"Oil and filter change" on 12345-A-6 is due 2026-08-23.'],
  action: { label: 'Open FleetFlow', url: 'https://fleet.example.com/maintenance?vehicleId=abc' },
  footnotes: ['This link expires in 30 minutes.'],
};

describe('renderHtml', () => {
  it('produces a complete document', () => {
    const html = renderHtml(base);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('</html>');
    expect(html).toContain('lang="en"');
  });

  it('includes the heading, body, action and footnotes', () => {
    const html = renderHtml(base);
    expect(html).toContain('Maintenance due soon');
    expect(html).toContain('12345-A-6');
    expect(html).toContain('Open FleetFlow');
    expect(html).toContain('This link expires in 30 minutes.');
  });

  it('repeats the raw URL for clients that break the button', () => {
    const html = renderHtml(base);
    const occurrences = html.split(base.action?.url ?? '').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('escapes angle brackets in the body', () => {
    const html = renderHtml({
      heading: 'Vendor updated',
      paragraphs: ['<script>alert(1)</script>'],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes a quote that would otherwise break out of an attribute', () => {
    const html = renderHtml({
      heading: 'Maintenance',
      paragraphs: ['ok'],
      action: { label: 'Open', url: 'https://x.test/"onmouseover="alert(1)' },
    });
    // The dangerous form is a bare `"` closing the href and starting a new
    // attribute. Escaped, it stays inside the value.
    expect(html).not.toContain('"onmouseover="');
    expect(html).toContain('&quot;onmouseover=&quot;');
  });

  it('escapes the heading, which is also the <title>', () => {
    const html = renderHtml({ heading: '</title><script>x</script>', paragraphs: [] });
    expect(html).not.toContain('</title><script>');
  });

  it('escapes an ampersand exactly once', () => {
    // Double-escaping shows up in the recipient's inbox as `Auto &amp;amp; Sons`.
    const html = renderHtml({ heading: 'Auto & Sons', paragraphs: [] });
    expect(html).toContain('Auto &amp; Sons');
    expect(html).not.toContain('&amp;amp;');
  });

  it('escapes every paragraph, not only the first', () => {
    const html = renderHtml({ heading: 'x', paragraphs: ['safe', '<b>unsafe</b>'] });
    expect(html).not.toContain('<b>unsafe</b>');
    expect(html).toContain('&lt;b&gt;unsafe&lt;/b&gt;');
  });

  it('escapes footnotes too', () => {
    const html = renderHtml({ heading: 'x', paragraphs: [], footnotes: ['<img src=x onerror=1>'] });
    expect(html).not.toContain('<img src=x');
  });

  it('omits the action block entirely when there is none', () => {
    const html = renderHtml({ heading: 'No action', paragraphs: ['Nothing to do.'] });
    expect(html).not.toContain('If the button does not work');
  });
});

describe('renderText', () => {
  it('carries the heading, body and action URL', () => {
    const text = renderText(base);
    expect(text).toContain('Maintenance due soon');
    expect(text).toContain('12345-A-6');
    // The URL is the whole point of the text part: a recipient whose client
    // strips HTML must still be able to act.
    expect(text).toContain('https://fleet.example.com/maintenance?vehicleId=abc');
  });

  it('does not HTML-escape — it is not HTML', () => {
    // `&amp;` in a plain-text email is a visible defect.
    const text = renderText({ heading: 'Auto & Sons', paragraphs: ['5 > 3'] });
    expect(text).toContain('Auto & Sons');
    expect(text).toContain('5 > 3');
    expect(text).not.toContain('&amp;');
  });

  it('underlines the heading to its own length', () => {
    const text = renderText({ heading: 'Hello', paragraphs: [] });
    expect(text.split('\n')[1]).toBe('=====');
  });

  it('always ends with the do-not-reply notice', () => {
    expect(renderText(base).trimEnd()).toMatch(/do not reply to it\.$/);
  });

  it('handles an empty body without producing a blank message', () => {
    const text = renderText({ heading: 'Subject only', paragraphs: [] });
    expect(text).toContain('Subject only');
    expect(text.trim().length).toBeGreaterThan(0);
  });
});

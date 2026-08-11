/**
 * Email HTML shell — FF-203.
 *
 * Deliberately plain, table-based, inline-styled HTML. Email clients are not
 * browsers: Outlook renders with Word's engine, Gmail strips `<style>` blocks,
 * and flexbox is unavailable almost everywhere. The 1990s-looking markup below
 * is what actually survives that.
 *
 * Every message also carries a plain-text alternative. That is not politeness —
 * a multipart message with only an HTML part scores worse with spam filters,
 * and FleetFlow's whole notification value proposition dies silently if these
 * land in spam (PRD risk register).
 */

const BRAND = '#1d4ed8';
const INK = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const CANVAS = '#f3f4f6';

export interface EmailAction {
  label: string;
  url: string;
}

export interface EmailContent {
  /** Shown as the <h1> and used as the subject unless one is given separately. */
  heading: string;
  /** One paragraph per entry. Plain text; no markup. */
  paragraphs: string[];
  action?: EmailAction;
  /** Small print under the action — expiry warnings, "if you didn't ask for this". */
  footnotes?: string[];
}

/** Minimal escaping. Every value here is ours, but templates take user data. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderHtml(content: EmailContent): string {
  const paragraphs = content.paragraphs
    .map(
      (text) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK};">${escapeHtml(text)}</p>`,
    )
    .join('');

  // A table wrapping the anchor: Outlook ignores padding on inline elements, so
  // a plain padded <a> collapses to unclickable text there.
  const action = content.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
         <tr>
           <td align="center" bgcolor="${BRAND}" style="border-radius:6px;">
             <a href="${escapeHtml(content.action.url)}"
                style="display:inline-block;padding:12px 24px;font-family:Arial,Helvetica,sans-serif;
                       font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">
               ${escapeHtml(content.action.label)}
             </a>
           </td>
         </tr>
       </table>`
    : '';

  // The raw URL is repeated below the button: some clients rewrite or break
  // links, and a user who cannot click still needs a way through.
  const fallbackLink = content.action
    ? `<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:${MUTED};word-break:break-all;">
         If the button does not work, copy this address into your browser:<br>
         ${escapeHtml(content.action.url)}
       </p>`
    : '';

  const footnotes = (content.footnotes ?? [])
    .map(
      (text) =>
        `<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:${MUTED};">${escapeHtml(text)}</p>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(content.heading)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${CANVAS};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background-color:${CANVAS};padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="max-width:560px;background-color:#ffffff;border:1px solid ${BORDER};
                        border-radius:8px;font-family:Arial,Helvetica,sans-serif;">
            <tr>
              <td style="padding:24px 28px 8px;">
                <div style="font-size:18px;font-weight:bold;color:${BRAND};">FleetFlow</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 24px;">
                <h1 style="margin:8px 0 16px;font-size:20px;line-height:1.3;color:${INK};">
                  ${escapeHtml(content.heading)}
                </h1>
                ${paragraphs}
                ${action}
                ${fallbackLink}
                ${footnotes}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 24px;border-top:1px solid ${BORDER};">
                <p style="margin:0;font-size:12px;line-height:1.5;color:${MUTED};">
                  This is an automated message from FleetFlow. Please do not reply to it.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** The plain-text alternative, built from the same content object. */
export function renderText(content: EmailContent): string {
  const lines: string[] = [content.heading, '='.repeat(content.heading.length), ''];

  for (const paragraph of content.paragraphs) {
    lines.push(paragraph, '');
  }

  if (content.action) {
    lines.push(`${content.action.label}:`, content.action.url, '');
  }

  for (const note of content.footnotes ?? []) {
    lines.push(note);
  }

  lines.push('', 'This is an automated message from FleetFlow. Please do not reply to it.');
  return lines.join('\n');
}

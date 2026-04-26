import * as cheerio from 'cheerio';

export function loadHtml(html: string): cheerio.CheerioAPI {
  return cheerio.load(html);
}

/** Extract all visible text from a Cheerio element/document */
export function extractText($: cheerio.CheerioAPI, selector = 'body'): string {
  return $(selector).text().replace(/\s+/g, ' ').trim();
}

/** Collect all <a> tags with href */
export function extractLinks($: cheerio.CheerioAPI): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (href) links.push({ href, text });
  });
  return links;
}

/** Return page title */
export function extractTitle($: cheerio.CheerioAPI): string {
  return $('title').first().text().trim();
}

/** Return first H1 or H2 text */
export function extractHeading($: cheerio.CheerioAPI): string {
  return ($('h1').first().text() || $('h2').first().text()).replace(/\s+/g, ' ').trim();
}

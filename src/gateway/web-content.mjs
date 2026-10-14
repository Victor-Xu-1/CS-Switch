import { load } from 'cheerio';
import { pdfText } from '../protocol/documents.mjs';
import { invariant } from '../core/errors.mjs';

export async function webContent(resource, { signal, maxTokens = 8000 } = {}) {
  let text, title = resource.url, links = [];
  if (resource.mediaType === 'application/pdf' || resource.data.subarray(0, 5).toString() === '%PDF-') text = await pdfText(resource.data, signal);
  else if (['text/html', 'application/xhtml+xml', ''].includes(resource.mediaType)) {
    const $ = load(resource.data.toString('utf8'));
    title = $('head > title').first().text().trim() || title;
    $('script,style,noscript,template,nav,footer,header,form,svg').remove();
    $('[hidden],[aria-hidden="true"]').remove();
    $('a[href]').each((_index, element) => {
      try { const url = new URL($(element).attr('href'), resource.url); if (['http:', 'https:'].includes(url.protocol)) links.push({ title: $(element).text().trim().slice(0, 200), url: url.href }); } catch { /* malformed reference */ }
    });
    $('p,div,section,article,h1,h2,h3,h4,li,tr,br').each((_index, element) => $(element).append('\n'));
    text = ($('main').length ? $('main').text() : $('article').length ? $('article').text() : $('body').text()).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  } else {
    invariant(resource.mediaType.startsWith('text/') || ['application/json', 'application/xml'].includes(resource.mediaType), 'unsupported_content_type', 'Only HTML, text, JSON/XML and PDF documents are supported.');
    text = resource.data.toString('utf8');
  }
  invariant(text?.trim(), 'url_not_accessible', 'The page returned no readable content. JavaScript rendering or OCR may be required.');
  if (links.length) text += '\n\nPage links:\n' + links.slice(0, 20).map(link => `${link.title}: ${link.url}`).join('\n');
  const budget = Math.min(Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : 8000, 32000);
  // UTF-8 bytes conservatively bound tokens without guessing a model tokenizer.
  const bytes = Buffer.from(text), truncated = bytes.length > budget;
  const excerpt = truncated ? new TextDecoder().decode(bytes.subarray(0, Math.max(0, budget - 100))) + '\n[Content excerpt: remaining text exceeded the requested budget.]' : text;
  return { title: title.slice(0, 500), text: excerpt, links: links.slice(0, 100), truncated };
}

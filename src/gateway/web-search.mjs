import { load } from 'cheerio';
import { invariant } from '../core/errors.mjs';
import { publicUrl, domainAllowed } from './public-web.mjs';

export async function webSearch(request, query, definition = {}, signal) {
  invariant(typeof query === 'string' && query.trim().length > 0 && query.length <= 2000, 'search_query', 'A non-empty search query is required.');
  const abort = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
  abort.throwIfAborted();
  const response = await request(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'user-agent': 'CS-Switch (local scientific workbench; web search)' }, signal: abort, redirect: 'error',
  });
  if (!response.ok) { await response.body?.cancel(); invariant(false, 'search_unavailable', `Web search returned HTTP ${response.status}.`, 502); }
  let text = ''; const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    abort.throwIfAborted(); text += decoder.decode(chunk, { stream: true });
    invariant(text.length < 4 * 1024 * 1024, 'search_size', 'Search response exceeds its size limit.', 502);
  }
  text += decoder.decode();
  const $ = load(text), results = []; let parsed = 0;
  $('.result').each((_index, element) => {
    const anchor = $(element).find('.result__a').first(), href = anchor.attr('href'); if (!href) return;
    let url;
    try { const target = new URL(href, 'https://html.duckduckgo.com'); url = publicUrl(target.searchParams.get('uddg') || target.href); } catch { return; }
    parsed++;
    if (!domainAllowed(url, definition)) return;
    results.push({ type: 'web_search_result', url: url.href, title: anchor.text().trim(), page_age: null,
      snippet: $(element).find('.result__snippet').text().trim().slice(0, 1200) });
  });
  invariant(parsed || /No results found|No more results found/i.test(text), 'search_unavailable', 'Search returned a challenge or an unrecognized page. No results were fabricated.', 502);
  return results.slice(0, 8);
}

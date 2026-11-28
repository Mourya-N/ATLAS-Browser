import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModelProvider } from '@main/agent/providers/model-provider';
import { LavrayDatabase } from '@main/db/database';
import { AgentRepository } from '@main/db/repositories/agent-repo';
import { BrowserRepository } from '@main/db/repositories/browser-repo';
import { PlatformRepository } from '@main/db/repositories/platform-repo';
import { MemoryService } from '@main/memory/memory-service';
import { AuditLogger } from '@main/security/audit-logger';
import { SecretVault } from '@main/security/secrets';
import { CloudClientService } from '@main/cloud/cloud-client';
import { LocalSearchIndexService } from '@main/cloud/local-search-index';
import { WebDiscoveryEngine, type FetchLike } from '@main/cloud/web-discovery';
import { evaluateInstantTool } from '@main/cloud/instant-tools';
import { generateGeminiGroundedOverview } from '@main/cloud/gemini-search-grounding';

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('LAVRAY Built-in Search Engine (WebDiscovery + Local FTS5 Index + Extractive Synthesis)', () => {
  let tmpDir = '';

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lavray-search-engine-test-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers and normalizes results from open web APIs and optional SearXNG without scraping SERPs', async () => {
    const mockFetch: FetchLike = async (url) => {
      if (url.includes('en.wikipedia.org/w/api.php')) {
        return jsonResponse({
          query: {
            search: [
              {
                title: 'TypeScript',
                snippet: '<span class="searchmatch">TypeScript</span> is a strongly typed language.',
                timestamp: '2026-10-01T00:00:00Z'
              }
            ]
          }
        });
      }
      if (url.includes('api.duckduckgo.com')) {
        return jsonResponse({
          Heading: 'TypeScript',
          AbstractText: 'TypeScript is a free and open-source high-level programming language.',
          AbstractURL: 'https://www.typescriptlang.org/',
          AbstractSource: 'Wikipedia'
        });
      }
      if (url.includes('hn.algolia.com')) {
        return jsonResponse({
          hits: [
            {
              objectID: '12345',
              title: 'TypeScript 6 Type Inference Notes',
              url: 'https://devblogs.microsoft.com/typescript/',
              points: 240,
              num_comments: 42,
              created_at: '2026-11-01T10:00:00Z',
              author: 'alice'
            }
          ]
        });
      }
      if (url.includes('developer.mozilla.org')) {
        return jsonResponse({
          documents: [
            {
              title: 'JavaScript',
              mdn_url: '/en-US/docs/Web/JavaScript',
              summary: 'JavaScript (JS) is a lightweight interpreted programming language.'
            }
          ]
        });
      }
      if (url.includes('api.stackexchange.com')) {
        return jsonResponse({
          items: [
            {
              title: 'How do TypeScript decorators work?',
              link: 'https://stackoverflow.com/questions/123/typescript-decorators',
              score: 99,
              answer_count: 5,
              is_answered: true,
              tags: ['typescript', 'decorators']
            }
          ]
        });
      }
      if (url.includes('api.github.com')) {
        return jsonResponse({
          items: [
            {
              full_name: 'microsoft/TypeScript',
              html_url: 'https://github.com/microsoft/TypeScript',
              description: 'TypeScript is a superset of JavaScript that compiles to clean JavaScript output.',
              stargazers_count: 100000,
              language: 'TypeScript'
            }
          ]
        });
      }
      if (url.includes('export.arxiv.org')) {
        return new Response(
          `<?xml version="1.0"?><feed><entry><title>Gradual Typing in TypeScript</title><id>https://arxiv.org/abs/2601.00001</id><summary>Analysis of structural subtyping.</summary><published>2026-02-01T00:00:00Z</published></entry></feed>`,
          { status: 200, headers: { 'Content-Type': 'application/atom+xml' } }
        );
      }
      if (url.includes('searx.local.example')) {
        return jsonResponse({
          results: [
            {
              title: 'TypeScript Handbook',
              url: 'https://www.typescriptlang.org/docs/handbook/intro.html',
              content: 'The TypeScript Handbook is a comprehensive guide.'
            }
          ]
        });
      }
      if (url.includes('api.marginalia.nu')) {
        return jsonResponse({
          results: [
            {
              title: 'TypeScript Type System Notes',
              url: 'https://indie.example.org/ts-notes',
              description: 'Independent article on TypeScript structural typing.'
            }
          ]
        });
      }
      if (url.includes('api.openalex.org')) {
        return jsonResponse({
          results: [
            {
              id: 'https://openalex.org/W12345',
              doi: 'https://doi.org/10.1000/ts-paper',
              title: 'TypeScript Adoption Study',
              publication_date: '2026-03-10',
              cited_by_count: 15,
              abstract_inverted_index: { Empirical: [0], study: [1], of: [2], TypeScript: [3] }
            }
          ]
        });
      }
      if (url.includes('en.wikipedia.org/api/rest_v1/page/summary')) {
        return jsonResponse({
          title: 'TypeScript',
          description: 'Programming language developed by Microsoft',
          extract: 'TypeScript is a free and open-source high-level programming language.',
          thumbnail: { source: 'https://upload.wikimedia.org/ts.png' },
          content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/TypeScript' } }
        });
      }
      return new Response('Not found', { status: 404 });
    };

    const discovery = new WebDiscoveryEngine(mockFetch);
    const result = await discovery.discover({
      query: 'TypeScript',
      mode: 'research',
      searxngEndpointUrl: 'https://searx.local.example'
    });

    expect(result.instantAnswer?.title).toBe('TypeScript');
    expect(result.instantAnswer?.thumbnailUrl).toBe('https://upload.wikimedia.org/ts.png');
    expect(result.candidates.some((c) => c.sourceProvider === 'wikipedia_api')).toBe(true);
    expect(result.candidates.some((c) => c.sourceProvider === 'marginalia_api')).toBe(true);
    expect(result.candidates.some((c) => c.sourceProvider === 'openalex_api')).toBe(true);
    expect(result.candidates.some((c) => c.sourceProvider === 'mdn_docs_api')).toBe(true);
    expect(result.candidates.some((c) => c.sourceProvider === 'github_repos_api')).toBe(true);
    expect(result.candidates.some((c) => c.sourceProvider === 'arxiv_api')).toBe(true);
    expect(result.candidates.some((c) => c.sourceProvider === 'searxng_custom')).toBe(true);
    expect(result.candidates[0].snippet).not.toContain('<span');
  });

  it('evaluates zero-latency calculator, unit conversions, timestamps, base conversions, and color inspector safely', () => {
    expect(evaluateInstantTool('(125 + 75) * 3')?.title).toBe('600');
    expect(evaluateInstantTool('15% of 240')?.title).toBe('36');
    expect(evaluateInstantTool('20% off 1500')?.title).toBe('1200');
    expect(evaluateInstantTool('100 c to f')?.title).toContain('212');
    expect(evaluateInstantTool('10 km to m')?.title).toContain('10000');
    expect(evaluateInstantTool('255 to hex')?.title).toBe('0xFF');
    expect(evaluateInstantTool('1764330000 to date')?.subtitle).toContain('Timestamp');
    expect(evaluateInstantTool('#2563eb')?.summary).toBe('RGB(37, 99, 235)');
    expect(evaluateInstantTool('1 / 0')).toBeNull();
    expect(evaluateInstantTool('process.exit(1)')).toBeNull();
  });

  it('parses Bing Web RSS, Google News RSS, and Gemini googleSearch grounding metadata cleanly', async () => {
    const mockRssFetch: FetchLike = async (url) => {
      if (url.includes('bing.com/search')) {
        return new Response(
          `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Gold Rate Today (28 Nov 2026) — Goodreturns</title><link>https://www.goodreturns.in/gold-rates/</link><description>Today 24K gold rate is ₹12,786 per gram.</description><pubDate>Sat, 28 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`,
          { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }
        );
      }
      if (url.includes('news.google.com/rss')) {
        return new Response(
          `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Gold Price Today Updates - BusinessLine</title><link>https://news.google.com/rss/articles/abc</link><source url="https://www.thehindubusinessline.com">BusinessLine</source><pubDate>Sat, 28 Nov 2026 11:00:00 GMT</pubDate></item></channel></rss>`,
          { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }
        );
      }
      return jsonResponse({});
    };

    const discovery = new WebDiscoveryEngine(mockRssFetch);
    const res = await discovery.discover({ query: 'gold rate today', mode: 'web' });
    expect(res.candidates.some((c) => c.sourceProvider === 'bing_web_rss' && c.url.includes('goodreturns.in'))).toBe(true);
    expect(res.candidates.some((c) => c.sourceProvider === 'google_news_rss')).toBe(true);

    let capturedHeaderKey = '';
    let capturedBody = '';
    const mockGeminiFetch: FetchLike = async (_url, init) => {
      capturedHeaderKey = String((init?.headers as Record<string, string>)?.['x-goog-api-key'] || '');
      capturedBody = String(init?.body || '');
      return jsonResponse({
        candidates: [
          {
            content: {
              parts: [{ text: 'Today **24K gold** is around **₹12,786 per gram**.\n\n- **22K Gold:** ~₹11,720 per gram' }]
            },
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: 'https://www.goodreturns.in/gold-rates/', title: 'Goodreturns Gold Rates' } },
                { web: { uri: 'https://groww.in/gold-rates', title: 'Groww Gold Rate Today' } }
              ],
              groundingSupports: [
                {
                  segment: { text: 'Today 24K gold is around ₹12,786 per gram.' },
                  groundingChunkIndices: [0]
                }
              ]
            }
          }
        ],
        usageMetadata: { promptTokenCount: 25, candidatesTokenCount: 40 }
      });
    };

    const overview = await generateGeminiGroundedOverview({
      apiKey: 'AIzaTestKey12345',
      query: 'gold rate today',
      fetchFn: mockGeminiFetch
    });
    expect(capturedHeaderKey).toBe('AIzaTestKey12345');
    expect(capturedBody).toContain('googleSearch');
    expect(overview?.provider).toBe('gemini_google_search');
    expect(overview?.citations.length).toBe(2);
    expect(overview?.claims[0]?.sourceUrl).toBe('https://www.goodreturns.in/gold-rates/');
  });

  it('auto-indexes visited public pages and returns hybrid local + open-web results with extractive summary when LLM is offline', async () => {
    const db = new LavrayDatabase(':memory:');
    const browserRepo = new BrowserRepository(db.db);
    const agentRepo = new AgentRepository(db.db);
    const platformRepo = new PlatformRepository(db.db);
    const auditLogger = new AuditLogger(platformRepo);
    const memory = new MemoryService(platformRepo);
    const vault = new SecretVault(tmpDir);
    const localIndex = new LocalSearchIndexService(db.db);

    // Localhost & tiny pages must be ignored by auto-indexer
    localIndex.indexRawPageForLocalCache('http://localhost:3000/test', 'Local App', 'x'.repeat(300));
    localIndex.indexRawPageForLocalCache('https://example.com/tiny', 'Tiny', 'Too short');
    expect(localIndex.getStats().totalDocuments).toBe(0);

    // Public visited page must be indexed
    localIndex.indexRawPageForLocalCache(
      'https://sqlite.org/fts5.html',
      'SQLite FTS5 Extension',
      'FTS5 is an SQLite virtual table module that provides full-text search functionality to database applications. '.repeat(3)
    );
    expect(localIndex.getStats().totalDocuments).toBe(1);

    const mockFetch: FetchLike = async (url) => {
      if (url.includes('en.wikipedia.org/w/api.php')) {
        return jsonResponse({
          query: {
            search: [
              {
                title: 'Full-text search',
                snippet: 'Full-text search refers to techniques for searching a single computer-stored document or collection.',
                timestamp: '2026-09-01T00:00:00Z'
              }
            ]
          }
        });
      }
      if (url.includes('api.duckduckgo.com')) {
        return jsonResponse({
          Heading: 'SQLite FTS5',
          AbstractText: 'SQLite FTS5 provides fast full-text indexing inside SQLite databases.',
          AbstractURL: 'https://en.wikipedia.org/wiki/SQLite',
          AbstractSource: 'Wikipedia'
        });
      }
      return jsonResponse({});
    };

    const offlineProvider: ModelProvider = {
      id: 'offline_test_provider',
      async generate() {
        throw new Error('Ollama unreachable');
      }
    };

    const fakeTabManager = {
      getAllTabs: () => [],
      getWebContents: () => undefined
    } as never;
    const fakePerception = { capture: async () => null } as never;

    const client = new CloudClientService(
      platformRepo,
      browserRepo,
      agentRepo,
      fakeTabManager,
      fakePerception,
      memory,
      vault,
      auditLogger,
      () => offlineProvider,
      localIndex,
      undefined,
      new WebDiscoveryEngine(mockFetch)
    );

    const response = await client.executeSearch({
      query: 'SQLite FTS5 full text search',
      mode: 'web',
      filters: { includeAiAnswer: true }
    });

    expect(response.results.length).toBeGreaterThanOrEqual(2);
    expect(response.results.some((r) => r.sourceOrigin === 'lavray_index')).toBe(true);
    expect(response.results.some((r) => r.sourceOrigin === 'external_provider')).toBe(true);
    expect(response.aiAnswer?.status).toBe('ok');
    expect(response.aiAnswer?.provider).toBe('lavray_extractive');
    expect(response.aiAnswer?.summary).toContain('SQLite FTS5');

    // Normal Google/Brave-style web search excludes personal knowledge, open tabs, and AI synthesis
    browserRepo.addBookmark('https://private-bm.example.com/fts5', 'Private Bookmark FTS5');
    const normalWebResponse = await client.executeSearch({
      query: 'SQLite FTS5',
      mode: 'web',
      filters: {
        includeOpenTabs: false,
        includePersonalKnowledge: false,
        includeAiAnswer: false
      }
    });
    expect(normalWebResponse.aiAnswer).toBeNull();
    expect(normalWebResponse.instantAnswer?.title).toBe('SQLite FTS5');
    expect(normalWebResponse.results.some((r) => r.sourceOrigin === 'personal_knowledge')).toBe(false);

    db.close();
  });

  it('retrieves Images, Videos, Maps, and Shopping verticals with rich metadata', async () => {
    const mockVerticalFetch: FetchLike = async (url) => {
      if (url.includes('commons.wikimedia.org/w/api.php')) {
        return jsonResponse({
          query: {
            pages: {
              '101': {
                title: 'File:Gold_bar_sample.jpg',
                imageinfo: [
                  {
                    thumburl: 'https://upload.wikimedia.org/gold_thumb.jpg',
                    url: 'https://upload.wikimedia.org/gold_full.jpg',
                    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Gold_bar_sample.jpg',
                    mime: 'image/jpeg'
                  }
                ]
              }
            }
          }
        });
      }
      if (url.includes('en.wikipedia.org/w/api.php') && url.includes('prop=pageimages')) {
        return jsonResponse({
          query: {
            pages: {
              '202': {
                title: 'Gold',
                fullurl: 'https://en.wikipedia.org/wiki/Gold',
                thumbnail: { source: 'https://upload.wikimedia.org/gold_wiki.jpg' }
              }
            }
          }
        });
      }
      if (url.includes('api.dailymotion.com/videos')) {
        return jsonResponse({
          list: [
            {
              id: 'x9abc',
              title: 'Bengaluru Tech Park Tour',
              url: 'https://www.dailymotion.com/video/x9abc',
              thumbnail_480_url: 'https://s1.dmcdn.net/v/abc/x480',
              duration: 185,
              'owner.screenname': 'LavrayMedia',
              created_time: 1764000000,
              description: 'Walkthrough video clip'
            }
          ]
        });
      }
      if (url.includes('archive.org/advancedsearch.php')) {
        return jsonResponse({
          response: {
            docs: [
              {
                identifier: 'archive-sample-video',
                title: 'Historical Archive Documentary',
                description: 'Public domain documentary reel',
                publicdate: '2025-05-01T00:00:00Z'
              }
            ]
          }
        });
      }
      if (url.includes('nominatim.openstreetmap.org/search')) {
        return jsonResponse([
          {
            place_id: 909,
            lat: '12.9716',
            lon: '77.5946',
            name: 'Bengaluru',
            display_name: 'Bengaluru, Karnataka, India',
            category: 'boundary',
            type: 'administrative'
          }
        ]);
      }
      if (url.includes('bing.com/search')) {
        return new Response(
          `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Wireless Headphones Pro - AudioStore</title><link>https://audiostore.example.com/headphones</link><description>Flagship ANC headphones available for ₹14,999 with fast shipping.</description></item></channel></rss>`,
          { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }
        );
      }
      return jsonResponse({});
    };

    const discovery = new WebDiscoveryEngine(mockVerticalFetch);

    const imgRes = await discovery.discover({ query: 'gold bar', mode: 'images' });
    const wikimediaHit = imgRes.candidates.find((c) => c.sourceProvider === 'wikimedia_images');
    const wikiImgHit = imgRes.candidates.find((c) => c.sourceProvider === 'wikipedia_images');
    expect(wikimediaHit?.thumbnailUrl).toBe('https://upload.wikimedia.org/gold_thumb.jpg');
    expect(wikimediaHit?.mediaUrl).toBe('https://upload.wikimedia.org/gold_full.jpg');
    expect(wikiImgHit?.thumbnailUrl).toBe('https://upload.wikimedia.org/gold_wiki.jpg');

    const vidRes = await discovery.discover({ query: 'bengaluru tour', mode: 'videos' });
    const dmHit = vidRes.candidates.find((c) => c.sourceProvider === 'dailymotion_api');
    const archiveHit = vidRes.candidates.find((c) => c.sourceProvider === 'archive_videos_api');
    expect(dmHit?.durationSeconds).toBe(185);
    expect(dmHit?.thumbnailUrl).toBe('https://s1.dmcdn.net/v/abc/x480');
    expect(archiveHit?.url).toContain('archive.org/details/archive-sample-video');

    const mapRes = await discovery.discover({ query: 'Bengaluru', mode: 'maps' });
    const osmHit = mapRes.candidates.find((c) => c.sourceProvider === 'osm_nominatim');
    expect(osmHit?.coordinates?.lat).toBeCloseTo(12.9716, 4);
    expect(osmHit?.coordinates?.lon).toBeCloseTo(77.5946, 4);
    expect(osmHit?.coordinates?.category).toBe('boundary • administrative');

    const shopRes = await discovery.discover({ query: 'wireless headphones', mode: 'shopping' });
    const shopHit = shopRes.candidates.find((c) => c.sourceProvider === 'bing_shopping_rss');
    expect(shopHit?.priceText).toBe('₹14,999');
  });

  it('retrieves YouTube, Instagram, and Facebook videos and blocks misleading/off-topic/ungrounded responses', async () => {
    const ytPayload = {
      contents: {
        twoColumnSearchResultsRenderer: {
          primaryContents: {
            sectionListRenderer: {
              contents: [
                {
                  itemSectionRenderer: {
                    contents: [
                      {
                        videoRenderer: {
                          videoId: 'ytVid123',
                          title: { runs: [{ text: 'Virat Kohli Century Highlights' }] },
                          lengthText: { simpleText: '12:34' },
                          ownerText: { runs: [{ text: 'Cricket Official' }] },
                          shortViewCountText: { simpleText: '2.1M views' },
                          publishedTimeText: { simpleText: '2 days ago' },
                          thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/ytVid123/hq720.jpg' }] }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
    };
    const yahooIgTile = `<a class="media-tile video-tile" data-referenceurl="https://www.instagram.com/reel/IGReEl99/" href="https://video.search.yahoo.com"><img src="https://up.yimg.com/ib/th/ig.jpg?a=1&amp;b=2"/><p class="time">00:29</p><p class="tile-description">Virat Kohli training reel on Instagram</p><p class="tile-title">Virat Kohli Workout Reel</p></a><a class="media-tile video-tile" data-referenceurl="https:// unrelated-spam.example.com/nope" href="https://spam"><p class="tile-title">Virat Kohli</p></a>`;
    const yahooFbTile = `<a class="media-tile video-tile" data-referenceurl="https://www.facebook.com/virat.kohli/videos/80702914/" href="https://video.search.yahoo.com"><img src="https://up.yimg.com/ib/th/fb.jpg?a=1&amp;b=2"/><p class="time">01:15</p><p class="tile-description">Watch Virat Kohli live message on Facebook</p><p class="tile-title">Virat Kohli Facebook Watch</p></a>`;

    const mockSocialFetch: FetchLike = async (url) => {
      if (url.includes('youtube.com/results')) {
        return new Response(`<html><script>var ytInitialData = ${JSON.stringify(ytPayload)};</script></html>`, {
          status: 200,
          headers: { 'Content-Type': 'text/html' }
        });
      }
      if (url.includes('video.search.yahoo.com') && url.includes('instagram')) {
        return new Response(`<html><body>${yahooIgTile}</body></html>`, { status: 200 });
      }
      if (url.includes('video.search.yahoo.com') && url.includes('facebook')) {
        return new Response(`<html><body>${yahooFbTile}</body></html>`, { status: 200 });
      }
      if (url.includes('bing.com/search')) {
        return new Response(
          `<?xml version="1.0"?><rss version="2.0"><channel><item><title>99.9&amp;percnt; Gold Rate Today &#8377;12,786</title><link>https://www.goodreturns.in/gold-rates/</link><description>Gold price today &amp;percnt; verified update.</description></item></channel></rss>`,
          { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }
        );
      }
      return jsonResponse({});
    };

    const discovery = new WebDiscoveryEngine(mockSocialFetch);
    const vidRes = await discovery.discover({ query: 'virat kohli', mode: 'videos' });
    const yt = vidRes.candidates.find((c) => c.videoPlatform === 'youtube');
    const ig = vidRes.candidates.find((c) => c.videoPlatform === 'instagram');
    const fb = vidRes.candidates.find((c) => c.videoPlatform === 'facebook');

    expect(yt?.url).toBe('https://www.youtube.com/watch?v=ytVid123');
    expect(yt?.durationSeconds).toBe(754);
    expect(ig?.url).toBe('https://www.instagram.com/reel/IGReEl99/');
    expect(ig?.thumbnailUrl).toBe('https://up.yimg.com/ib/th/ig.jpg?a=1&b=2');
    expect(ig?.durationSeconds).toBe(29);
    expect(fb?.url).toBe('https://www.facebook.com/virat.kohli/videos/80702914/');
    expect(fb?.durationSeconds).toBe(75);

    // Ensure HTML entities decode cleanly (never leaving "&percnt;" or "&#8377;")
    const goldRes = await discovery.discover({ query: 'gold rate today', mode: 'web' });
    const bingHit = goldRes.candidates.find((c) => c.sourceProvider === 'bing_web_rss');
    expect(bingHit?.title).toContain('99.9%');
    expect(bingHit?.title).toContain('₹12,786');

    // Off-topic external candidates & stale 2022 articles must be dropped or heavily demoted
    const { QueryUnderstandingEngine } = await import('../../src/backend/modules/search/query-understanding');
    const { SearchRankingPipeline } = await import('../../src/backend/modules/search/ranking');
    const qu = new QueryUnderstandingEngine();
    const ranking = new SearchRankingPipeline();
    const u = qu.analyzeDeterministic('gold rate today 2026', 'web');
    const ranked = ranking.normalizeAndRank({
      understanding: u,
      candidates: [
        {
          title: 'Bing Homepage Quiz Daily Trivia',
          url: 'https://bingquizzes.com/trivia',
          snippet: 'Unrelated daily quiz trivia questions.',
          sourceProvider: 'bing_web_rss',
          rawRank: 1
        },
        {
          title: 'Gold Rate 2022 Archive',
          url: 'https://oldsite.example.com/gold-2022',
          snippet: 'Gold rate in November 2022 was much lower.',
          sourceProvider: 'bing_web_rss',
          publishedAt: '2022-11-28T00:00:00Z',
          rawRank: 2
        },
        {
          title: 'Gold Rate Today 28 Nov 2026',
          url: 'https://current.example.com/gold-2026',
          snippet: 'Today 28 Nov 2026 24K gold rate stands at ₹12,786 per gram.',
          sourceProvider: 'bing_web_rss',
          rawRank: 3
        }
      ]
    });
    expect(ranked.results.some((r) => r.url.includes('bingquizzes.com'))).toBe(false);
    expect(ranked.results[0].url).toBe('https://current.example.com/gold-2026');

    // Gemini Overview returns null when zero web groundingChunks are present (refuses ungrounded guesses)
    const ungroundedGemini = await generateGeminiGroundedOverview({
      apiKey: 'AIzaTestKey12345',
      query: 'gold rate today',
      fetchFn: async () =>
        jsonResponse({
          candidates: [
            {
              content: { parts: [{ text: 'Guessed figure without web search sources.' }] },
              groundingMetadata: { groundingChunks: [] }
            }
          ]
        })
    });
    expect(ungroundedGemini).toBeNull();

    // Live Weather (population disambiguation) & Live Currency Converter Instant Answers
    const mockToolsFetch: FetchLike = async (url) => {
      if (url.includes('geocoding-api.open-meteo.com')) {
        return jsonResponse({
          results: [
            { name: 'Bangalore Town', country: 'Pakistan', latitude: 24.8, longitude: 67.0, population: 1200 },
            { name: 'Bengaluru', country: 'India', admin1: 'Karnataka', latitude: 12.9716, longitude: 77.5946, population: 8443675 }
          ]
        });
      }
      if (url.includes('api.open-meteo.com/v1/forecast')) {
        return jsonResponse({
          current: { temperature_2m: 26.4, relative_humidity_2m: 48, apparent_temperature: 26.0, weather_code: 1, wind_speed_10m: 9.2 },
          daily: { temperature_2m_max: [29.1], temperature_2m_min: [18.4] }
        });
      }
      if (url.includes('open.er-api.com/v6/latest/USD')) {
        return jsonResponse({
          result: 'success',
          time_last_update_utc: 'Sat, 28 Nov 2026 00:00:00 +0000',
          rates: { INR: 84.5 }
        });
      }
      return jsonResponse({});
    };
    const toolsEngine = new WebDiscoveryEngine(mockToolsFetch);
    const wxRes = await toolsEngine.discover({ query: 'weather in Bangalore', mode: 'web' });
    expect(wxRes.instantAnswer?.title).toBe('26°C • Partly cloudy');
    expect(wxRes.instantAnswer?.subtitle).toContain('Bengaluru');

    const fxRes = await toolsEngine.discover({ query: '100 usd to inr', mode: 'web' });
    expect(fxRes.instantAnswer?.title).toContain('8,450 INR');
  });
});

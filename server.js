/**
 * MCP Server for App Store Scrapers
 * 
 * This server provides tools to search, analyze, and extract data from both
 * Google Play Store and Apple App Store. It leverages the 'google-play-scraper' 
 * and 'app-store-scraper' libraries to fetch information.
 * 
 * Capabilities include:
 * - Searching for apps by keywords across both platforms
 * - Getting detailed app information (ratings, reviews, pricing, etc.)
 * - Analyzing keywords for competitive intelligence
 * - Processing reviews with basic sentiment analysis
 * - Extracting pricing models and in-app purchase information
 * - Retrieving developer portfolios and information
 * - Fetching version history and changelog data (with platform limitations)
 * 
 * Note: The API respects store rate limits with memoization to cache results
 * and avoid hitting throttling limits.
 */

import { z } from "zod";
import gplay from "google-play-scraper";
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMemoizedIosAppStoreClient } from './ios-app-store-client.js';

/* ------------------------------------------------------------------ *
 * google-play-scraper extractor hardening
 * ------------------------------------------------------------------ */

const nodeRequire = createRequire(import.meta.url);

// Carries the appId of the in-flight gplay.app() call so a field-level
// extractor failure can name the app it belongs to. AsyncLocalStorage keeps
// this correct while several apps are hydrated concurrently.
const gplayAppContext = new AsyncLocalStorage();

const EXTRACTOR_PATCH_FLAG = Symbol.for("mcp-appstore.extractorPatched");

function reportExtractorFieldFailure(field, error) {
  const appId = gplayAppContext.getStore()?.appId;
  console.error(
    `[gplay-patch] mapping field "${field}" failed for ${appId ?? "unknown app"}: ${error?.message ?? error}`
  );
}

/**
 * google-play-scraper maps ~40 fields out of a single parsed Play response, and
 * its extractor (lib/utils/scriptData.js) applies every mapping with no
 * isolation. Several mapping functions guard `=== null` but receive `undefined`
 * when Play omits a field - extractCategories, reached via MAPPINGS.categories
 * in lib/app.js, is the one that bites us - so one missing index throws and
 * discards the entire app record even though the HTTP request and the JSON
 * parse both succeeded.
 *
 * This wraps each field's `fun` in its own try/catch. A field that throws now
 * yields `undefined` - exactly what an array-spec mapping already does when its
 * path is missing - and every other field survives untouched.
 *
 * Deliberately narrow: only per-field mapping errors are caught. request() and
 * JSON.parse run outside the extractor (lib/app.js), so network failures and
 * malformed responses still reject exactly as before.
 *
 * Idempotent, and a no-op if the internal module ever moves or changes shape -
 * in which case we keep today's behaviour (a visible failure) rather than
 * breaking startup.
 */
function applyGplayExtractorPatch() {
  let scriptData;
  try {
    scriptData = nodeRequire("google-play-scraper/lib/utils/scriptData");
  } catch (error) {
    console.error(`[gplay-patch] not applied: ${error.message}`);
    return { applied: false, reason: error.message };
  }

  if (!scriptData || typeof scriptData.extractor !== "function") {
    console.error("[gplay-patch] not applied: scriptData.extractor is not a function");
    return { applied: false, reason: "extractor missing or not a function" };
  }
  if (scriptData[EXTRACTOR_PATCH_FLAG]) {
    return { applied: false, reason: "already patched" };
  }

  const originalExtractor = scriptData.extractor;

  scriptData.extractor = function patchedExtractor(mappings) {
    const isolated = {};
    for (const [field, spec] of Object.entries(mappings)) {
      // Array specs resolve through R.path, which already returns undefined
      // rather than throwing when the path is missing. Leave them alone.
      if (!spec || Array.isArray(spec) || typeof spec.fun !== "function") {
        isolated[field] = spec;
        continue;
      }
      isolated[field] = {
        ...spec,
        fun: (...args) => {
          try {
            return spec.fun(...args);
          } catch (error) {
            reportExtractorFieldFailure(field, error);
            return undefined;
          }
        }
      };
    }
    return originalExtractor(isolated);
  };

  scriptData[EXTRACTOR_PATCH_FLAG] = true;
  return { applied: true };
}

applyGplayExtractorPatch();

// Create memoized versions of the scrapers
const memoizedGplay = gplay.memoized({
  maxAge: 1000 * 60 * 10, // 10 minutes cache
  max: 1000 // Maximum cache size
});

// Wrap the memoized app() so the extractor patch can name the app a failing
// field belongs to. Memoization still happens inside; this only adds context.
const memoizedGplayApp = memoizedGplay.app;
memoizedGplay.app = (opts) =>
  gplayAppContext.run({ appId: opts?.appId ?? null }, () => memoizedGplayApp(opts));

const memoizedAppStore = createMemoizedIosAppStoreClient();

/* ------------------------------------------------------------------ *
 * Helpers for analyze_top_keywords
 * ------------------------------------------------------------------ */

// Play throttles bursts; hydrating 50 apps at once is what makes individual
// detail fetches fail. Keep the fan-out small.
const DETAIL_FETCH_CONCURRENCY = 5;

export const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Run an async mapper over `items` with bounded concurrency.
 * Every item is isolated: a rejection is captured and returned as
 * { ok: false, error }, never propagated. One failing app can therefore
 * never fail the whole keyword analysis.
 */
export async function mapSettledWithConcurrency(items, limit, mapper) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        try {
          out[index] = { ok: true, value: await mapper(items[index], index) };
        } catch (error) {
          out[index] = { ok: false, error };
        }
      }
    }
  );
  await Promise.all(workers);
  return out;
}

/**
 * Summarize the values that actually exist. A missing value is excluded from
 * both numerator and denominator - it is never coerced to 0. Always reports
 * the sampleSize the figures were computed over.
 */
export function summarizeNumbers(values) {
  const sample = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (sample.length === 0) {
    return { mean: null, median: null, min: null, max: null, sum: null, sampleSize: 0 };
  }
  const sorted = [...sample].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return {
    mean: round2(sum / sorted.length),
    median: round2(median),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    sum,
    sampleSize: sorted.length
  };
}

/**
 * Build a fresh MCP server instance (stdio or one HTTP request/session).
 */
export function createMcpAppStoreServer() {
// Create an MCP server with detailed configuration
const server = new McpServer({
  name: "AppStore Scraper",
  version: "1.0.0",
  description: "Tools for searching and analyzing apps from Google Play and Apple App Store",
  // Define capabilities for tools - this ensures getTools() works
  capabilities: {
    tools: {
      // Enable tools capability with change notification
      listChanged: true
    }
  }
});

// Tool 1: Search for an app by name and platform
server.tool(
  "search_app",
  {
    term: z.string().describe("The search term to look up (e.g., 'panda', 'spotify', 'photo editor'). This is required."),
    platform: z.enum(["ios", "android"]).describe("The platform to search on ('ios' for Apple App Store, 'android' for Google Play Store)."),
    num: z.number().min(1).max(250).optional().default(10).describe("Number of results to return (1-250, default 10). For Android max is 250, for iOS typically defaults to 50."),
    country: z.string().length(2).optional().default("us").describe("Two-letter country code for the App Store/Play Store region (e.g., 'us', 'de', 'gb'). Affects ranking and availability. Default 'us'.")
  },
  async ({ term, platform, num, country }) => {
    try {
      let results;
      
      if (platform === "android") {
        // Search on Google Play Store
        results = await memoizedGplay.search({
          term,
          num,
          country,
          fullDetail: false
        });
        
        // Standardize the results
        results = results.map(app => ({
          id: app.appId,
          appId: app.appId,
          title: app.title,
          developer: app.developer,
          developerId: app.developerId,
          icon: app.icon,
          score: app.score,
          scoreText: app.scoreText,
          price: app.price,
          free: app.free,
          platform: "android",
          url: app.url
        }));
      } else {
        // Search on Apple App Store
        results = await memoizedAppStore.search({
          term,
          num,
          country
        });
        
        // Standardize the results
        results = results.map(app => ({
          id: app.id.toString(),
          appId: app.appId,
          title: app.title,
          developer: app.developer,
          developerId: app.developerId,
          icon: app.icon,
          score: app.score,
          price: app.price,
          free: app.free === true,
          platform: "ios",
          url: app.url
        }));
      }
      
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            query: term,
            platform,
            results,
            count: results.length
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            error: error.message,
            query: term,
            platform
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

// Tool 2: Get detailed information about an app
server.tool(
  "get_app_details",
  {
    appId: z.string().describe("The unique identifier for the app. For Android: the package name (e.g., 'com.google.android.gm'). For iOS: the numeric ID (e.g., '553834731') or the bundle ID (e.g., 'com.midasplayer.apps.candycrushsaga')."),
    platform: z.enum(["ios", "android"]).describe("The platform of the app ('ios' or 'android')."),
    country: z.string().length(2).optional().default("us").describe("Two-letter country code for store localization (e.g., 'us', 'de'). Affects availability and potentially some metadata. Default 'us'."),
    lang: z.string().optional().default("en").describe("Language code for the results (e.g., 'en', 'de'). If not provided, defaults to the 'country' code. If 'country' is also missing, defaults to 'en'. Determines the language of text fields like description and recent changes.")
  },
  async ({ appId, platform, country, lang }) => {
    try {
      let appDetails;
      
      if (platform === "android") {
        // Get app details from Google Play Store
        appDetails = await memoizedGplay.app({
          appId,
          country,
          lang
        });
        
        // Normalize Android app details
        appDetails = {
          id: appDetails.appId,
          appId: appDetails.appId,
          title: appDetails.title,
          description: appDetails.description,
          summary: appDetails.summary,
          developer: appDetails.developer,
          developerId: appDetails.developerId,
          developerEmail: appDetails.developerEmail,
          developerWebsite: appDetails.developerWebsite,
          icon: appDetails.icon,
          headerImage: appDetails.headerImage,
          screenshots: appDetails.screenshots,
          score: appDetails.score,
          scoreText: appDetails.scoreText,
          ratings: appDetails.ratings,
          reviews: appDetails.reviews,
          histogram: appDetails.histogram,
          price: appDetails.price,
          free: appDetails.free,
          currency: appDetails.currency,
          categories: appDetails.categories,
          genre: appDetails.genre,
          genreId: appDetails.genreId,
          contentRating: appDetails.contentRating,
          released: appDetails.released,
          updated: appDetails.updated,
          version: appDetails.version,
          size: appDetails.size,
          recentChanges: appDetails.recentChanges,
          platform: "android"
        };
      } else {
        // Get app details from Apple App Store
        // For iOS, we need to handle both numeric IDs and bundle IDs
        const isNumericId = /^\d+$/.test(appId);
        
        const lookupParams = isNumericId 
          ? { id: appId, country, lang } 
          : { appId: appId, country, lang };
        
        appDetails = await memoizedAppStore.app({
          ...lookupParams,
          ratings: true // Get ratings information too
        });
        
        // Normalize iOS app details
        appDetails = {
          id: appDetails.id.toString(),
          appId: appDetails.appId,
          title: appDetails.title,
          description: appDetails.description,
          summary: appDetails.description?.substring(0, 100),
          developer: appDetails.developer,
          developerId: appDetails.developerId,
          developerWebsite: appDetails.developerWebsite,
          icon: appDetails.icon,
          screenshots: appDetails.screenshots,
          ipadScreenshots: appDetails.ipadScreenshots,
          score: appDetails.score,
          scoreText: appDetails.score?.toString(),
          ratings: appDetails.ratings,
          reviews: appDetails.reviews,
          histogram: appDetails.histogram,
          price: appDetails.price,
          free: appDetails.free,
          currency: appDetails.currency,
          genres: appDetails.genres,
          primaryGenre: appDetails.primaryGenre,
          contentRating: appDetails.contentRating,
          released: appDetails.released,
          updated: appDetails.updated,
          version: appDetails.version,
          size: appDetails.size,
          releaseNotes: appDetails.releaseNotes,
          platform: "ios"
        };
      }
      
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            appId,
            platform,
            details: appDetails
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            error: error.message,
            appId,
            platform
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "analyze_top_keywords",
  {
    keyword: z.string().describe("The keyword or search term to analyze (e.g., 'meditation app', 'puzzle games')."),
    platform: z.enum(["ios", "android"]).describe("The platform (app store) to analyze ('ios' for Apple App Store, 'android' for Google Play Store)."),
    num: z.number().int().min(1).max(50).optional().default(10).describe("Number of top apps ranking for the keyword to analyze (1-50, default 10). These apps will be fetched with full details to provide comprehensive analysis."),
    country: z.string().length(2).optional().default("us").describe("Two-letter country code for store localization. Default 'us'."),
    lang: z.string().optional().default("en").describe("Language code for results. Default 'en'.")
  },
  async ({ keyword, platform, num, country, lang }) => {
    try {
      // ---- 1. Search. A failure here is genuinely fatal for the query. ----
      let searchResults;
      if (platform === "android") {
        // fullDetail:true crashes google-play-scraper when Play omits category
        // data, so we search shallow and hydrate each app separately below.
        searchResults = await memoizedGplay.search({
          term: keyword,
          num,
          country,
          lang,
          fullDetail: false
        });
      } else {
        searchResults = await memoizedAppStore.search({ term: keyword, num, country, lang });
      }
      searchResults = (searchResults || []).slice(0, num);

      // ---- 2. Hydrate details. Each app is isolated from the others. ----
      const settled = await mapSettledWithConcurrency(
        searchResults,
        DETAIL_FETCH_CONCURRENCY,
        (app) => platform === "android"
          ? memoizedGplay.app({ appId: app.appId, country, lang })
          : memoizedAppStore.app({ id: app.id, country, lang, ratings: true })
      );

      // A failed detail fetch falls back to the shallow search record, but the
      // fallback is now reported instead of silently masquerading as full data.
      const detailFetchFailures = [];
      const hydrated = settled.map((res, i) => {
        if (res.ok) return { app: res.value, complete: true };
        const fallback = searchResults[i] || {};
        const id = fallback.appId ?? fallback.id ?? null;
        detailFetchFailures.push({
          appId: id,
          reason: res.error?.message ?? String(res.error)
        });
        console.error(`[analyze_top_keywords] detail fetch failed for ${id}:`, res.error);
        return { app: fallback, complete: false };
      });

      // ---- 3. Normalize. Absent data is null, never 0, never omitted. ----
      const topApps = hydrated.map(({ app, complete }) => {
        const base = {
          appId: app.appId ?? null,
          title: app.title ?? null,
          developer: app.developer ?? null,
          developerId: app.developerId ?? null,
          free: typeof app.free === "boolean" ? app.free : null,
          price: typeof app.price === "number" ? app.price : null,
          currency: app.currency ?? null,
          url: app.url ?? null,
          icon: app.icon ?? null,
          dataCompleteness: complete ? "full" : "partial"
        };

        if (platform === "android") {
          return {
            ...base,
            installs: app.installs ?? null,
            minInstalls: typeof app.minInstalls === "number" ? app.minInstalls : null,
            score: typeof app.score === "number" ? app.score : null,
            ratingCount: typeof app.ratings === "number" ? app.ratings : null,
            category: app.genre ?? null
          };
        }

        // iOS. mapApp() exposes the rating count as `reviews` and the category
        // as `genre` - reading `ratings`/`primaryGenre` yielded 0/undefined for
        // every iOS app.
        const iosRatingCount = typeof app.reviews === "number" ? app.reviews : null;
        return {
          ...base,
          storeId: app.id ?? null,
          installs: null, // Apple publishes no install data at all.
          minInstalls: null,
          // mapApp() coerces a missing average to 0; a 0 with no ratings behind
          // it is absence of data, not a rating of zero.
          score: typeof app.score === "number" && app.score > 0 && iosRatingCount
            ? app.score
            : null,
          ratingCount: iosRatingCount,
          category: app.primaryGenre ?? app.genre ?? null
        };
      });

      // ---- 4. Aggregate, each figure over its own real sample. ----
      const appsReturned = topApps.length;
      const appsWithFullDetail = topApps.filter((a) => a.dataCompleteness === "full").length;

      const rating = summarizeNumbers(topApps.map((a) => a.score));
      const ratingCount = summarizeNumbers(topApps.map((a) => a.ratingCount));
      const minInstalls = summarizeNumbers(topApps.map((a) => a.minInstalls));

      const freeApps = topApps.filter((a) => a.free === true).length;
      const paidApps = topApps.filter((a) => a.free === false).length;
      const pricingKnown = freeApps + paidApps;

      // Apps with an unknown developer are excluded from the denominator rather
      // than collapsed into an "undefined" bucket.
      const developerCounts = {};
      topApps.forEach((a) => {
        if (!a.developer) return;
        developerCounts[a.developer] = (developerCounts[a.developer] || 0) + 1;
      });
      const developerEntries = Object.entries(developerCounts).sort((a, b) => b[1] - a[1]);
      const developerSample = developerEntries.reduce((s, [, c]) => s + c, 0);

      const categoryCounts = {};
      let categoryUnknown = 0;
      topApps.forEach((a) => {
        if (!a.category) {
          categoryUnknown++;
          return;
        }
        categoryCounts[a.category] = (categoryCounts[a.category] || 0) + 1;
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            query: { keyword, platform, country, lang, requestedNum: num },

            // (1) Read straight from the store. No arithmetic applied.
            observed: {
              appsRequested: num,
              appsReturned,
              appsWithFullDetail,
              appsWithPartialDetail: appsReturned - appsWithFullDetail,
              detailFetchFailures,
              topApps
            },

            // (2) Derived by this server from `observed`. Every figure carries
            // the sample size it was computed over, so a gap can never be
            // misread as a zero.
            calculated: {
              rating: { ...rating, missing: appsReturned - rating.sampleSize },
              ratingCount: { ...ratingCount, missing: appsReturned - ratingCount.sampleSize },
              minInstalls: {
                ...minInstalls,
                missing: appsReturned - minInstalls.sampleSize,
                note: platform === "ios"
                  ? "Apple publishes no install counts; this sample is always empty for iOS."
                  : "Google Play publishes bucketed floors ('100,000+'), so these are lower bounds."
              },
              pricing: {
                freeApps,
                paidApps,
                unknown: appsReturned - pricingKnown,
                paidPercentage: pricingKnown ? round2((paidApps / pricingKnown) * 100) : null
              },
              developerConcentration: {
                distinctDevelopers: developerEntries.length,
                sampleSize: developerSample,
                topDeveloper: developerEntries[0]
                  ? {
                      developer: developerEntries[0][0],
                      apps: developerEntries[0][1],
                      share: round2(developerEntries[0][1] / developerSample)
                    }
                  : null,
                appsPerDeveloper: developerCounts,
                herfindahlIndex: developerSample
                  ? round2(developerEntries.reduce(
                      (s, [, c]) => s + Math.pow(c / developerSample, 2), 0))
                  : null,
                note: "Raw concentration of the result set. This is a measured distribution, not a difficulty or competitiveness rating."
              },
              categoryDistribution: { counts: categoryCounts, unknown: categoryUnknown }
            },

            // (3) Not published by either store, and not yet covered by any
            // external source wired into this server. Never estimated.
            unavailable: {
              searchVolume: null,
              keywordDifficulty: null,
              exactInstallCount: null,
              impressions: null,
              conversionRate: null,
              notes: {
                searchVolume: "Google Play and the App Store do not publish search volume, and this server has no external ASO data source connected yet. No estimate is produced.",
                keywordDifficulty: "Neither store publishes a keyword difficulty metric, and this server has no external ASO data source connected yet. No heuristic score is produced; use `calculated` to judge competition yourself.",
                exactInstallCount: "Google Play publishes only bucketed ranges; Apple publishes nothing.",
                impressions: "Owner-only, via Play Console / App Store Connect.",
                conversionRate: "Owner-only, via Play Console / App Store Connect."
              }
            }
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: error.message,
            keyword,
            platform,
            country,
            lang
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "analyze_reviews",
  {
    appId: z.string().describe("The unique identifier for the app (Android package name, iOS numeric ID or bundle ID)."),
    platform: z.enum(["ios", "android"]).describe("The platform of the app ('ios' or 'android')."),
    num: z.number().optional().default(100).describe("Target number of reviews to analyze (1-1000, default 100). Note: Actual number may be less due to API limitations or available reviews. For iOS, fetching requires multiple requests and is capped at page 10."),
    country: z.string().length(2).optional().default("us").describe("Two-letter country code for reviews localization. Default 'us'."),
    lang: z.string().optional().default("en").describe("Language code for filtering reviews (results may be less accurate if language doesn't match review content). Default 'en'."),
    sort: z.enum(["newest", "rating", "helpfulness"]).optional().default("newest").describe("Sorting order for reviews: 'newest', 'rating' (highest/lowest first, platform dependent), 'helpfulness'. Default 'newest'.")
  },
  async ({ appId, platform, num, country, lang, sort }) => {
    try {
      let reviews = [];
      
      // Fetch reviews from the appropriate platform
      if (platform === "android") {
        let sortType;
        switch (sort) {
          case "newest":
            sortType = gplay.sort.NEWEST;
            break;
          case "rating":
            sortType = gplay.sort.RATING;
            break;
          case "helpfulness":
            sortType = gplay.sort.HELPFULNESS;
            break;
          default:
            sortType = gplay.sort.NEWEST;
        }
        
        const result = await memoizedGplay.reviews({
          appId,
          num: Math.min(num, 1000), // Limit to 1000 reviews max
          sort: sortType,
          country,
          lang
        });
        
        reviews = result.data || [];
      } else {
        let page = 1;
        let allReviews = [];
        let sortType;
        
        switch (sort) {
          case "newest":
            sortType = "recent";
            break;
          case "helpfulness":
            sortType = "helpful";
            break;
          default:
            sortType = "recent";
        }
        
        // For iOS, we might need to fetch multiple pages
        while (allReviews.length < num && page <= 10) { // App Store only allows 10 pages
          try {
            // For iOS apps, we need to use id instead of appId
            let iosParams = {};
            
            // Check if the appId is already a numeric ID
            if (/^\d+$/.test(appId)) {
              iosParams = {
                id: appId,
                page,
                sort: sortType,
                country
              };
            } else {
              // First we need to fetch the app to get its numeric ID
              try {
                const appDetails = await memoizedAppStore.app({ appId, country });
                iosParams = {
                  id: appDetails.id.toString(),
                  page,
                  sort: sortType,
                  country
                };
              } catch (appError) {
                console.error(`Could not fetch app details for ${appId}:`, appError.message);
                break;
              }
            }
            
            const pageReviews = await memoizedAppStore.reviews(iosParams);
            
            if (!pageReviews || pageReviews.length === 0) {
              break; // No more reviews
            }
            
            allReviews = [...allReviews, ...pageReviews];
            page++;
          } catch (err) {
            console.error(`Error fetching reviews page ${page}:`, err);
            break;
          }
        }
        
        reviews = allReviews.slice(0, num);
      }
      
      // Very basic sentiment analysis functions
      function analyzeSentiment(text) {
        if (!text) return 'neutral';
        
        // Define simple positive and negative word lists
        const positiveWords = [
          'good', 'great', 'excellent', 'awesome', 'amazing', 'love', 'best',
          'perfect', 'fantastic', 'wonderful', 'happy', 'easy', 'helpful',
          'recommend', 'recommended', 'nice', 'beautiful', 'fun', 'enjoy',
          'worth', 'favorite', 'improvement', 'improved', 'better', 'useful'
        ];
        
        const negativeWords = [
          'bad', 'terrible', 'awful', 'horrible', 'poor', 'worst', 'waste',
          'useless', 'difficult', 'hate', 'crash', 'bug', 'problem', 'issue',
          'disappointing', 'disappointed', 'fix', 'error', 'fail', 'fails',
          'wrong', 'frustrating', 'slow', 'expensive', 'annoying', 'boring'
        ];
        
        // Convert text to lowercase and split into words
        const words = text.toLowerCase().match(/\b(\w+)\b/g) || [];
        
        // Count positive and negative words
        let positiveCount = 0;
        let negativeCount = 0;
        
        words.forEach(word => {
          if (positiveWords.includes(word)) positiveCount++;
          if (negativeWords.includes(word)) negativeCount++;
        });
        
        // Determine sentiment based on counts
        if (positiveCount > negativeCount * 2) return 'positive';
        if (negativeCount > positiveCount * 2) return 'negative';
        if (positiveCount > negativeCount) return 'somewhat positive';
        if (negativeCount > positiveCount) return 'somewhat negative';
        return 'neutral';
      }
      
      // Extract keywords from text
      function extractKeywords(text) {
        if (!text) return [];
        
        // Common words to exclude
        const stopWords = [
          'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
          'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him',
          'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its',
          'itself', 'they', 'them', 'their', 'theirs', 'themselves',
          'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
          'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have',
          'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an',
          'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while',
          'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between',
          'into', 'through', 'during', 'before', 'after', 'above', 'below',
          'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over',
          'under', 'again', 'further', 'then', 'once', 'here', 'there',
          'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each',
          'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
          'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
          's', 't', 'can', 'will', 'just', 'don', 'should', 'now', 'app'
        ];
        
        // Extract words, remove stop words, and filter out short words
        const words = text.toLowerCase().match(/\b(\w+)\b/g) || [];
        return words.filter(word => 
          !stopWords.includes(word) && word.length > 3
        );
      }
      
      // Process all reviews
      const processedReviews = reviews.map(review => {
        const reviewText = platform === 'android' ? review.text : review.text;
        const reviewScore = platform === 'android' ? review.score : review.score;
        
        const sentiment = analyzeSentiment(reviewText);
        const keywords = extractKeywords(reviewText);
        
        return {
          id: review.id,
          text: reviewText,
          score: reviewScore,
          sentiment,
          keywords,
          date: platform === 'android' ? review.date : review.updated
        };
      });
      
      // Calculate sentiment distribution
      const sentimentCounts = {
        positive: 0,
        "somewhat positive": 0,
        neutral: 0,
        "somewhat negative": 0,
        negative: 0
      };
      
      processedReviews.forEach(review => {
        sentimentCounts[review.sentiment] = (sentimentCounts[review.sentiment] || 0) + 1;
      });
      
      const totalReviews = processedReviews.length;
      const sentimentBreakdown = {};
      
      Object.keys(sentimentCounts).forEach(sentiment => {
        const percentage = totalReviews ? (sentimentCounts[sentiment] / totalReviews) * 100 : 0;
        sentimentBreakdown[sentiment] = parseFloat(percentage.toFixed(2));
      });
      
      // Calculate keyword frequency
      const allKeywords = processedReviews.flatMap(review => review.keywords);
      const keywordFrequency = {};
      
      allKeywords.forEach(keyword => {
        keywordFrequency[keyword] = (keywordFrequency[keyword] || 0) + 1;
      });
      
      // Sort keywords by frequency and take top 20
      const topKeywords = Object.entries(keywordFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .reduce((obj, [key, value]) => {
          obj[key] = value;
          return obj;
        }, {});
      
      // Identify common themes
      const commonThemes = [];
      
      // Look for bug/crash mentions
      const bugKeywords = ['bug', 'crash', 'freezes', 'frozen', 'stuck', 'error'];
      const hasBugTheme = bugKeywords.some(word => 
        Object.keys(keywordFrequency).some(kw => kw.includes(word))
      );
      
      if (hasBugTheme) {
        commonThemes.push({
          theme: "Stability Issues",
          description: "Users are reporting crashes, bugs, or freezes"
        });
      }
      
      // Look for pricing/cost mentions
      const pricingKeywords = ['price', 'cost', 'expensive', 'cheap', 'free', 'subscription', 'payment'];
      const hasPricingTheme = pricingKeywords.some(word => 
        Object.keys(keywordFrequency).some(kw => kw.includes(word))
      );
      
      if (hasPricingTheme) {
        commonThemes.push({
          theme: "Pricing Concerns",
          description: "Users are discussing price or subscription costs"
        });
      }
      
      // Look for UX/UI feedback
      const uxKeywords = ['interface', 'design', 'layout', 'ugly', 'beautiful', 'easy', 'difficult', 'confusing'];
      const hasUxTheme = uxKeywords.some(word => 
        Object.keys(keywordFrequency).some(kw => kw.includes(word))
      );
      
      if (hasUxTheme) {
        commonThemes.push({
          theme: "User Experience",
          description: "Users are commenting on the app's design or usability"
        });
      }
      
      // Identify recent issues (from negative reviews in the last 7 days)
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      
      const recentNegativeReviews = processedReviews.filter(review => {
        const reviewDate = new Date(review.date);
        return (
          reviewDate >= oneWeekAgo &&
          (review.sentiment === 'negative' || review.sentiment === 'somewhat negative')
        );
      });
      
      const recentIssuesKeywords = recentNegativeReviews.flatMap(review => review.keywords);
      const recentIssuesFrequency = {};
      
      recentIssuesKeywords.forEach(keyword => {
        recentIssuesFrequency[keyword] = (recentIssuesFrequency[keyword] || 0) + 1;
      });
      
      // Sort recent issues by frequency and take top 10
      const topRecentIssues = Object.entries(recentIssuesFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .reduce((obj, [key, value]) => {
          obj[key] = value;
          return obj;
        }, {});
      
      // Calculate rating distribution
      const ratingDistribution = {
        "1": 0,
        "2": 0,
        "3": 0,
        "4": 0,
        "5": 0
      };
      
      processedReviews.forEach(review => {
        const score = Math.floor(review.score);
        if (score >= 1 && score <= 5) {
          ratingDistribution[score] = (ratingDistribution[score] || 0) + 1;
        }
      });
      
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            appId,
            platform,
            totalReviewsAnalyzed: processedReviews.length,
            analysis: {
              sentimentBreakdown,
              keywordFrequency: topKeywords,
              ratingDistribution,
              commonThemes,
              recentIssues: topRecentIssues,
              topPositiveKeywords: Object.entries(keywordFrequency)
                .filter(([key, value]) => 
                  processedReviews.some(r => 
                    r.sentiment === 'positive' && r.keywords.includes(key)
                  )
                )
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .reduce((obj, [key, value]) => {
                  obj[key] = value;
                  return obj;
                }, {}),
              topNegativeKeywords: Object.entries(keywordFrequency)
                .filter(([key, value]) => 
                  processedReviews.some(r => 
                    r.sentiment === 'negative' && r.keywords.includes(key)
                  )
                )
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .reduce((obj, [key, value]) => {
                  obj[key] = value;
                  return obj;
                }, {})
            }
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            error: error.message,
            appId,
            platform
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

// Tool to fetch raw reviews without analysis
server.tool(
  "fetch_reviews",
  {
    appId: z.string().describe("The unique identifier for the app (Android package name, iOS numeric ID or bundle ID)."),
    platform: z.enum(["ios", "android"]).describe("The platform of the app ('ios' or 'android')."),
    num: z.number().optional().default(100).describe("Number of reviews to fetch (1-1000, default 100). Note: Actual number may be less due to API limitations. For iOS, limited to 10 pages max."),
    country: z.string().length(2).optional().default("us").describe("Two-letter country code for the App Store/Play Store region. Default 'us'."),
    lang: z.string().optional().default("en").describe("Language code for reviews. Default 'en'."),
    sort: z.enum(["newest", "rating", "helpfulness"]).optional().default("newest").describe("Sorting order for reviews: 'newest', 'rating', 'helpfulness'. Default 'newest'.")
  },
  async ({ appId, platform, num, country, lang, sort }) => {
    try {
      let reviews = [];
      
      // Fetch reviews from the appropriate platform
      if (platform === "android") {
        let sortType;
        switch (sort) {
          case "newest":
            sortType = gplay.sort.NEWEST;
            break;
          case "rating":
            sortType = gplay.sort.RATING;
            break;
          case "helpfulness":
            sortType = gplay.sort.HELPFULNESS;
            break;
          default:
            sortType = gplay.sort.NEWEST;
        }
        
        const result = await memoizedGplay.reviews({
          appId,
          num: Math.min(num, 1000), // Limit to 1000 reviews max
          sort: sortType,
          country,
          lang
        });
        
        reviews = result.data || [];
        
        // Android reviews have developer replies included if available
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              appId,
              platform,
              count: reviews.length,
              reviews: reviews.map(review => ({
                id: review.id,
                userName: review.userName,
                userImage: review.userImage,
                score: review.score,
                scoreText: review.scoreText,
                title: review.title || "",
                text: review.text,
                date: review.date,
                url: review.url,
                version: review.version,
                thumbsUp: review.thumbsUp,
                replyDate: review.replyDate,
                replyText: review.replyText,
                hasDeveloperResponse: !!review.replyText
              }))
            }, null, 2)
          }]
        };
      } else {
        let page = 1;
        let allReviews = [];
        let sortType;
        
        switch (sort) {
          case "newest":
            sortType = "recent";
            break;
          case "helpfulness":
            sortType = "helpful";
            break;
          default:
            sortType = "recent";
        }
        
        // For iOS, we might need to fetch multiple pages
        while (allReviews.length < num && page <= 10) { // App Store only allows 10 pages
          try {
            // For iOS apps, we need to use id instead of appId
            let iosParams = {};
            
            // Check if the appId is already a numeric ID
            if (/^\d+$/.test(appId)) {
              iosParams = {
                id: appId,
                page,
                sort: sortType,
                country
              };
            } else {
              // First we need to fetch the app to get its numeric ID
              try {
                const appDetails = await memoizedAppStore.app({ appId, country });
                iosParams = {
                  id: appDetails.id.toString(),
                  page,
                  sort: sortType,
                  country
                };
              } catch (appError) {
                console.error(`Could not fetch app details for ${appId}:`, appError.message);
                break;
              }
            }
            
            const pageReviews = await memoizedAppStore.reviews(iosParams);
            
            if (!pageReviews || pageReviews.length === 0) {
              break; // No more reviews
            }
            
            allReviews = [...allReviews, ...pageReviews];
            page++;
          } catch (err) {
            console.error(`Error fetching reviews page ${page}:`, err);
            break;
          }
        }
        
        reviews = allReviews.slice(0, num);
        
        // iOS reviews don't include developer responses in the API
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              appId,
              platform,
              count: reviews.length,
              reviews: reviews.map(review => ({
                id: review.id,
                userName: review.userName,
                userUrl: review.userUrl,
                score: review.score,
                title: review.title,
                text: review.text,
                date: review.updated,
                version: review.version,
                url: review.url,
                hasDeveloperResponse: false // App Store API doesn't provide this info
              }))
            }, null, 2)
          }]
        };
      }
    } catch (error) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            error: error.message,
            appId,
            platform
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

// Tool 5: Get detailed pricing information
server.tool(
  "get_pricing_details",
  {
    appId: z.string().describe("The unique identifier for the app (Android package name, iOS numeric ID or bundle ID)."),
    platform: z.enum(["ios", "android"]).describe("The platform of the app ('ios' or 'android')."),
    country: z.string().length(2).optional().default("us").describe("Two-letter country code for store localization (affects currency and price). Default 'us'."),
    lang: z.string().optional().default("en").describe("Language code for results. Default 'en'.")
  },
  async ({ appId, platform, country, lang }) => {
    try {
      let appDetails;
      let pricingDetails = {
        appId,
        platform,
        basePrice: {
          amount: 0,
          currency: "USD",
          formattedPrice: "Free",
          isFree: true
        },
        inAppPurchases: {
          offers: false,
          priceRange: null,
          items: []
        },
        subscriptions: {
          offers: false,
          items: []
        }
      };
      
      if (platform === "android") {
        // Get app details from Google Play Store
        appDetails = await memoizedGplay.app({
          appId,
          country,
          lang
        });
        
        // Extract basic pricing info
        pricingDetails.basePrice = {
          amount: appDetails.price || 0,
          currency: appDetails.currency || "USD",
          formattedPrice: appDetails.priceText || "Free",
          isFree: appDetails.free === true
        };
        
        // Extract IAP information
        pricingDetails.inAppPurchases.offers = appDetails.offersIAP === true;
        pricingDetails.inAppPurchases.priceRange = appDetails.IAPRange || null;
        
        // Extract subscription info (if available)
        // Note: This is limited in Google Play Scraper
        if (appDetails.adSupported) {
          pricingDetails.adSupported = true;
        }
        
        // Try to parse IAP items from description if available
        if (appDetails.description && appDetails.offersIAP) {
          const iapMatches = appDetails.description.match(/(\$[\d\.]+)|([\d\.]+ [A-Z]{3})/g);
          if (iapMatches && iapMatches.length > 0) {
            // Simple extraction of potential IAP prices from description
            const uniquePrices = [...new Set(iapMatches)];
            pricingDetails.inAppPurchases.items = uniquePrices.map(price => ({
              type: "unknown", // Can't reliably determine from description
              price,
              isSubscription: price.toLowerCase().includes("month") || 
                             price.toLowerCase().includes("year") || 
                             price.toLowerCase().includes("annual")
            })).slice(0, 5); // Limit to top 5 potential IAP prices
          }
        }
      } else {
        // Get app details from Apple App Store
        // For iOS, we need to handle both numeric IDs and bundle IDs
        const isNumericId = /^\d+$/.test(appId);
        
        const lookupParams = isNumericId 
          ? { id: appId, country, lang } 
          : { appId: appId, country, lang };
        
        appDetails = await memoizedAppStore.app({
          ...lookupParams
        });
        
        // Extract basic pricing info
        pricingDetails.basePrice = {
          amount: appDetails.price || 0,
          currency: appDetails.currency || "USD",
          formattedPrice: appDetails.price === 0 ? "Free" : `${appDetails.price} ${appDetails.currency}`,
          isFree: appDetails.free === true
        };
        
        // Extract in-app purchase information
        // Note: App Store Scraper doesn't provide detailed IAP info directly
        // We can try to extract from description and release notes
        const hasPaidContent = appDetails.description && 
          (appDetails.description.includes("in-app purchase") || 
           appDetails.description.includes("subscription"));
        
        if (hasPaidContent) {
          pricingDetails.inAppPurchases.offers = true;
          
          // Try to extract potential subscription information
          const subscriptionMatches = appDetails.description && appDetails.description.match(
            /(monthly|annual|yearly|week|subscription).{1,30}(\$[\d\.]+|[\d\.]+ [A-Z]{3})/gi
          );
          
          if (subscriptionMatches && subscriptionMatches.length > 0) {
            pricingDetails.subscriptions.offers = true;
            
            // Simple extraction of potential subscription info from description
            const uniqueSubs = [...new Set(subscriptionMatches.map(s => s.trim()))];
            pricingDetails.subscriptions.items = uniqueSubs.map(sub => {
              let period = "unknown";
              if (sub.toLowerCase().includes("month")) period = "monthly";
              else if (sub.toLowerCase().includes("year") || sub.toLowerCase().includes("annual")) period = "yearly";
              else if (sub.toLowerCase().includes("week")) period = "weekly";
              
              // Extract price with regex
              const priceMatch = sub.match(/(\$[\d\.]+)|([\d\.]+ [A-Z]{3})/);
              const price = priceMatch ? priceMatch[0] : "Price unknown";
              
              return {
                period,
                price
              };
            }).slice(0, 3); // Limit to top 3 potential subscription options
          }
          
          // Try to extract other IAP information
          const iapMatches = appDetails.description && 
            appDetails.description.match(/in-app purchase.{1,30}(\$[\d\.]+|[\d\.]+ [A-Z]{3})/gi);
          
          if (iapMatches && iapMatches.length > 0) {
            // Simple extraction of potential IAP prices from description
            const uniqueIaps = [...new Set(iapMatches.map(s => s.trim()))];
            const pricesOnly = uniqueIaps.map(iap => {
              const priceMatch = iap.match(/(\$[\d\.]+)|([\d\.]+ [A-Z]{3})/);
              return priceMatch ? priceMatch[0] : null;
            }).filter(Boolean);
            
            if (pricesOnly.length > 0) {
              pricingDetails.inAppPurchases.items = pricesOnly.map(price => ({
                type: "consumable", // Assumption - can't reliably determine
                price
              })).slice(0, 5); // Limit to top 5 potential IAP prices
            }
          }
        }
      }
      
      // Add monetization model categorization
      pricingDetails.monetizationModel = determineMonetizationModel(pricingDetails);
      
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(pricingDetails, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            error: error.message,
            appId,
            platform
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

// Tool 6: Get comprehensive developer information
server.tool(
  "get_developer_info",
  {
    developerId: z.string().describe("The developer identifier. For Android: the name (e.g., 'Google LLC') or ID ('570031...'). For iOS: the numeric artist ID (e.g., '284882218') or the developer name ('Facebook'). If a name is provided for iOS, the tool will attempt to find the numeric ID."),
    platform: z.enum(["ios", "android"]).describe("The platform associated with the developer ('ios' or 'android')."),
    country: z.string().length(2).optional().default("us").describe("Two-letter country code for store localization. Default 'us'."),
    lang: z.string().optional().default("en").describe("Language code for results. Default 'en'."),
    includeApps: z.boolean().optional().default(true).describe("Whether to fetch and include details of the developer's apps in the response (up to 100 for Android, potentially more for iOS). Setting to false returns only developer metadata.")
  },
  async ({ developerId, platform, country, lang, includeApps }) => {
    try {
      let developerInfo = {
        developerId,
        platform,
        name: "",
        website: null,
        email: null,
        address: null,
        privacyPolicy: null,
        supportContact: null,
        totalApps: 0,
        metrics: {
          totalInstalls: 0,
          averageRating: 0,
          totalRatings: 0
        },
        apps: []
      };

      if (platform === "android") {
        // Get developer's apps from Google Play Store
        const apps = await memoizedGplay.developer({
          devId: developerId,
          country,
          lang,
          num: 100 // Get up to 100 apps
        });

        if (apps && apps.length > 0) {
          // Get full details of the first app to extract developer info
          const firstApp = await memoizedGplay.app({
            appId: apps[0].appId,
            country,
            lang
          });

          // Set developer details
          developerInfo = {
            ...developerInfo,
            name: firstApp.developer || developerId,
            website: firstApp.developerWebsite || null,
            email: firstApp.developerEmail || null,
            address: firstApp.developerAddress || null,
            privacyPolicy: firstApp.privacyPolicy || null,
            totalApps: apps.length,
            metrics: {
              totalInstalls: 0,
              averageRating: 0,
              totalRatings: 0
            }
          };

          // Calculate metrics across all apps
          let totalRating = 0;
          let totalRatings = 0;
          let totalInstalls = 0;

          if (includeApps) {
            // Get full details for all apps
            const appDetailsPromises = apps.map(app => 
              memoizedGplay.app({
                appId: app.appId,
                country,
                lang
              }).catch(err => null)
            );

            const appDetails = await Promise.all(appDetailsPromises);
            const validAppDetails = appDetails.filter(app => app !== null);

            validAppDetails.forEach(app => {
              if (app.score) totalRating += app.score;
              if (app.ratings) totalRatings += app.ratings;
              if (app.minInstalls) totalInstalls += app.minInstalls;
            });

            developerInfo.metrics = {
              totalInstalls,
              averageRating: totalRating / validAppDetails.length,
              totalRatings
            };

            // Add normalized app information
            developerInfo.apps = validAppDetails.map(app => ({
              appId: app.appId,
              title: app.title,
              icon: app.icon,
              score: app.score,
              ratings: app.ratings,
              installs: app.minInstalls,
              price: app.price,
              free: app.free,
              category: app.genre,
              url: app.url
            }));
          }
        }
      } else {
        // For iOS, first get the numeric developer ID if not provided
        const isNumericId = /^\d+$/.test(developerId);
        let numericDevId = developerId;

        if (!isNumericId) {
          // Search for an app by this developer to get their numeric ID
          const searchResults = await memoizedAppStore.search({
            term: developerId,
            num: 1,
            country
          });

          if (searchResults && searchResults.length > 0) {
            const firstApp = await memoizedAppStore.app({
              appId: searchResults[0].appId,
              country
            });
            numericDevId = firstApp.developerId;
          }
        }

        // Get developer's apps from App Store
        const apps = await memoizedAppStore.developer({
          devId: numericDevId,
          country,
          lang
        });

        if (apps && apps.length > 0) {
          // Get full details of the first app to extract developer info
          const firstApp = await memoizedAppStore.app({
            id: apps[0].id,
            country,
            lang
          });

          // Set developer details
          developerInfo = {
            ...developerInfo,
            name: firstApp.developer || developerId,
            website: firstApp.developerWebsite || null,
            totalApps: apps.length,
            metrics: {
              totalInstalls: null, // App Store doesn't provide install numbers
              averageRating: 0,
              totalRatings: 0
            }
          };

          if (includeApps) {
            // Get full details for all apps
            const appDetailsPromises = apps.map(app => 
              memoizedAppStore.app({
                id: app.id,
                country,
                lang,
                ratings: true
              }).catch(err => null)
            );

            const appDetails = await Promise.all(appDetailsPromises);
            const validAppDetails = appDetails.filter(app => app !== null);

            // Calculate metrics
            let totalRating = 0;
            let totalRatings = 0;

            validAppDetails.forEach(app => {
              if (app.score) totalRating += app.score;
              if (app.ratings) totalRatings += app.ratings;
            });

            developerInfo.metrics = {
              totalInstalls: null, // Not available in App Store
              averageRating: totalRating / validAppDetails.length,
              totalRatings
            };

            // Add normalized app information
            developerInfo.apps = validAppDetails.map(app => ({
              appId: app.appId,
              title: app.title,
              icon: app.icon,
              score: app.score,
              ratings: app.ratings,
              price: app.price,
              free: app.free,
              category: app.primaryGenre,
              url: app.url
            }));
          }
        }
      }

      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(developerInfo, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            error: error.message,
            developerId,
            platform
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

// Tool 7: Get version history and changelogs (platform limitations apply)
server.tool(
  "get_version_history",
  {
    appId: z.string().describe("The unique identifier for the app (Android package name, iOS numeric ID or bundle ID)."),
    platform: z.enum(["ios", "android"]).describe("The platform of the app. Note: Due to current API limitations, **only the latest version details are reliably returned for both platforms.**"),
    country: z.string().length(2).optional().default("us").describe("Two-letter country code for store localization. Default 'us'."),
    lang: z.string().optional().default("en").describe("Language code for the results (e.g., changelog text). Default 'en'.")
  },
  async ({ appId, platform, country, lang }) => {
    try {
      let versionInfo = {
        appId,
        platform,
        platformCapabilities: {
          fullHistoryAvailable: platform === "ios",
          description: platform === "ios" 
            ? "Full version history available" 
            : "Only latest version available due to Google Play Store limitations"
        },
        currentVersion: null,
        history: []
      };

      if (platform === "android") {
        // Get app details from Google Play Store
        const appDetails = await memoizedGplay.app({
          appId,
          country,
          lang
        });

        // For Android, we can only get the current version
        versionInfo.currentVersion = {
          versionNumber: appDetails.version,
          // Play omits the update timestamp for some apps; new Date(undefined)
          // is an Invalid Date and toISOString() throws on it. Mirror the guard
          // the iOS branch already has.
          releaseDate: appDetails.updated
            ? new Date(appDetails.updated).toISOString()
            : null,
          changelog: appDetails.recentChanges || "No changelog provided",
          isCurrentVersion: true
        };

        // Add current version to history array as well
        versionInfo.history = [versionInfo.currentVersion];

      } else {
        // For iOS, first handle numeric vs bundle ID
        const isNumericId = /^\d+$/.test(appId);
        let numericId = appId;

        try {
          // Get app details from Apple App Store
          const lookupParams = isNumericId 
            ? { id: appId, country, lang } 
            : { appId: appId, country, lang };
          
          console.error(`Getting app details for iOS app: ${JSON.stringify(lookupParams)}`);
          const appDetails = await memoizedAppStore.app(lookupParams);
          
          if (!appDetails) {
            throw new Error("No app details returned");
          }
          
          // Create version info from the current version data
          const currentVersion = {
            versionNumber: appDetails.version || "Unknown version",
            releaseDate: appDetails.updated 
              ? new Date(appDetails.updated).toISOString() 
              : new Date().toISOString(),
            changelog: appDetails.releaseNotes || "No changelog provided",
            isCurrentVersion: true
          };
          
          // Set history array to just the current version
          versionInfo.history = [currentVersion];
          versionInfo.currentVersion = currentVersion;
          
          // Set platform capabilities - currently same as Android due to API limitations
          versionInfo.platformCapabilities = {
            fullHistoryAvailable: false,
            description: "Only latest version available - API limitation (versionHistory function not available)"
          };
          
          console.error(`iOS version info created from app details: ${JSON.stringify(currentVersion)}`);
        } catch (error) {
          console.error(`Error getting iOS app details: ${error.message}`);
          
          // Set empty history and null current version
          versionInfo.history = [];
          versionInfo.currentVersion = null;
          
          // Update platform capabilities
          versionInfo.platformCapabilities = {
            fullHistoryAvailable: false,
            description: `Could not retrieve version information: ${error.message}`
          };
        }
      }

      // Add metadata about the response
      const metadata = {
        retrievalDate: new Date().toISOString(),
        totalVersions: versionInfo.history.length,
        limitations: platform === "android" 
          ? ["Only latest version available", "Historical data not accessible via Google Play Store API"]
          : []
      };

      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            ...versionInfo,
            metadata
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            error: error.message,
            appId,
            platform
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

// Tool to get similar apps
server.tool(
  "get_similar_apps",
  {
    appId: z.string().describe("The unique identifier for the app (Android package name, iOS numeric ID or bundle ID)."),
    platform: z.enum(["ios", "android"]).describe("The platform of the app ('ios' or 'android')."),
    country: z.string().length(2).optional().default("us").describe("Two-letter country code for the App Store/Play Store region. Default 'us'."),
    lang: z.string().optional().default("en").describe("Language code for the results. Default 'en'."),
    num: z.number().optional().default(20).describe("Number of similar apps to return (default 20).")
  },
  async ({ appId, platform, country, lang, num }) => {
    try {
      let similarApps = [];
      
      if (platform === "android") {
        // Get similar apps from Google Play Store
        const apps = await memoizedGplay.similar({
          appId,
          country,
          lang
        });
        
        // Limit results to num
        similarApps = apps.slice(0, num).map(app => ({
          id: app.appId,
          appId: app.appId,
          title: app.title,
          summary: app.summary || "",
          developer: app.developer,
          developerId: app.developerId,
          icon: app.icon,
          score: app.score,
          scoreText: app.scoreText,
          price: app.price,
          free: app.free,
          currency: app.currency || "USD",
          platform: "android",
          url: app.url
        }));
      } else {
        // For iOS, we need to check if appId is a numeric ID or bundle ID
        const isNumericId = /^\d+$/.test(appId);
        
        // Get similar apps from Apple App Store
        let iosParams = {};
        
        if (isNumericId) {
          iosParams = {
            id: appId,
            country
          };
        } else {
          iosParams = {
            appId,
            country
          };
        }
        
        const apps = await memoizedAppStore.similar(iosParams);
        
        // Limit results to num
        similarApps = apps.slice(0, num).map(app => ({
          id: app.id.toString(),
          appId: app.appId,
          title: app.title,
          summary: app.description || "",
          developer: app.developer,
          developerId: app.developerId,
          icon: app.icon,
          score: app.score,
          price: app.price,
          free: app.free === true,
          currency: app.currency,
          platform: "ios",
          url: app.url
        }));
      }
      
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            appId,
            platform,
            count: similarApps.length,
            similarApps
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            error: error.message,
            appId,
            platform
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

// Tool to get Google Play categories
server.tool(
  "get_android_categories",
  {},
  async () => {
    try {
      // Retrieve all categories from Google Play Store
      const categories = await gplay.categories();
      
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            platform: "android",
            count: categories.length,
            categories
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            error: error.message,
            platform: "android"
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

// Tool to get real search autocomplete suggestions from Google Play
server.tool(
  "get_search_suggestions",
  {
    term: z.string().describe("The seed term to get Google Play search autocomplete suggestions for (e.g., 'meditation', 'photo editor')."),
    country: z.string().length(2).optional().default("us").describe("Two-letter country code for store localization (e.g., 'us', 'es', 'mx'). Default 'us'."),
    lang: z.string().optional().default("en").describe("Language code for results (e.g., 'en', 'es'). Default 'en'.")
  },
  async ({ term, country, lang }) => {
    try {
      // gplay.suggest() returns Google Play's own autocomplete list for the term.
      // Results are passed through verbatim: no scoring, no ranking, no generated terms.
      const raw = await memoizedGplay.suggest({ term, country, lang });

      const suggestions = (Array.isArray(raw) ? raw : [])
        .map(entry => (typeof entry === "string" ? entry : entry?.suggestion))
        .filter(entry => typeof entry === "string" && entry.length > 0);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            term,
            platform: "android",
            country,
            lang,
            count: suggestions.length,
            suggestions,
            source: "Google Play search autocomplete (google-play-scraper suggest)",
            note: suggestions.length === 0
              ? "Google Play returned no autocomplete suggestions for this term in this country/language. The list is empty because the store suggested nothing; it has not been completed from any other source."
              : undefined
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: error.message,
            term,
            platform: "android"
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

return server;
}

// Helper function to determine app monetization model
function determineMonetizationModel(pricingDetails) {
  if (!pricingDetails.basePrice.isFree) {
    // Paid app
    return pricingDetails.inAppPurchases.offers ? 
      "Paid app with in-app purchases" : 
      "Paid app (premium)";
  } else if (pricingDetails.subscriptions.offers) {
    // Free app with subscriptions
    return pricingDetails.adSupported ? 
      "Freemium with ads and subscriptions" : 
      "Freemium with subscriptions";
  } else if (pricingDetails.inAppPurchases.offers) {
    // Free app with IAP
    return pricingDetails.adSupported ? 
      "Freemium with ads and in-app purchases" : 
      "Freemium with in-app purchases";
  } else if (pricingDetails.adSupported) {
    // Free with ads only
    return "Free with ads";
  } else {
    // Completely free
    return "Completely free";
  }
}

// Start the server (stdio) when this file is the entrypoint
async function main() {
  try {
    const server = createMcpAppStoreServer();
    const transport = new StdioServerTransport();
    console.error("Starting App Store Scraper MCP server...");
    await server.connect(transport);
  } catch (error) {
    console.error("Error starting MCP server:", error);
    process.exit(1);
  }
}

const isMainModule =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMainModule) {
  main();
} 
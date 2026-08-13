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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMemoizedIosAppStoreClient } from './ios-app-store-client.js';

// Create memoized versions of the scrapers
const memoizedGplay = gplay.memoized({
  maxAge: 1000 * 60 * 10, // 10 minutes cache
  max: 1000 // Maximum cache size
});

const memoizedAppStore = createMemoizedIosAppStoreClient();

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
    num: z.number().min(1).max(50).optional().default(10).describe("Number of top apps ranking for the keyword to analyze (1-50, default 10). These apps will be fetched with full details to provide comprehensive analysis."),
    country: z.string().length(2).optional().default("us").describe("Two-letter country code for store localization. Default 'us'."),
    lang: z.string().optional().default("en").describe("Language code for results. Default 'en'.")
  },
  async ({ keyword, platform, num, country, lang }) => {
    try {
      let results = [];
      
      if (platform === "android") {
        // Get search results from Google Play Store (fullDetail: true crashes in
        // google-play-scraper when category data is missing from the Play response)
        const searchResults = await memoizedGplay.search({
          term: keyword,
          num,
          country,
          lang,
          fullDetail: false
        });

        // await inside the try, otherwise the rejection escapes this catch and
        // one failed app rejects the whole Promise.all instead of degrading.
        const fullDetailsPromises = searchResults.map(async app => {
          try {
            return await memoizedGplay.app({ appId: app.appId, country, lang });
          } catch (err) {
            console.error(`Error fetching details for app ${app.appId}:`, err);
            return app;
          }
        });

        results = await Promise.all(fullDetailsPromises);
      } else {
        // Get search results from Apple App Store
        results = await memoizedAppStore.search({
          term: keyword,
          num,
          country,
          lang
        });
        
        // For Apple, we need to fetch full details for each app
        // await inside the try, otherwise the rejection escapes this catch and
        // one failed app rejects the whole Promise.all instead of degrading.
        const fullDetailsPromises = results.map(async app => {
          try {
            return await memoizedAppStore.app({ id: app.id, country, lang, ratings: true });
          } catch (err) {
            console.error(`Error fetching details for app ${app.id}:`, err);
            return app; // Return original data if full details fetch fails
          }
        });
        
        // Wait for all detail requests to complete
        results = await Promise.all(fullDetailsPromises);
      }
      
      // Normalize and extract key metrics
      const normalizedApps = results.map(app => {
        if (platform === "android") {
          return {
            appId: app.appId,
            title: app.title,
            developer: app.developer,
            developerId: app.developerId,
            installs: app.installs,
            minInstalls: app.minInstalls,
            score: app.score,
            ratings: app.ratings,
            free: app.free,
            price: app.price,
            currency: app.currency,
            category: app.genre,
            url: app.url,
            icon: app.icon
          };
        } else {
          return {
            appId: app.appId,
            title: app.title,
            developer: app.developer,
            developerId: app.developerId,
            score: app.score,
            ratings: app.ratings || 0,
            free: app.free,
            price: app.price,
            currency: app.currency,
            category: app.primaryGenre,
            url: app.url,
            icon: app.icon
          };
        }
      });
      
      // Calculate brand presence metrics
      const developerCounts = {};
      normalizedApps.forEach(app => {
        developerCounts[app.developer] = (developerCounts[app.developer] || 0) + 1;
      });
      
      // Sort developers by number of apps in results
      const sortedDevelopers = Object.entries(developerCounts)
        .sort((a, b) => b[1] - a[1])
        .map(entry => entry[0]);
      
      // Calculate average ratings and other metrics
      const totalApps = normalizedApps.length;
      const avgRating = normalizedApps.reduce((sum, app) => sum + (app.score || 0), 0) / totalApps;
      const paidApps = normalizedApps.filter(app => !app.free);
      const paidPercentage = (paidApps.length / totalApps) * 100;
      
      // Check for big brand presence (simplified algorithm)
      // Here we're assuming the top 2 developers with most apps are "big brands"
      const topBrands = sortedDevelopers.slice(0, 2);
      const topBrandAppsCount = topBrands.reduce((count, brand) => 
        count + developerCounts[brand], 0);
      const brandDominance = topBrandAppsCount / totalApps;
      
      // Determine competition level
      let competitionLevel;
      if (brandDominance > 0.7) {
        competitionLevel = "Low - dominated by major brands";
      } else if (brandDominance > 0.4) {
        competitionLevel = "Medium - mix of major brands and independents";
      } else {
        competitionLevel = "High - diverse set of developers";
      }
      
      // Create category distribution
      const categoryDistribution = {};
      normalizedApps.forEach(app => {
        const category = app.category;
        if (category) {
          categoryDistribution[category] = (categoryDistribution[category] || 0) + 1;
        }
      });
      
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            keyword,
            platform,
            topApps: normalizedApps,
            brandPresence: {
              topBrands,
              brandDominance: parseFloat(brandDominance.toFixed(2)),
              competitionLevel
            },
            metrics: {
              totalApps,
              averageRating: parseFloat(avgRating.toFixed(2)),
              paidAppsPercentage: parseFloat(paidPercentage.toFixed(2)),
              categoryDistribution
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
            platform
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
    num: z.number().min(1).max(1000).optional().default(100).describe("Target number of reviews to analyze (1-1000, default 100). Note: Actual number may be less due to API limitations or available reviews. For iOS, fetching requires multiple requests and is capped at page 10."),
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
        
        // Resolve the numeric id ONCE, before paging: doing it inside the loop
        // repeated the same lookup on every one of the 10 pages.
        let numericAppId = appId;
        if (!/^\d+$/.test(appId)) {
          try {
            const appDetails = await memoizedAppStore.app({ appId, country });
            numericAppId = appDetails.id.toString();
          } catch (appError) {
            console.error(`Could not fetch app details for ${appId}:`, appError.message);
            numericAppId = null;
          }
        }

        // For iOS, we might need to fetch multiple pages
        while (numericAppId && allReviews.length < num && page <= 10) { // App Store only allows 10 pages
          try {
            const iosParams = {
              id: numericAppId,
              page,
              sort: sortType,
              country
            };

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
      
      // Sentiment is anchored on the star rating the store already gives us —
      // it is a far stronger signal than a small keyword lexicon, and without it
      // any review using none of the listed words collapses to 'neutral',
      // reporting a 1-star/5-star split as a neutral middle. The lexicon is kept
      // as the tie-breaker and as the fallback when no rating is present.
      function analyzeSentiment(text, score) {
        const rating = typeof score === 'number' && score >= 1 && score <= 5
          ? score
          : null;

        if (!text) {
          if (rating === null) return 'neutral';
          if (rating >= 4) return 'positive';
          if (rating <= 2) return 'negative';
          return 'neutral';
        }

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
        
        // With a rating available, the stars decide the band and the wording
        // only decides how strongly to state it.
        if (rating !== null) {
          if (rating >= 4) {
            return negativeCount > positiveCount ? 'somewhat positive' : 'positive';
          }
          if (rating <= 2) {
            return positiveCount > negativeCount ? 'somewhat negative' : 'negative';
          }
          // 3 stars: genuinely mixed, so let the text break the tie.
          if (positiveCount > negativeCount) return 'somewhat positive';
          if (negativeCount > positiveCount) return 'somewhat negative';
          return 'neutral';
        }

        // No usable rating — fall back to the lexicon alone.
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
        const reviewText = review.text;
        const reviewScore = review.score;

        const sentiment = analyzeSentiment(reviewText, reviewScore);
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
      
      // Tally keywords within one sentiment band only. Ranking by the corpus-wide
      // count would make the positive and negative lists identical whenever a
      // common word shows up in reviews of both kinds.
      function countKeywordsBySentiment(sentiments) {
        const counts = {};
        processedReviews
          .filter(review => sentiments.includes(review.sentiment))
          .forEach(review => {
            review.keywords.forEach(keyword => {
              counts[keyword] = (counts[keyword] || 0) + 1;
            });
          });

        return Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .reduce((obj, [key, value]) => {
            obj[key] = value;
            return obj;
          }, {});
      }

      // Sort keywords by frequency and take top 20
      const topKeywords = Object.entries(keywordFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .reduce((obj, [key, value]) => {
          obj[key] = value;
          return obj;
        }, {});
      
      // Identify common themes.
      // A theme has to be actually recurring: substring matching against the
      // whole corpus ('free' inside 'freedom') with no threshold reported a
      // theme whenever one review out of hundreds used a related word. Match on
      // whole keywords and require a real share of the reviews.
      const THEME_MIN_REVIEWS = 3;
      const THEME_MIN_SHARE = 0.05;
      const themeThreshold = Math.max(
        THEME_MIN_REVIEWS,
        Math.ceil(totalReviews * THEME_MIN_SHARE)
      );

      function countReviewsMentioning(themeWords) {
        return processedReviews.filter(review =>
          review.keywords.some(keyword => themeWords.includes(keyword))
        ).length;
      }

      const themeDefinitions = [
        {
          words: ['bug', 'bugs', 'crash', 'crashes', 'crashing', 'freeze', 'freezes', 'frozen', 'stuck', 'error', 'errors', 'glitch', 'glitches'],
          theme: "Stability Issues",
          description: "Users are reporting crashes, bugs, or freezes"
        },
        {
          words: ['price', 'prices', 'pricing', 'cost', 'costs', 'expensive', 'cheap', 'subscription', 'subscriptions', 'payment', 'payments', 'refund', 'paywall'],
          theme: "Pricing Concerns",
          description: "Users are discussing price or subscription costs"
        },
        {
          words: ['interface', 'design', 'layout', 'ugly', 'beautiful', 'confusing', 'usability', 'intuitive', 'cluttered', 'navigation'],
          theme: "User Experience",
          description: "Users are commenting on the app's design or usability"
        }
      ];

      const commonThemes = themeDefinitions
        .map(definition => ({
          definition,
          mentions: countReviewsMentioning(definition.words)
        }))
        .filter(({ mentions }) => mentions >= themeThreshold)
        .map(({ definition, mentions }) => ({
          theme: definition.theme,
          description: definition.description,
          reviewsMentioning: mentions
        }));
      
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
              topPositiveKeywords: countKeywordsBySentiment(['positive', 'somewhat positive']),
              topNegativeKeywords: countKeywordsBySentiment(['negative', 'somewhat negative'])
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
    num: z.number().min(1).max(1000).optional().default(100).describe("Number of reviews to fetch (1-1000, default 100). Note: Actual number may be less due to API limitations. For iOS, limited to 10 pages max."),
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
        
        // Resolve the numeric id ONCE, before paging: doing it inside the loop
        // repeated the same lookup on every one of the 10 pages.
        let numericAppId = appId;
        if (!/^\d+$/.test(appId)) {
          try {
            const appDetails = await memoizedAppStore.app({ appId, country });
            numericAppId = appDetails.id.toString();
          } catch (appError) {
            console.error(`Could not fetch app details for ${appId}:`, appError.message);
            numericAppId = null;
          }
        }

        // For iOS, we might need to fetch multiple pages
        while (numericAppId && allReviews.length < num && page <= 10) { // App Store only allows 10 pages
          try {
            const iosParams = {
              id: numericAppId,
              page,
              sort: sortType,
              country
            };

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
          // The price pattern captures only the price itself, so the period has
          // to be read from the surrounding text — testing "$4.99" for the word
          // "month" can never be true.
          const pricePattern = /(\$[\d.]+)|([\d.]+ [A-Z]{3})/g;
          const seenPrices = new Set();
          const iapItems = [];

          for (const match of appDetails.description.matchAll(pricePattern)) {
            const price = match[0];
            if (seenPrices.has(price)) continue;
            seenPrices.add(price);

            const contextStart = Math.max(0, match.index - 40);
            const context = appDetails.description
              .slice(contextStart, match.index + price.length + 40)
              .toLowerCase();

            iapItems.push({
              type: "unknown", // Can't reliably determine from description
              price,
              isSubscription: /month|year|annual|week/.test(context)
            });
          }

          if (iapItems.length > 0) {
            pricingDetails.inAppPurchases.items = iapItems.slice(0, 5); // Limit to top 5 potential IAP prices
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
        // Case-insensitive: Apple's own listings say "In-App Purchases", which a
        // case-sensitive check would miss, skipping the whole block below.
        const descriptionLower = (appDetails.description || "").toLowerCase();
        const hasPaidContent = descriptionLower.includes("in-app purchase") ||
          descriptionLower.includes("subscription");
        
        if (hasPaidContent) {
          pricingDetails.inAppPurchases.offers = true;
          
          // Try to extract potential subscription information
          const subscriptionMatches = appDetails.description && appDetails.description.match(
            /(monthly|annual|yearly|week|subscription).{1,30}(\$[\d.]+|[\d.]+ [A-Z]{3})/gi
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
              const priceMatch = sub.match(/(\$[\d.]+)|([\d.]+ [A-Z]{3})/);
              const price = priceMatch ? priceMatch[0] : "Price unknown";
              
              return {
                period,
                price
              };
            }).slice(0, 3); // Limit to top 3 potential subscription options
          }
          
          // Try to extract other IAP information
          const iapMatches = appDetails.description && 
            appDetails.description.match(/in-app purchase.{1,30}(\$[\d.]+|[\d.]+ [A-Z]{3})/gi);
          
          if (iapMatches && iapMatches.length > 0) {
            // Simple extraction of potential IAP prices from description
            const uniqueIaps = [...new Set(iapMatches.map(s => s.trim()))];
            const pricesOnly = uniqueIaps.map(iap => {
              const priceMatch = iap.match(/(\$[\d.]+)|([\d.]+ [A-Z]{3})/);
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
              }).catch(() => null)
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
              }).catch(() => null)
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
          // Neither store exposes full history through the APIs used here; the
          // iOS branch below restates this after its lookup.
          fullHistoryAvailable: false,
          description: platform === "ios"
            ? "Only latest version available - API limitation (versionHistory function not available)"
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
          releaseDate: new Date(appDetails.updated).toISOString(),
          changelog: appDetails.recentChanges || "No changelog provided",
          isCurrentVersion: true
        };

        // Add current version to history array as well
        versionInfo.history = [versionInfo.currentVersion];

      } else {
        // For iOS, first handle numeric vs bundle ID
        const isNumericId = /^\d+$/.test(appId);

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

      // Add metadata about the response.
      // Derived from platformCapabilities rather than hard-coded per platform:
      // iOS is limited to the latest version too, so an empty list here used to
      // contradict the capabilities block set above.
      const metadata = {
        retrievalDate: new Date().toISOString(),
        totalVersions: versionInfo.history.length,
        limitations: versionInfo.platformCapabilities.fullHistoryAvailable
          ? []
          : platform === "android"
            ? ["Only latest version available", "Historical data not accessible via Google Play Store API"]
            : ["Only latest version available", "Historical data not accessible via the iTunes lookup API"]
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
    num: z.number().min(1).max(50).optional().default(20).describe("Number of similar apps to return (1-50, default 20).")
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
          summary: app.description?.substring(0, 100) || "",
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

// Tool to get keyword scores for ASO (App Store Optimization)
server.tool(
  "get_keyword_scores",
  {
    keyword: z.string().describe("The keyword to analyze for App Store Optimization. WARNING: this tool returns SYNTHETIC placeholder scores derived from the keyword string alone — they are not measured against either store and carry no market signal. The response is flagged with dataSource:'synthetic'. Do not use it for keyword research."),
    platform: z.enum(["ios", "android"]).describe("The platform to analyze the keyword for ('ios' or 'android')."),
    country: z.string().length(2).optional().default("us").describe("Two-letter country code for localization. Default 'us'.")
  },
  async ({ keyword, platform, country }) => {
    try {
      // NOTE: these figures are SYNTHETIC. The aso package has compatibility
      // issues, so nothing here is measured against the live stores — the only
      // real input is the keyword string itself. Every consumer-visible field
      // is therefore flagged via `dataSource: "synthetic"` below; do not remove
      // that flag without replacing the generator with real store data.

      // Deterministic pseudo-randomness: the same query must return the same
      // numbers every time, otherwise repeated calls silently disagree.
      const seedSource = `${keyword}|${platform}|${country}`;
      let seedState = 0;
      for (let i = 0; i < seedSource.length; i++) {
        seedState = (seedState * 31 + seedSource.charCodeAt(i)) >>> 0;
      }
      const rand = () => {
        // xorshift32 — small, dependency-free, stable across runs
        seedState ^= seedState << 13; seedState >>>= 0;
        seedState ^= seedState >> 17;
        seedState ^= seedState << 5; seedState >>>= 0;
        return seedState / 4294967296;
      };

      // Generate some semi-random scores based on keyword length and complexity
      const keywordLength = keyword.length;
      const difficultyBase = 5 + (Math.min(keywordLength, 15) / 5);
      const trafficBase = 10 - (Math.min(keywordLength, 20) / 5);

      // Add some variation to make scores look more natural
      const difficultyScore = Math.min(10, Math.max(0, difficultyBase + (rand() * 2 - 1))).toFixed(2);
      const trafficScore = Math.min(10, Math.max(0, trafficBase + (rand() * 2 - 1))).toFixed(2);

      // Create mock scores
      const mockScores = {
        difficulty: {
          titleMatches: { 
            exact: Math.floor(rand() * 10), 
            broad: Math.floor(rand() * 5), 
            partial: Math.floor(rand() * 5), 
            none: Math.floor(rand() * 3), 
            score: (rand() * 3 + 7).toFixed(2) 
          },
          competitors: { 
            count: Math.floor(rand() * 50) + 10, 
            score: (rand() * 3 + 5).toFixed(2) 
          },
          installs: { 
            avg: platform === "android" ? Math.floor(rand() * 10000000) + 500000 : Math.floor(rand() * 500000) + 10000, 
            score: (rand() * 3 + 7).toFixed(2) 
          },
          rating: { 
            avg: (rand() * 1 + 4).toFixed(2), 
            score: (rand() * 2 + 7).toFixed(2) 
          },
          age: { 
            avgDaysSinceUpdated: Math.floor(rand() * 100) + 10, 
            score: (rand() * 4 + 4).toFixed(2) 
          },
          score: parseFloat(difficultyScore)
        },
        traffic: {
          suggest: { 
            length: Math.floor(rand() * 4) + 1, 
            index: Math.floor(rand() * 5) + 1, 
            score: (rand() * 3 + 6).toFixed(2) 
          },
          ranked: { 
            count: Math.floor(rand() * 8) + 2, 
            avgRank: Math.floor(rand() * 80) + 10, 
            score: (rand() * 3 + 5).toFixed(2) 
          },
          installs: { 
            avg: platform === "android" ? Math.floor(rand() * 10000000) + 500000 : Math.floor(rand() * 500000) + 10000, 
            score: (rand() * 3 + 7).toFixed(2) 
          },
          length: { 
            length: keywordLength, 
            score: (10 - Math.min(keywordLength, 20) / 4).toFixed(2) 
          },
          score: parseFloat(trafficScore)
        }
      };
      
      // Add additional metadata
      const response = {
        keyword,
        platform,
        country,
        dataSource: "synthetic",
        warning: "These scores are NOT measured from the App Store or Google Play. They are generated from the keyword string alone and carry no market signal. Do not use them for keyword decisions or report them as research.",
        scores: {
          difficulty: {
            score: mockScores.difficulty.score,
            components: {
              titleMatches: mockScores.difficulty.titleMatches,
              competitors: mockScores.difficulty.competitors,
              installs: mockScores.difficulty.installs,
              rating: mockScores.difficulty.rating,
              age: mockScores.difficulty.age
            },
            interpretation: interpretDifficultyScore(mockScores.difficulty.score)
          },
          traffic: {
            score: mockScores.traffic.score,
            components: {
              suggest: mockScores.traffic.suggest,
              ranked: mockScores.traffic.ranked,
              installs: mockScores.traffic.installs,
              length: mockScores.traffic.length
            },
            interpretation: interpretTrafficScore(mockScores.traffic.score)
          }
        }
      };
      
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(response, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            error: error.message,
            keyword,
            platform
          }, null, 2)
        }],
        isError: true
      };
    }
  }
);

return server;
}

// Helper functions for keyword score interpretation
function interpretDifficultyScore(score) {
  if (score < 3) return "Very easy to rank for";
  if (score < 5) return "Easy to rank for";
  if (score < 7) return "Moderately difficult to rank for";
  if (score < 9) return "Difficult to rank for";
  return "Very difficult to rank for";
}

function interpretTrafficScore(score) {
  if (score < 3) return "Very low search traffic";
  if (score < 5) return "Low search traffic";
  if (score < 7) return "Moderate search traffic";
  if (score < 9) return "High search traffic";
  return "Very high search traffic";
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
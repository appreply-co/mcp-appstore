/**
 * MCP Server for App Store Scrapers - Simple Version
 * 
 * This server provides tools to search and analyze apps from both
 * Google Play Store and Apple App Store.
 */

import { z } from "zod";
import gplay from "google-play-scraper";
import appStore from "app-store-scraper";
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Create memoized versions of the scrapers
const memoizedGplay = gplay.memoized({
  maxAge: 1000 * 60 * 10, // 10 minutes cache
  max: 1000 // Maximum cache size
});

const memoizedAppStore = appStore.memoized({
  maxAge: 1000 * 60 * 10, // 10 minutes cache
  max: 1000 // Maximum cache size
});

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
    term: z.string().describe("The search term to look up"),
    platform: z.enum(["ios", "android"]).describe("The platform to search on (ios or android)"),
    num: z.number().min(1).max(250).optional().default(10).describe("Number of results to return (max 250)"),
    country: z.string().length(2).optional().default("us").describe("Two-letter country code")
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
    appId: z.string().describe("The app ID to get details for"),
    platform: z.enum(["ios", "android"]).describe("The platform of the app"),
    country: z.string().length(2).optional().default("us").describe("Two-letter country code"),
    lang: z.string().optional().default("en").describe("Language code for the results")
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
    keyword: z.string().describe("The keyword to analyze"),
    platform: z.enum(["ios", "android"]).describe("The platform to analyze"),
    num: z.number().optional().default(10).describe("Number of apps to analyze"),
    country: z.string().length(2).optional().default("us").describe("Two-letter country code"),
    lang: z.string().optional().default("en").describe("Language code for the results")
  },
  async ({ keyword, platform, num, country, lang }) => {
    try {
      let results = [];
      
      if (platform === "android") {
        // Get search results from Google Play Store
        results = await memoizedGplay.search({
          term: keyword,
          num,
          country,
          lang,
          fullDetail: true
        });
      } else {
        // Get search results from Apple App Store
        results = await memoizedAppStore.search({
          term: keyword,
          num,
          country,
          lang
        });
        
        // For Apple, we need to fetch full details for each app
        const fullDetailsPromises = results.map(app => {
          try {
            return memoizedAppStore.app({ id: app.id, country, lang, ratings: true });
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
    appId: z.string().describe("The app ID to analyze reviews for"),
    platform: z.enum(["ios", "android"]).describe("The platform of the app"),
    num: z.number().optional().default(100).describe("Number of reviews to analyze"),
    country: z.string().length(2).optional().default("us").describe("Two-letter country code"),
    lang: z.string().optional().default("en").describe("Language code for results"),
    sort: z.enum(["newest", "rating", "helpfulness"]).optional().default("newest").describe("How to sort the reviews")
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
            sortType = appStore.sort.RECENT;
            break;
          case "helpfulness":
            sortType = appStore.sort.HELPFUL;
            break;
          default:
            sortType = appStore.sort.RECENT;
        }
        
        // For iOS, we might need to fetch multiple pages
        while (allReviews.length < num && page <= 10) { // App Store only allows 10 pages
          try {
            // For iOS apps, we need to use id instead of appId
            // The app-store-scraper reviews method requires the numeric ID
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

// Start the server
async function main() {
  try {
    const transport = new StdioServerTransport();
    console.error("Starting App Store Scraper MCP server...");
    await server.connect(transport);
  } catch (error) {
    console.error("Error starting MCP server:", error);
    process.exit(1);
  }
}

main(); 
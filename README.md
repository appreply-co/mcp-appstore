# App Store Scraper MCP Server

This is an MCP (Model Context Protocol) server that provides tools for searching and analyzing apps from both the Google Play Store and Apple App Store. 

Perfect for ASO (App Store Search Optimization).

Built by [AppReply.co](https://appreply.co). For more information, see our [MCP documentation](https://appreply.co/docs/mcp-server/overview).

## Installation

```bash
# Clone the repository
git clone https://github.com/appreply-co/mcp-appstore.git
cd mcp-appstore

# Install dependencies
npm install
```

## Running the Server

```bash
npm start
```

This will start the server in studio mode, which is compatible with MCP clients.

**Claude Code:** Add to `.mcp.json` or your MCP config (path must be absolute; on Windows you can use forward slashes):

```json
{
  "mcpServers": {
    "mcp-appstore": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-appstore/server.js"]
    }
  }
}
```

Or: `claude mcp add --transport stdio mcp-appstore -- node /absolute/path/to/mcp-appstore/server.js`

**Claude Desktop:** Same `mcpServers` entry in `claude_desktop_config.json` (see Claude’s docs for the file path on your OS).

## Available Tools

The server provides the following tools:

### 1. search_app

Search for apps by name and platform.

**Parameters:**
- `term`: The search term to look up
- `platform`: The platform to search on (`ios` or `android`)
- `num` (optional): Number of results to return (default: 10, max: 250)
- `country` (optional): Two-letter country code (default: "us")

**Example usage:**
```javascript
const result = await client.callTool({
  name: "search_app",
  arguments: {
    term: "spotify",
    platform: "android",
    num: 5
  }
});
```

**Response:**
```json
{
  "query": "spotify",
  "platform": "android",
  "results": [
    {
      "id": "com.spotify.music",
      "appId": "com.spotify.music",
      "title": "Spotify: Music and Podcasts",
      "developer": "Spotify AB",
      "developerId": "Spotify+AB",
      "icon": "https://play-lh.googleusercontent.com/...",
      "score": 4.3,
      "scoreText": "4.3",
      "price": 0,
      "free": true,
      "platform": "android",
      "url": "https://play.google.com/store/apps/details?id=com.spotify.music"
    },
    // Additional results...
  ],
  "count": 5
}
```

### 2. get_app_details

Get detailed information about an app by ID.

**Parameters:**
- `appId`: The unique app ID (com.example.app for Android or numeric ID/bundleId for iOS)
- `platform`: The platform of the app (`ios` or `android`)
- `country` (optional): Two-letter country code (default: "us")
- `lang` (optional): Language code for the results (default: "en")

**Example usage:**
```javascript
const result = await client.callTool({
  name: "get_app_details",
  arguments: {
    appId: "com.spotify.music",
    platform: "android"
  }
});
```

**Response:**
```json
{
  "appId": "com.spotify.music",
  "platform": "android",
  "details": {
    "id": "com.spotify.music",
    "appId": "com.spotify.music",
    "title": "Spotify: Music and Podcasts",
    "description": "With Spotify, you can play millions of songs and podcasts for free...",
    "summary": "Listen to songs, podcasts, and playlists for free...",
    "developer": "Spotify AB",
    "developerId": "Spotify+AB",
    "developerEmail": "androidapp@spotify.com",
    "developerWebsite": "https://www.spotify.com/",
    "icon": "https://play-lh.googleusercontent.com/...",
    "headerImage": "https://play-lh.googleusercontent.com/...",
    "screenshots": ["https://play-lh.googleusercontent.com/...", "..."],
    "score": 4.3,
    "scoreText": "4.3",
    "ratings": 15678956,
    "reviews": 4567890,
    "histogram": {
      "1": 567890,
      "2": 234567,
      "3": 890123,
      "4": 2345678,
      "5": 11640698
    },
    "price": 0,
    "free": true,
    "currency": "USD",
    "categories": [
      { "name": "Music & Audio", "id": "MUSIC_AND_AUDIO" }
    ],
    "genre": "Music & Audio",
    "genreId": "MUSIC_AND_AUDIO",
    "contentRating": "Teen",
    "updated": 1648234567890,
    "version": "8.7.30.1356",
    "size": "30M",
    "recentChanges": "We're always making changes and improvements to Spotify...",
    "platform": "android"
  }
}
```

### 3. analyze_top_keywords

Analyze the apps ranking for a keyword and report the competitive landscape.

The response separates data into three blocks so a consumer can always tell where
a number came from:

| Block | Meaning |
|---|---|
| `observed` | Read straight from the store. No arithmetic applied. |
| `calculated` | Derived by this server from `observed`. Every figure carries the `sampleSize` it was computed over. |
| `unavailable` | Not published by the store and not covered by any external source wired into this server. Always `null` — never estimated. |

**Data integrity guarantees:**
- A missing value is `null`, never `0`, and never silently omitted.
- Averages are computed only over apps that actually have the value. An app
  without a rating is excluded from the sample, not counted as a rating of 0.
- If an app's detail fetch fails, the app is still returned (from the shallow
  search record) but marked `"dataCompleteness": "partial"` and listed in
  `observed.detailFetchFailures`. One failing app never fails the whole query.
- **No search volume or keyword difficulty is invented.** Neither store publishes
  them, so both are returned as `null` with an explanation.

**Parameters:**
- `keyword`: The keyword to analyze
- `platform`: The platform to analyze (`ios` or `android`)
- `country` (optional): Two-letter country code (default: "us")
- `lang` (optional): Language code for the results (default: "en")
- `num` (optional): Number of apps to analyze (integer, 1-50, default: 10)

**Example usage:**
```javascript
const result = await client.callTool({
  name: "analyze_top_keywords",
  arguments: {
    keyword: "fitness tracker",
    platform: "ios",
    num: 10
  }
});
```

**Response:**
```json
{
  "query": {
    "keyword": "fitness tracker",
    "platform": "ios",
    "country": "us",
    "lang": "en",
    "requestedNum": 10
  },
  "observed": {
    "appsRequested": 10,
    "appsReturned": 10,
    "appsWithFullDetail": 9,
    "appsWithPartialDetail": 1,
    "detailFetchFailures": [
      { "appId": "com.example.flaky", "reason": "Apple API request failed (503)" }
    ],
    "topApps": [
      {
        "appId": "com.fitbit.FitbitMobile",
        "storeId": 462638897,
        "title": "Fitbit: Health & Fitness",
        "developer": "Fitbit, Inc.",
        "developerId": "347935733",
        "free": true,
        "price": 0,
        "currency": "USD",
        "url": "https://apps.apple.com/us/app/fitbit/id...",
        "icon": "https://is1-ssl.mzstatic.com/...",
        "dataCompleteness": "full",
        "installs": null,
        "minInstalls": null,
        "score": 4.5,
        "ratingCount": 238456,
        "category": "Health & Fitness"
      }
      // Additional apps...
    ]
  },
  "calculated": {
    "rating": {
      "mean": 4.42, "median": 4.5, "min": 3.9, "max": 4.8,
      "sum": 39.8, "sampleSize": 9, "missing": 1
    },
    "ratingCount": {
      "mean": 51203.4, "median": 12947, "min": 774, "max": 238456,
      "sum": 460831, "sampleSize": 9, "missing": 1
    },
    "minInstalls": {
      "mean": null, "median": null, "min": null, "max": null,
      "sum": null, "sampleSize": 0, "missing": 10,
      "note": "Apple publishes no install counts; this sample is always empty for iOS."
    },
    "pricing": {
      "freeApps": 9, "paidApps": 0, "unknown": 1, "paidPercentage": 0
    },
    "developerConcentration": {
      "distinctDevelopers": 8,
      "sampleSize": 10,
      "topDeveloper": { "developer": "Fitbit, Inc.", "apps": 2, "share": 0.2 },
      "appsPerDeveloper": { "Fitbit, Inc.": 2, "Garmin": 2, "...": 1 },
      "herfindahlIndex": 0.14,
      "note": "Raw concentration of the result set. This is a measured distribution, not a difficulty or competitiveness rating."
    },
    "categoryDistribution": {
      "counts": { "Health & Fitness": 8, "Lifestyle": 1 },
      "unknown": 1
    }
  },
  "unavailable": {
    "searchVolume": null,
    "keywordDifficulty": null,
    "exactInstallCount": null,
    "impressions": null,
    "conversionRate": null,
    "notes": {
      "searchVolume": "Google Play and the App Store do not publish search volume, and this server has no external ASO data source connected yet. No estimate is produced.",
      "keywordDifficulty": "Neither store publishes a keyword difficulty metric, and this server has no external ASO data source connected yet. No heuristic score is produced; use `calculated` to judge competition yourself.",
      "exactInstallCount": "Google Play publishes only bucketed ranges; Apple publishes nothing.",
      "impressions": "Owner-only, via Play Console / App Store Connect.",
      "conversionRate": "Owner-only, via Play Console / App Store Connect."
    }
  }
}
```

> **Migration note:** this response shape replaces the previous top-level
> `keyword` / `platform` / `topApps` fields and the `brandPresence` and `metrics`
> objects. `brandPresence.competitionLevel`, `brandPresence.topBrands` and
> `brandPresence.brandDominance` were removed: they presented a subjective
> difficulty label as if it were store data, and the label's thresholds were
> inverted. Use `calculated.developerConcentration` for the underlying numbers.

### 4. analyze_reviews

Analyze app reviews and ratings to extract user sentiment and key insights.

**Parameters:**
- `appId`: The unique app ID (com.example.app for Android or numeric ID/bundleId for iOS)
- `platform`: The platform of the app (`ios` or `android`)
- `country` (optional): Two-letter country code (default: "us")
- `lang` (optional): Language code for the results (default: "en")
- `sort` (optional): How to sort the reviews (`newest`, `rating`, `helpfulness`) (default: "newest")
- `num` (optional): Number of reviews to analyze (default: 100, max: 1000)

**Example usage:**
```javascript
const result = await client.callTool({
  name: "analyze_reviews",
  arguments: {
    appId: "com.spotify.music",
    platform: "android",
    sort: "helpfulness",
    num: 200
  }
});
```

**Response:**
```json
{
  "appId": "com.spotify.music",
  "platform": "android",
  "totalReviewsAnalyzed": 200,
  "analysis": {
    "sentimentBreakdown": {
      "positive": 62.5,
      "somewhat positive": 15.0,
      "neutral": 10.0,
      "somewhat negative": 7.5,
      "negative": 5.0
    },
    "keywordFrequency": {
      "music": 89,
      "playlist": 76,
      "premium": 65,
      "offline": 43,
      "podcasts": 38,
      "shuffle": 27,
      "recommend": 25,
      "interface": 21,
      "free": 19,
      "account": 18
    },
    "ratingDistribution": {
      "1": 10,
      "2": 15,
      "3": 20,
      "4": 55,
      "5": 100
    },
    "commonThemes": [
      {
        "theme": "User Experience",
        "description": "Users are commenting on the app's design or usability"
      },
      {
        "theme": "Pricing Concerns",
        "description": "Users are discussing price or subscription costs"
      }
    ],
    "recentIssues": {
      "premium": 12,
      "account": 8,
      "login": 7,
      "crash": 5,
      "error": 4
    },
    "topPositiveKeywords": {
      "music": 65,
      "playlist": 48,
      "recommend": 22,
      "discover": 18,
      "variety": 15
    },
    "topNegativeKeywords": {
      "premium": 18,
      "shuffle": 12,
      "advertisements": 10,
      "connect": 8,
      "subscription": 7
    }
  }
}
```

### 5. fetch_reviews

Fetches raw reviews without analysis, including developer responses for Android apps.

**Parameters:**
- `appId`: The unique app ID (com.example.app for Android or numeric ID/bundleId for iOS)
- `platform`: The platform of the app (`ios` or `android`)
- `country` (optional): Two-letter country code (default: "us")
- `lang` (optional): Language code for the results (default: "en")
- `sort` (optional): How to sort the reviews (`newest`, `rating`, `helpfulness`) (default: "newest")
- `num` (optional): Number of reviews to fetch (default: 100, max: 1000)

**Example usage:**
```javascript
const result = await client.callTool({
  name: "fetch_reviews",
  arguments: {
    appId: "com.spotify.music",
    platform: "android",
    sort: "helpfulness",
    num: 50
  }
});
```

**Response for Android:**
```json
{
  "appId": "com.spotify.music",
  "platform": "android",
  "count": 50,
  "reviews": [
    {
      "id": "gp:AOqpTOFmAVORqfWGcaqfF39ftwFjGkjecjvjXnC3g_uL0NtVGlrrqm8X2XUWx0WydH3C9afZlPUizYVZAfARLuk",
      "userName": "John Smith",
      "userImage": "https://lh3.googleusercontent.com/-hBGvzn3XlhQ/AAAAAAAAAAI/AAAAAAAAOw0/L4GY9KrQ-DU/w96-c-h96/photo.jpg",
      "score": 4,
      "scoreText": "4",
      "title": "Great app but one issue",
      "text": "Love the app but please fix the offline mode issue.",
      "date": "2023-01-15T18:31:42.174Z",
      "url": "https://play.google.com/store/apps/details?id=com.spotify.music&reviewId=...",
      "version": "8.7.30.1356",
      "thumbsUp": 56,
      "replyDate": "2023-01-16T10:22:33.174Z",
      "replyText": "Thanks for your feedback! We're working on a fix for the offline mode issue.",
      "hasDeveloperResponse": true
    },
    // Additional reviews...
  ]
}
```

**Response for iOS:**
```json
{
  "appId": "324684580",
  "platform": "ios",
  "count": 50,
  "reviews": [
    {
      "id": "6934893147",
      "userName": "SpotifyUser2023",
      "userUrl": "https://itunes.apple.com/us/reviews/id324568166",
      "score": 5,
      "title": "Best music app ever!",
      "text": "I've been using Spotify for years and it keeps getting better.",
      "date": "2023-02-10T14:23:17-07:00",
      "version": "8.8.12",
      "url": "https://itunes.apple.com/us/review?id=324684580&type=Purple%20Software",
      "hasDeveloperResponse": false
    },
    // Additional reviews...
  ]
}
```

### 6. get_similar_apps

Returns a list of similar or related apps ("Customers also bought" for iOS, "Similar apps" for Android).

**Parameters:**
- `appId`: The unique app ID (com.example.app for Android or numeric ID/bundleId for iOS)
- `platform`: The platform of the app (`ios` or `android`)
- `country` (optional): Two-letter country code (default: "us")
- `lang` (optional): Language code for the results (default: "en")
- `num` (optional): Number of similar apps to return (default: 20)

**Example usage:**
```javascript
const result = await client.callTool({
  name: "get_similar_apps",
  arguments: {
    appId: "com.spotify.music",
    platform: "android",
    num: 10
  }
});
```

**Response:**
```json
{
  "appId": "com.spotify.music",
  "platform": "android",
  "count": 10,
  "similarApps": [
    {
      "id": "com.pandora.android",
      "appId": "com.pandora.android",
      "title": "Pandora: Music & Podcasts",
      "summary": "Listen to your favorite music and podcasts anywhere",
      "developer": "Pandora",
      "developerId": "Pandora+Media%2C+Inc.",
      "icon": "https://play-lh.googleusercontent.com/b3MuISSUiJ7mzJAb4GnwgVc8AH-Lj1iXZC-JqU8Bh-OlzXHRqOUkXmhdrLzGUgUVqA4=s180",
      "score": 4.3,
      "scoreText": "4.3",
      "price": 0,
      "free": true,
      "currency": "USD",
      "platform": "android",
      "url": "https://play.google.com/store/apps/details?id=com.pandora.android&hl=en&gl=us"
    },
    {
      "id": "deezer.android.app",
      "appId": "deezer.android.app",
      "title": "Deezer: Music & Podcast Player",
      "summary": "Stream music, create playlists and enjoy podcasts",
      "developer": "Deezer",
      "developerId": "Deezer+Mobile",
      "icon": "https://play-lh.googleusercontent.com/mOkjDMwP8I79j8jFZ9nP88tRpZrPGwOoFxJC9pWQj1_vR8M4JM_wR7-8UBWwdOUGgw=s180",
      "score": 4.1,
      "scoreText": "4.1",
      "price": 0,
      "free": true,
      "currency": "USD",
      "platform": "android", 
      "url": "https://play.google.com/store/apps/details?id=deezer.android.app&hl=en&gl=us"
    },
    // Additional apps...
  ]
}
```

### 7. get_pricing_details

Get detailed pricing information and monetization model for an app.

**Parameters:**
- `appId`: The unique app ID (com.example.app for Android or numeric ID/bundleId for iOS)
- `platform`: The platform of the app (`ios` or `android`)
- `country` (optional): Two-letter country code (default: "us")
- `lang` (optional): Language code for the results (default: "en")

**Example usage:**
```javascript
const result = await client.callTool({
  name: "get_pricing_details",
  arguments: {
    appId: "com.spotify.music",
    platform: "android"
  }
});
```

**Response:**
```json
{
  "appId": "com.spotify.music",
  "platform": "android",
  "basePrice": {
    "amount": 0,
    "currency": "USD",
    "formattedPrice": "Free",
    "isFree": true
  },
  "inAppPurchases": {
    "offers": true,
    "priceRange": "$0.99 - $14.99",
    "items": [
      {
        "type": "unknown",
        "price": "$9.99",
        "isSubscription": true
      },
      {
        "type": "unknown",
        "price": "$4.99",
        "isSubscription": false
      }
    ]
  },
  "subscriptions": {
    "offers": true,
    "items": [
      {
        "period": "monthly",
        "price": "$9.99"
      },
      {
        "period": "yearly",
        "price": "$99.99"
      }
    ]
  },
  "adSupported": true,
  "monetizationModel": "Freemium with ads and subscriptions"
}
```

### 8. get_developer_info

Get comprehensive information about a developer/publisher and their portfolio of apps.

**Parameters:**
- `developerId`: The developer ID to get information for
- `platform`: The platform of the developer (`ios` or `android`)
- `country` (optional): Two-letter country code (default: "us")
- `lang` (optional): Language code for the results (default: "en")
- `includeApps` (optional): Whether to include the developer's apps in the response (default: true)

**Example usage:**
```javascript
const result = await client.callTool({
  name: "get_developer_info",
  arguments: {
    developerId: "Spotify AB",
    platform: "android"
  }
});
```

**Response:**
```json
{
  "developerId": "Spotify AB",
  "platform": "android",
  "name": "Spotify AB",
  "website": "https://www.spotify.com",
  "email": "android-support@spotify.com",
  "address": "Regeringsgatan 19, Stockholm 111 53, Sweden",
  "privacyPolicy": "https://www.spotify.com/legal/privacy-policy/",
  "supportContact": "android-support@spotify.com",
  "totalApps": 3,
  "metrics": {
    "totalInstalls": 1000000000,
    "averageRating": 4.3,
    "totalRatings": 22000000
  },
  "apps": [
    {
      "appId": "com.spotify.music",
      "title": "Spotify: Music and Podcasts",
      "icon": "https://play-lh.googleusercontent.com/...",
      "score": 4.3,
      "ratings": 15000000,
      "installs": 1000000000,
      "price": 0,
      "free": true,
      "category": "Music & Audio",
      "url": "https://play.google.com/store/apps/details?id=com.spotify.music"
    },
    // Additional apps...
  ]
}
```

### 9. get_version_history

Get version history and changelogs for an app. **Note: Currently only provides the latest version for both platforms due to API limitations.**

**Parameters:**
- `appId`: The unique app ID (com.example.app for Android or numeric ID/bundleId for iOS)
- `platform`: The platform of the app (`ios` or `android`)
- `country` (optional): Two-letter country code (default: "us")
- `lang` (optional): Language code for the results (default: "en")

**Example usage:**
```javascript
const result = await client.callTool({
  name: "get_version_history",
  arguments: {
    appId: "com.spotify.music",
    platform: "ios"
  }
});
```

**Response for iOS:**
```json
{
  "appId": "com.spotify.music",
  "platform": "ios",
  "platformCapabilities": {
    "fullHistoryAvailable": true,
    "description": "Full version history available"
  },
  "currentVersion": {
    "versionNumber": "8.8.40",
    "releaseDate": "2024-03-28T14:52:32Z",
    "changelog": "Bug fixes and improvements",
    "isCurrentVersion": true
  },
  "history": [
    {
      "versionNumber": "8.8.40",
      "releaseDate": "2024-03-28T14:52:32Z",
      "changelog": "Bug fixes and improvements",
      "isCurrentVersion": true
    },
    {
      "versionNumber": "8.8.38",
      "releaseDate": "2024-03-14T10:23:15Z",
      "changelog": "New features and performance improvements",
      "isCurrentVersion": false
    }
    // Additional version history...
  ],
  "metadata": {
    "retrievalDate": "2024-03-31T12:34:56Z",
    "totalVersions": 50,
    "limitations": []
  }
}
```

**Response for Android:**
```json
{
  "appId": "com.spotify.music",
  "platform": "android",
  "platformCapabilities": {
    "fullHistoryAvailable": false,
    "description": "Only latest version available due to Google Play Store limitations"
  },
  "currentVersion": {
    "versionNumber": "8.8.40.480",
    "releaseDate": "2024-03-28T14:52:32Z",
    "changelog": "We're always making changes and improvements to Spotify",
    "isCurrentVersion": true
  },
  "history": [
    {
      "versionNumber": "8.8.40.480",
      "releaseDate": "2024-03-28T14:52:32Z",
      "changelog": "We're always making changes and improvements to Spotify",
      "isCurrentVersion": true
    }
  ],
  "metadata": {
    "retrievalDate": "2024-03-31T12:34:56Z",
    "totalVersions": 1,
    "limitations": [
      "Only latest version available",
      "Historical data not accessible via Google Play Store API"
    ]
  }
}
```

### 10. get_android_categories

Retrieves a full list of all available app categories from the Google Play Store.

**Parameters:**
This tool doesn't require any parameters.

**Example usage:**
```javascript
const result = await client.callTool({
  name: "get_android_categories",
  arguments: {}
});
```

**Response:**
```json
{
  "platform": "android",
  "count": 1,
  "categories": [
    "APPLICATION"
  ]
}
```

**Note:** The specific category list returned may vary depending on the Google Play Store API version and region. In the current implementation, only the "APPLICATION" category is typically returned, despite the Google Play Store having many more categories visible on the web interface. This is a limitation of the underlying API.

### 11. get_search_suggestions

Returns Google Play's own search autocomplete suggestions for a seed term. The suggestions are whatever the store returns, passed through verbatim — no scoring, no ranking, and no terms generated by this server.

> **Replaces `get_keyword_scores`.** That tool fabricated difficulty and traffic
> scores with `Math.random()` and returned them as if they were ASO metrics. It was
> removed rather than repaired: neither store publishes keyword difficulty or search
> volume, so there was nothing real to compute those scores from. For what the stores
> *do* expose, see `analyze_top_keywords` — and its `unavailable` block for what they
> do not.

**Android only.** The App Store has no equivalent public autocomplete endpoint, so there is no `platform` parameter; the response always reports `"platform": "android"`.

**Parameters:**
- `term`: The seed term to get suggestions for (e.g. `"meditation"`, `"photo editor"`)
- `country` (optional): Two-letter country code for store localization (default: `"us"`)
- `lang` (optional): Language code for results (default: `"en"`)

**Example usage:**
```javascript
const result = await client.callTool({
  name: "get_search_suggestions",
  arguments: {
    term: "tarot",
    country: "es",
    lang: "es"
  }
});
```

**Response:**
```json
{
  "term": "tarot",
  "platform": "android",
  "country": "es",
  "lang": "es",
  "count": 5,
  "suggestions": [
    "tarot",
    "tarot gratis",
    "tarot gratis en español mas fiable",
    "tarot gratis en español",
    "tarot ia"
  ],
  "source": "Google Play search autocomplete (google-play-scraper suggest)"
}
```

An empty `suggestions` array means Google Play suggested nothing for that term in that country/language. The response carries an explicit `note` saying so, so an empty list is never mistaken for a failed call — and it is never padded from another source.

## Connecting with MCP Clients

You can connect to this server using any MCP client. Here's an example using the MCP TypeScript SDK:

```javascript
import { Client } from "@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/dist/esm/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["server.js"]
});

const client = new Client(
  {
    name: "app-store-client",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

await client.connect(transport);

// Call a tool
const result = await client.callTool({
  name: "search_app",
  arguments: {
    term: "spotify",
    platform: "android",
    num: 5
  }
});

console.log(JSON.parse(result.content[0].text));
```

## Performance Considerations

- The server uses memoization to cache API responses for 10 minutes to reduce external API calls
- For large numbers of reviews or extensive keyword analysis, expect longer response times
- The server includes rate limiting protection to avoid triggering API restrictions

## Dependencies

This server uses the following libraries:
- [google-play-scraper](https://github.com/facundoolano/google-play-scraper)
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- [zod](https://github.com/colinhacks/zod)

## License

MIT

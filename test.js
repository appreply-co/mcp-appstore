/**
 * Tests for App Store Scraper MCP server
 * 
 * This file contains tests for all the tools provided by the MCP server:
 * - search_app
 * - get_app_details
 * - analyze_top_keywords
 * - analyze_reviews
 * - get_pricing_details
 * - get_developer_info
 * - get_version_history
 */

import assert from 'assert';
import { Client } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

// Test timeout value (in ms)
const TEST_TIMEOUT = 60000; // Increased to 60s for cross-platform testing

// Test app IDs
const ANDROID_APP_ID = 'com.spotify.music';
const IOS_APP_ID = '324684580'; // Spotify App Store ID 
const IOS_APP_ID_REVIEWS = '284882215'; // Facebook App - confirmed working for reviews

// Test developer IDs
const ANDROID_DEV_ID = 'Spotify AB';
const IOS_DEV_ID = '324684580';  // Spotify developer ID

/**
 * Helper function to wait for a specific amount of time
 * @param {number} ms - Number of milliseconds to wait
 * @returns {Promise} Promise that resolves after the specified time
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Run tests for all tools
 */
async function runTests() {
  // Keep track of failed tests
  const failedTests = [];
  let client = null;
  let transport = null;
  
  console.log('Starting MCP App Store Scraper tests...');
  
  try {
    // Start the server and connect the client
    console.log('Connecting to MCP server...');
    transport = new StdioClientTransport({
      command: "node",
      args: ["server.js"]
    });
    client = new Client(
      {
        name: "app-store-test-client",
        version: "1.0.0"
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );
    await client.connect(transport);
    
    console.log('Connected to MCP server.');
    
    // Test 1: Verify server configuration
    try {
      console.log('\nTest 1: Verify server configuration');
      
      // Test the search_app tool which will confirm the server is working
      const searchResult = await client.callTool({
        name: "search_app",
        arguments: {
          term: "test",
          platform: "android",
          num: 1
        }
      });
      
      // If we got here, the server is running with the expected configuration
      console.log('✅ Server configuration verified');
    } catch (error) {
      console.error('❌ Server configuration test failed:', error.message);
      failedTests.push('Server configuration');
    }
    
    // Test 2: Verify available tools
    try {
      console.log('\nTest 2: Verify available tools');
      
      // Get tools list
      const expectedTools = [
        "search_app", 
        "get_app_details", 
        "analyze_top_keywords", 
        "analyze_reviews",
        "get_pricing_details",
        "get_developer_info",
        "get_version_history"
      ];
      
      // Check each tool exists
      let toolErrors = [];
      for (const toolName of expectedTools) {
        try {
          console.log(`  Checking tool: ${toolName}`);
          // Attempt a simple call with minimal valid args
          await client.callTool({
            name: toolName,
            arguments: getMinimalArgs(toolName)
          });
        } catch (err) {
          toolErrors.push(`${toolName}: ${err.message}`);
        }
        await wait(500);
      }
      
      if (toolErrors.length > 0) {
        throw new Error(`Some tools failed validation: ${toolErrors.join(', ')}`);
      }
      
      console.log('✅ Available tools verified');
    } catch (error) {
      console.error('❌ Available tools test failed:', error.message);
      failedTests.push('Available tools');
    }
    
    // Test 3: Test search_app tool
    try {
      console.log('\nTest 3: Test search_app tool');
      console.log('  Searching for "spotify" on Android...');
      
      const searchResult = await client.callTool({
        name: "search_app",
        arguments: {
          term: "spotify",
          platform: "android",
          num: 3
        }
      });
      
      // Parse the result
      const searchData = JSON.parse(searchResult.content[0].text);
      
      assert(searchData.query === "spotify", "Search query should be 'spotify'");
      assert(searchData.platform === "android", "Platform should be 'android'");
      assert(Array.isArray(searchData.results), "Results should be an array");
      assert(searchData.results.length > 0, "Results should not be empty");
      assert(searchData.results[0].platform === "android", "Results should be for Android platform");
      
      // Allow a brief pause between API calls
      await wait(1000);
      
      console.log('  Searching for "netflix" on iOS...');
      const iosSearchResult = await client.callTool({
        name: "search_app",
        arguments: {
          term: "netflix",
          platform: "ios",
          num: 3
        }
      });
      
      // Parse the result
      const iosSearchData = JSON.parse(iosSearchResult.content[0].text);
      
      assert(iosSearchData.query === "netflix", "Search query should be 'netflix'");
      assert(iosSearchData.platform === "ios", "Platform should be 'ios'");
      assert(Array.isArray(iosSearchData.results), "Results should be an array");
      assert(iosSearchData.results.length > 0, "Results should not be empty");
      assert(iosSearchData.results[0].platform === "ios", "Results should be for iOS platform");
      
      console.log('✅ search_app tool test passed');
    } catch (error) {
      console.error('❌ search_app test failed:', error.message);
      failedTests.push('search_app');
    }
    
    // Test 4: Test get_app_details tool
    try {
      console.log('\nTest 4: Test get_app_details tool');
      await wait(1000);
      
      console.log('  Getting details for Spotify on Android...');
      const androidDetailsResult = await client.callTool({
        name: "get_app_details",
        arguments: {
          appId: ANDROID_APP_ID,
          platform: "android"
        }
      });
      
      // Parse the result
      const androidDetailsData = JSON.parse(androidDetailsResult.content[0].text);
      
      assert(androidDetailsData.appId === ANDROID_APP_ID, `App ID should be '${ANDROID_APP_ID}'`);
      assert(androidDetailsData.platform === "android", "Platform should be 'android'");
      assert(androidDetailsData.details, "Details should be present");
      assert(androidDetailsData.details.title.toLowerCase().includes("spotify"), "Title should include 'spotify'");
      
      // Test iOS app details
      await wait(1000);
      console.log('  Getting details for Spotify on iOS...');
      const iosDetailsResult = await client.callTool({
        name: "get_app_details",
        arguments: {
          appId: IOS_APP_ID,
          platform: "ios"
        }
      });
      
      // Parse the result
      const iosDetailsData = JSON.parse(iosDetailsResult.content[0].text);
      
      assert(iosDetailsData.appId === IOS_APP_ID, `App ID should be '${IOS_APP_ID}'`);
      assert(iosDetailsData.platform === "ios", "Platform should be 'ios'");
      assert(iosDetailsData.details, "Details should be present");
      assert(iosDetailsData.details.title.toLowerCase().includes("spotify"), "Title should include 'spotify'");
      
      console.log('✅ get_app_details tool test passed for both platforms');
    } catch (error) {
      console.error('❌ get_app_details test failed:', error.message);
      failedTests.push('get_app_details');
    }
    
    // Test 5: Test analyze_top_keywords tool
    try {
      console.log('\nTest 5: Test analyze_top_keywords tool');
      await wait(1000);
      
      // Test iOS first
      console.log('  Analyzing keyword "fitness tracker" on iOS...');
      const iosKeywordResult = await client.callTool({
        name: "analyze_top_keywords",
        arguments: {
          keyword: "fitness tracker",
          platform: "ios",
          num: 5
        }
      });
      
      // Parse the result
      const iosKeywordData = JSON.parse(iosKeywordResult.content[0].text);
      
      assert(iosKeywordData.keyword === "fitness tracker", "Keyword should be 'fitness tracker'");
      assert(iosKeywordData.platform === "ios", "Platform should be 'ios'");
      assert(iosKeywordData.topApps, "Top apps should be present");
      assert(Array.isArray(iosKeywordData.topApps), "Top apps should be an array");
      assert(iosKeywordData.brandPresence, "Brand presence should be present");
      
      // Test Android 
      await wait(1000);
      console.log('  Analyzing keyword "fitness tracker" on Android...');
      const androidKeywordResult = await client.callTool({
        name: "analyze_top_keywords",
        arguments: {
          keyword: "fitness tracker",
          platform: "android",
          num: 5
        }
      });
      
      // Parse the result
      const androidKeywordData = JSON.parse(androidKeywordResult.content[0].text);
      
      assert(androidKeywordData.keyword === "fitness tracker", "Keyword should be 'fitness tracker'");
      assert(androidKeywordData.platform === "android", "Platform should be 'android'");
      assert(androidKeywordData.topApps, "Top apps should be present");
      assert(Array.isArray(androidKeywordData.topApps), "Top apps should be an array");
      assert(androidKeywordData.brandPresence, "Brand presence should be present");
      
      console.log('✅ analyze_top_keywords tool test passed for both platforms');
    } catch (error) {
      console.error('❌ analyze_top_keywords test failed:', error.message);
      failedTests.push('analyze_top_keywords');
    }
    
    // Test 6: Test analyze_reviews tool
    try {
      console.log('\nTest 6: Test analyze_reviews tool');
      await wait(1000);
      
      // Test Android reviews
      console.log('  Analyzing reviews for Spotify on Android...');
      const androidReviewsResult = await client.callTool({
        name: "analyze_reviews",
        arguments: {
          appId: ANDROID_APP_ID,
          platform: "android",
          num: 50
        }
      });
      
      // Parse the result
      const androidReviewsData = JSON.parse(androidReviewsResult.content[0].text);
      
      assert(androidReviewsData.appId === ANDROID_APP_ID, `App ID should be '${ANDROID_APP_ID}'`);
      assert(androidReviewsData.platform === "android", "Platform should be 'android'");
      assert(androidReviewsData.analysis, "Analysis should be present");
      assert(androidReviewsData.analysis.sentimentBreakdown, "Sentiment breakdown should be present");
      assert(androidReviewsData.analysis.keywordFrequency, "Keyword frequency should be present");
      
      // Test iOS reviews
      await wait(1000);
      console.log('  Analyzing reviews for Facebook on iOS...');
      const iosReviewsResult = await client.callTool({
        name: "analyze_reviews",
        arguments: {
          appId: IOS_APP_ID_REVIEWS,
          platform: "ios",
          num: 50
        }
      });
      
      // Parse the result
      const iosReviewsData = JSON.parse(iosReviewsResult.content[0].text);
      
      assert(iosReviewsData.appId === IOS_APP_ID_REVIEWS, `App ID should be '${IOS_APP_ID_REVIEWS}'`);
      assert(iosReviewsData.platform === "ios", "Platform should be 'ios'");
      assert(iosReviewsData.analysis, "Analysis should be present");
      assert(iosReviewsData.analysis.sentimentBreakdown, "Sentiment breakdown should be present");
      assert(iosReviewsData.analysis.keywordFrequency, "Keyword frequency should be present");
      
      console.log('✅ analyze_reviews tool test passed for both platforms');
    } catch (error) {
      console.error('❌ analyze_reviews test failed:', error.message);
      failedTests.push('analyze_reviews');
    }
    
    // Test 7: Test get_pricing_details tool
    try {
      console.log('\nTest 7: Test get_pricing_details tool');
      await wait(1000);
      
      // Test Android pricing
      console.log('  Getting pricing details for Spotify on Android...');
      const androidPricingResult = await client.callTool({
        name: "get_pricing_details",
        arguments: {
          appId: ANDROID_APP_ID,
          platform: "android"
        }
      });
      
      // Parse the result
      const androidPricingData = JSON.parse(androidPricingResult.content[0].text);
      
      assert(androidPricingData.appId === ANDROID_APP_ID, `App ID should be '${ANDROID_APP_ID}'`);
      assert(androidPricingData.platform === "android", "Platform should be 'android'");
      assert(androidPricingData.basePrice, "Base price should be present");
      assert(androidPricingData.inAppPurchases, "In-app purchase info should be present");
      assert(androidPricingData.monetizationModel, "Monetization model should be present");
      
      // Test iOS pricing
      await wait(1000);
      console.log('  Getting pricing details for Spotify on iOS...');
      const iosPricingResult = await client.callTool({
        name: "get_pricing_details",
        arguments: {
          appId: IOS_APP_ID,
          platform: "ios"
        }
      });
      
      // Parse the result
      const iosPricingData = JSON.parse(iosPricingResult.content[0].text);
      
      assert(iosPricingData.appId === IOS_APP_ID, `App ID should be '${IOS_APP_ID}'`);
      assert(iosPricingData.platform === "ios", "Platform should be 'ios'");
      assert(iosPricingData.basePrice, "Base price should be present");
      assert(iosPricingData.inAppPurchases, "In-app purchase info should be present");
      assert(iosPricingData.monetizationModel, "Monetization model should be present");
      
      console.log('✅ get_pricing_details tool test passed for both platforms');
    } catch (error) {
      console.error('❌ get_pricing_details test failed:', error.message);
      failedTests.push('get_pricing_details');
    }
    
    // Test 8: Test get_developer_info tool
    try {
      console.log('\nTest 8: Test get_developer_info tool');
      await wait(1000);
      
      // Test Android developer info
      console.log('  Getting developer info for Spotify on Android...');
      const androidDevResult = await client.callTool({
        name: "get_developer_info",
        arguments: {
          developerId: ANDROID_DEV_ID,
          platform: "android",
          includeApps: true
        }
      });
      
      // Parse the result
      const androidDevData = JSON.parse(androidDevResult.content[0].text);
      
      assert(androidDevData.developerId === ANDROID_DEV_ID, `Developer ID should be '${ANDROID_DEV_ID}'`);
      assert(androidDevData.platform === "android", "Platform should be 'android'");
      assert(androidDevData.name, "Developer name should be present");
      assert(androidDevData.metrics, "Metrics should be present");
      assert(Array.isArray(androidDevData.apps), "Apps should be an array");
      
      // Test iOS developer info
      await wait(1000);
      console.log('  Getting developer info for Spotify on iOS...');
      const iosDevResult = await client.callTool({
        name: "get_developer_info",
        arguments: {
          developerId: IOS_DEV_ID,
          platform: "ios",
          includeApps: true
        }
      });
      
      // Parse the result
      const iosDevData = JSON.parse(iosDevResult.content[0].text);
      
      assert(iosDevData.developerId === IOS_DEV_ID, `Developer ID should be '${IOS_DEV_ID}'`);
      assert(iosDevData.platform === "ios", "Platform should be 'ios'");
      assert(iosDevData.name, "Developer name should be present");
      assert(iosDevData.metrics, "Metrics should be present");
      assert(Array.isArray(iosDevData.apps), "Apps should be an array");
      
      console.log('✅ get_developer_info tool test passed for both platforms');
    } catch (error) {
      console.error('❌ get_developer_info test failed:', error.message);
      failedTests.push('get_developer_info');
    }
    
    // Test 9: Test get_version_history tool
    try {
      console.log('\nTest 9: Test get_version_history tool');
      await wait(1000);
      
      // Test Android version history (limited to current version)
      console.log('  Getting version history for Spotify on Android...');
      const androidVersionResult = await client.callTool({
        name: "get_version_history",
        arguments: {
          appId: ANDROID_APP_ID,
          platform: "android"
        }
      });
      
      // Parse the result
      const androidVersionData = JSON.parse(androidVersionResult.content[0].text);
      
      assert(androidVersionData.appId === ANDROID_APP_ID, `App ID should be '${ANDROID_APP_ID}'`);
      assert(androidVersionData.platform === "android", "Platform should be 'android'");
      assert(androidVersionData.platformCapabilities.fullHistoryAvailable === false, "Full history should not be available for Android");
      assert(androidVersionData.currentVersion, "Current version should be present");
      assert(Array.isArray(androidVersionData.history), "History should be an array");
      assert(androidVersionData.history.length === 1, "History should have exactly 1 entry for Android");
      
      // Test iOS version history
      await wait(1000);
      console.log('  Getting version history for Spotify on iOS...');
      const iosVersionResult = await client.callTool({
        name: "get_version_history",
        arguments: {
          appId: IOS_APP_ID,
          platform: "ios"
        }
      });
      
      // Parse the result
      const iosVersionData = JSON.parse(iosVersionResult.content[0].text);
      
      assert(iosVersionData.appId === IOS_APP_ID, `App ID should be '${IOS_APP_ID}'`);
      assert(iosVersionData.platform === "ios", "Platform should be 'ios'");
      assert(iosVersionData.platformCapabilities !== undefined, "Platform capabilities should be defined");
      assert(iosVersionData.currentVersion !== null, "Current version should be present");
      assert(Array.isArray(iosVersionData.history), "History should be an array");
      assert(iosVersionData.history.length > 0, "History should have at least one entry");
      
      // Log the version info - helpful for debugging
      console.log(`  iOS version info: platform capabilities: ${JSON.stringify(iosVersionData.platformCapabilities)}`);
      console.log(`  iOS history entries: ${iosVersionData.history.length}`);
      
      console.log('✅ get_version_history tool test passed for both platforms');
    } catch (error) {
      console.error('❌ get_version_history test failed:', error.message);
      failedTests.push('get_version_history');
    }
    
  } catch (error) {
    console.error('Error during test execution:', error);
  } finally {
    // Disconnect from the server if connected
    if (client) {
      console.log('\nDisconnecting from server...');
      try {
        await client.close();
      } catch (e) {
        console.error('Error during disconnect:', e.message);
      }
      console.log('Disconnected from server.');
    }
    
    // Display test summary
    console.log('\n----- TEST SUMMARY -----');
    
    if (failedTests.length === 0) {
      console.log('All tests passed for both Android and iOS platforms! 🎉');
    } else {
      console.log(`${failedTests.length} tests failed:`);
      failedTests.forEach(test => console.log(`- ${test}`));
      // Exit with error code
      process.exit(1);
    }
  }
}

/**
 * Helper function to get minimal valid arguments for different tools
 */
function getMinimalArgs(toolName) {
  switch (toolName) {
    case 'search_app':
      return { term: 'test', platform: 'android', num: 1 };
    case 'get_app_details':
    case 'analyze_reviews':
    case 'get_pricing_details':
    case 'get_version_history':
      return { appId: ANDROID_APP_ID, platform: 'android' };
    case 'analyze_top_keywords':
      return { keyword: 'test', platform: 'android' };
    case 'get_developer_info':
      return { developerId: ANDROID_DEV_ID, platform: 'android' };
    default:
      return { platform: 'android' };
  }
}

// Set a timeout for the entire test suite
const testTimeout = setTimeout(() => {
  console.error('Test suite timed out after', TEST_TIMEOUT, 'ms');
  process.exit(1);
}, TEST_TIMEOUT);

// Run the tests and clear the timeout when done
runTests().finally(() => clearTimeout(testTimeout)); 
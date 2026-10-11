const ITUNES_BASE_URL = 'https://itunes.apple.com';

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function mapApp(result) {
  return {
    id: result.trackId,
    appId: result.bundleId,
    title: result.trackName,
    url: result.trackViewUrl,
    description: result.description,
    genre: result.primaryGenreName,
    genreId: result.primaryGenreId,
    primaryGenre: result.primaryGenreName,
    genres: result.genres || [],
    icon: result.artworkUrl512 || result.artworkUrl100 || result.artworkUrl60,
    score: toNumber(result.averageUserRating),
    ratings: toNumber(result.userRatingCount),
    currentVersionReleaseDate: result.currentVersionReleaseDate,
    released: result.releaseDate,
    updated: result.currentVersionReleaseDate || result.releaseDate,
    version: result.version,
    free: result.price === 0,
    price: result.price || 0,
    currency: result.currency,
    developer: result.artistName,
    developerId: result.artistId,
    developerUrl: result.artistViewUrl,
    developerWebsite: result.sellerUrl,
    sellerName: result.sellerName,
    releaseNotes: result.releaseNotes,
    minimumOsVersion: result.minimumOsVersion,
    contentRating: result.contentAdvisoryRating,
    supportedDevices: result.supportedDevices || [],
    screenshots: result.screenshotUrls || [],
    ipadScreenshots: result.ipadScreenshotUrls || [],
    languageCodesISO2A: result.languageCodesISO2A || [],
    size: toNumber(result.fileSizeBytes),
  };
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Apple API request failed (${response.status})`);
  }
  return response.json();
}

const ITUNES_MAX_LIMIT = 200;

async function search({ term, num = 10, country = 'us' }) {
  const url = new URL(`${ITUNES_BASE_URL}/search`);
  url.searchParams.set('term', term);
  url.searchParams.set('entity', 'software');
  // Apple returns one result fewer than `limit` asks for, so request one extra.
  url.searchParams.set('limit', String(Math.min(num + 1, ITUNES_MAX_LIMIT)));
  url.searchParams.set('country', country);
  const data = await fetchJson(url.toString());
  return (data.results || []).map(mapApp).slice(0, num);
}

async function app({ id, appId, country = 'us' }) {
  const url = new URL(`${ITUNES_BASE_URL}/lookup`);
  if (id) {
    url.searchParams.set('id', String(id));
  } else if (appId) {
    url.searchParams.set('bundleId', appId);
  } else {
    throw new Error('Either id or appId is required for iOS lookup');
  }
  url.searchParams.set('country', country);
  const data = await fetchJson(url.toString());
  const first = data.results?.[0];
  if (!first) {
    throw new Error('App not found on Apple App Store');
  }
  return mapApp(first);
}

async function developer({ devId, id, num = 50, country = 'us' }) {
  const artistId = devId || id;
  if (!artistId) {
    throw new Error('Developer id is required');
  }
  const url = new URL(`${ITUNES_BASE_URL}/lookup`);
  url.searchParams.set('id', String(artistId));
  url.searchParams.set('entity', 'software');
  url.searchParams.set('limit', String(num));
  url.searchParams.set('country', country);
  const data = await fetchJson(url.toString());
  return (data.results || [])
    .filter((result) => result.wrapperType === 'software')
    .map(mapApp);
}

async function similar({ id, appId, country = 'us', num = 20 }) {
  const details = await app({ id, appId, country });
  if (!details.genre) {
    return [];
  }
  const results = await search({ term: details.genre, num: Math.max(20, num), country });
  const currentId = String(details.id);
  return results.filter((result) => String(result.id) !== currentId).slice(0, num);
}

async function reviews({ id, appId, country = 'us', page = 1, sort = 'recent' }) {
  let resolvedId = id;
  if (!resolvedId && appId) {
    const details = await app({ appId, country });
    resolvedId = details.id;
  }
  if (!resolvedId) {
    throw new Error('Either id or appId is required for iOS reviews');
  }

  const normalizedSort = sort === 'helpful' ? 'mostHelpful' : 'mostRecent';
  const url = `${ITUNES_BASE_URL}/rss/customerreviews/page=${page}/id=${resolvedId}/sortby=${normalizedSort}/json?l=en&cc=${country}`;
  const data = await fetchJson(url);
  const entries = data.feed?.entry || [];

  return entries
    .filter((entry) => entry.author && entry['im:rating'])
    .map((entry) => ({
      id: entry.id?.label,
      userName: entry.author?.name?.label || 'Anonymous',
      userUrl: entry.author?.uri?.label,
      version: entry['im:version']?.label,
      score: toNumber(entry['im:rating']?.label) || 0,
      title: entry.title?.label,
      text: entry.content?.label || '',
      url: entry.link?.attributes?.href,
      updated: entry.updated?.label,
    }));
}

export function createMemoizedIosAppStoreClient() {
  return {
    search,
    app,
    reviews,
    developer,
    similar,
  };
}

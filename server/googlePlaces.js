/**
 * googlePlaces.js
 * ---------------
 * Real restaurant grounding via a plain HTTP call to the Google Places API
 * (New) — no MCP, no OAuth login, no "is this client on the guest list"
 * problem. Just an API key tied to a Cloud billing project, which is what
 * this API is built for.
 *
 * One Text Search request returns up to `count` real nearby restaurants:
 * name, address, rating, a Google Maps link, and (if available) a photo
 * reference. Places doesn't expose per-dish menu data, so this module never
 * returns a dish — restaurant only.
 */

const FIELD_MASK_SEARCH =
  'places.displayName,places.formattedAddress,places.rating,places.googleMapsUri,places.photos';

/**
 * @param {string} query     cuisine or food type, e.g. "Korean" or "fried chicken"
 * @param {string} location  e.g. "Toronto, ON"
 * @param {number} count     how many restaurants to return (max ~20 per Places API)
 * @returns {Promise<Array<{name, address, rating, mapsUri, photoName}>>}
 */
export async function findRestaurants(query, location, count = 3) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY not set');

  const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK_SEARCH,
    },
    body: JSON.stringify({
      textQuery: `${query} restaurant near ${location}`,
      maxResultCount: count,
    }),
  });
  if (!searchRes.ok) {
    throw new Error(`Google Places search failed: ${searchRes.status} ${await searchRes.text()}`);
  }
  const searchData = await searchRes.json();
  const places = searchData.places ?? [];

  return places.slice(0, count).map((p) => ({
    name: p.displayName?.text ?? null,
    address: p.formattedAddress ?? null,
    rating: p.rating ?? null,
    mapsUri: p.googleMapsUri ?? null,
    // Resource name like "places/{placeId}/photos/{photoId}" — resolved to
    // actual image bytes on demand via the /api/place-photo proxy, so the
    // API key never has to leave the server. Null if Places has no photo.
    photoName: p.photos?.[0]?.name ?? null,
  }));
}

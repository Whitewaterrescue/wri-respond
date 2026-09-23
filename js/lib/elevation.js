/**
 * elevation.ts — USGS 3DEP ImageServer sampling client.
 *
 * Service facts verified live 2026-08-25 (do not "optimise" these away):
 *
 *  - getSamples SILENTLY TRUNCATES at 1000 points. Sent 2000, got 1000 back,
 *    no error and no flag. We chunk at 400 and assert the returned count.
 *  - `resolution` comes back in the SOURCE raster's SR units, not the query SR:
 *    degrees for the arc-second mosaic members, metres for projected lidar
 *    members. Disambiguated in resolutionToMetres().
 *  - No mosaicRule needed: sortField="Best" / mosaicOperator="First" already
 *    serve best-available resolution.
 *  - Coverage is ALL of North America (BC, AB, MX, AK, HI), not CONUS. Points
 *    outside it are simply OMITTED from the response rather than returned null,
 *    so we pre-fill by locationId instead of zipping positionally.
 */
export const ELEVATION_VERSION = '1.0.0';
export const DEFAULT_ELEVATION_URL = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
/** Hard service limit is 1000; stay well under it. */
const CHUNK = 400;
const MAX_TRIES = 4;
export class ElevationError extends Error {
    constructor(message, detail, nonRetryable = false) {
        super(message);
        this.name = 'ElevationError';
        this.detail = detail;
        this.nonRetryable = nonRetryable;
    }
}
/**
 * 3DEP answers a multipoint request differently depending on how much of it is
 * covered:
 *   - SOME points outside coverage -> they are omitted from `samples` (fine)
 *   - ALL points outside coverage  -> HTTP 400 "Invalid or missing input
 *     parameters" with a /vsimem/*.aux.xml cloud-open failure in details
 * The second case is a coverage answer wearing an error costume. Retrying it
 * just burns four round-trips before failing.
 */
function isCoverageError(e) {
    if (!(e instanceof ElevationError))
        return false;
    const code = e.detail?.code;
    if (code !== 400)
        return false;
    const blob = JSON.stringify(e.detail?.details || '') + ' ' + (e.message || '');
    return /Invalid or missing input parameters|Failed cloud operation|aux\.xml/i.test(blob);
}
/**
 * 3DEP reports `resolution` in the source raster's own SR units. Arc-second
 * members are geographic (degrees, e.g. 9.26e-05 = 10 m); lidar members are
 * projected (metres, e.g. 1). Anything below 0.01 must be degrees — no DEM in
 * the mosaic has a 1 cm ground sample distance.
 */
export function resolutionToMetres(raw, latDeg) {
    const r = typeof raw === 'number' ? raw : parseFloat(raw);
    if (!isFinite(r) || r <= 0)
        return null;
    if (r < 0.01) {
        // degrees -> metres, latitude-corrected on the longitude axis
        const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * latDeg * Math.PI / 180);
        return r * mPerDegLat;
    }
    return r;
}
const sleep = async (ms) => await new Promise(resolve => setTimeout(resolve, ms));
async function postJson(url, params, signal) {
    let last = null;
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
        if (signal?.aborted)
            throw new DOMException('Aborted', 'AbortError');
        try {
            const body = new URLSearchParams(params).toString();
            const res = await fetch(url, {
                method: 'POST',
                body,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                signal
            });
            if (!res.ok)
                throw new ElevationError('Elevation service returned HTTP ' + res.status);
            const text = await res.text();
            let json;
            try {
                json = JSON.parse(text);
            }
            catch (e) {
                // ArcGIS occasionally answers with an HTML error page
                throw new ElevationError('Elevation service returned a malformed response');
            }
            if (json && json.error) {
                const code = json.error.code;
                const fatal = typeof code === 'number' && code >= 400 && code < 500;
                throw new ElevationError(json.error.message || 'Elevation service error', json.error, fatal);
            }
            return json;
        }
        catch (e) {
            if (e?.name === 'AbortError')
                throw e;
            // a 4xx is deterministic — retrying it just burns round-trips
            if (e instanceof ElevationError && e.nonRetryable)
                throw e;
            last = e;
            if (attempt < MAX_TRIES - 1)
                await sleep(900 * (attempt + 1));
        }
    }
    throw new ElevationError('Elevation service unreachable after ' + MAX_TRIES + ' attempts: ' + (last?.message || last), last);
}
/**
 * Sample the DEM at a list of [lon, lat] points.
 * Never throws for NoData — those come back as nulls in `values`.
 */
export async function sampleElevations(points, opts) {
    const base = (opts?.serviceUrl || DEFAULT_ELEVATION_URL).replace(/\/+$/, '');
    const url = base + '/getSamples';
    const values = new Array(points.length).fill(null);
    const resolutions = new Array(points.length).fill(null);
    let answered = 0;
    for (let i0 = 0; i0 < points.length; i0 += CHUNK) {
        const chunk = points.slice(i0, i0 + CHUNK);
        let json;
        try {
            json = await postJson(url, {
                geometry: JSON.stringify({ points: chunk, spatialReference: { wkid: 4326 } }),
                geometryType: 'esriGeometryMultipoint',
                returnFirstValueOnly: 'true',
                interpolation: 'RSP_BilinearInterpolation',
                f: 'json'
            }, opts?.signal);
        }
        catch (e) {
            // whole chunk outside DEM coverage: leave its slots null and carry on,
            // so a partly-covered request still returns what it can
            if (isCoverageError(e))
                continue;
            throw e;
        }
        const samples = Array.isArray(json?.samples) ? json.samples : [];
        if (samples.length > chunk.length) {
            throw new ElevationError('Elevation service returned more samples than requested');
        }
        for (const s of samples) {
            const id = s?.locationId;
            if (typeof id !== 'number' || id < 0 || id >= chunk.length)
                continue;
            const v = parseFloat(s.value);
            if (!isFinite(v))
                continue;
            const idx = i0 + id;
            values[idx] = v;
            resolutions[idx] = resolutionToMetres(s.resolution, points[idx][1]);
            answered++;
        }
    }
    return { values, resolutions, answered };
}
/** Human label for the DEM behind a point, e.g. "3DEP 1 m lidar". */
export function sourceLabel(resM) {
    if (resM == null)
        return 'no coverage';
    if (resM <= 1.5)
        return '3DEP ' + resM.toFixed(0) + ' m lidar';
    if (resM <= 12)
        return '3DEP 1/3 arc-second (~' + resM.toFixed(0) + ' m)';
    if (resM <= 40)
        return '3DEP 1 arc-second (~' + resM.toFixed(0) + ' m)';
    return '3DEP ~' + resM.toFixed(0) + ' m';
}

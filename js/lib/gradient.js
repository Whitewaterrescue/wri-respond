/**
 * gradient.ts — downgradient direction from a DEM point sample set.
 *
 * PURE. No ArcGIS imports, no fetch, no DOM. Takes elevations, returns numbers.
 * Runs unmodified in Node (see test-gradient.mjs) and is portable to arcpy if a
 * precompute path is ever built.
 *
 * Method (least-squares plane fit over metric offsets):
 *   z = a*E + b*N + c   ->   steepest DESCENT vector = (-a, -b)
 *   azimuth = atan2(-a, -b), 0 = true north, clockwise
 *
 * Verified 2026-08-25 against live USGS 3DEP over the BNSF Gallatin corridor.
 */
export const GRADIENT_VERSION = '1.0.0';
const DEFAULTS = {
    flatPct: 1.0,
    noiseFactor: 3,
    minDemPixelsAcross: 2,
    ditchScaleM: 10,
    consistentDeg: 15,
    scaleDependentDeg: 45
};
const DEG = Math.PI / 180;
/** Latitude-corrected metres per degree (WGS84). Never do this in Web Mercator. */
export function mPerDeg(latDeg) {
    const p = latDeg * DEG;
    return {
        mLat: 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p),
        mLon: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p)
    };
}
/** Centre point + k evenly spaced bearings on each radius. */
export function ringPlan(lat, lon, radii, k = 16) {
    const { mLat, mLon } = mPerDeg(lat);
    const points = [[lon, lat]];
    const offsets = [{ e: 0, n: 0 }];
    for (const R of radii) {
        for (let i = 0; i < k; i++) {
            const th = (2 * Math.PI * i) / k;
            const e = R * Math.sin(th);
            const n = R * Math.cos(th);
            points.push([lon + e / mLon, lat + n / mLat]);
            offsets.push({ e, n });
        }
    }
    return { points, offsets, radii: radii.slice(), k };
}
/**
 * Local vertical noise (m) for a DEM of the given ground sample distance.
 * Relative/local error, not absolute vertical accuracy — we compare neighbouring
 * cells, so any systematic datum offset cancels out.
 */
export function verticalNoiseM(resM) {
    if (resM == null || !isFinite(resM))
        return 0.5;
    if (resM <= 1.5)
        return 0.10; // 3DEP QL1/QL2 lidar
    if (resM <= 5)
        return 0.30;
    if (resM <= 12)
        return 0.50; // 1/3 arc-second
    return 1.50; // 1 arc-second and coarser
}
const CARD = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function cardinal(az) {
    return CARD[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
}
/** Smallest absolute difference between two azimuths, 0..180. */
export function circDiff(a, b) {
    return Math.abs(((((a - b + 180) % 360) + 360) % 360) - 180);
}
/** Least-squares z = a*E + b*N + c. Returns null if under-determined or singular. */
export function planeFit(offsets, z) {
    let Se = 0;
    let Sn = 0;
    let Sz = 0;
    let See = 0;
    let Snn = 0;
    let Sen = 0;
    let Sez = 0;
    let Snz = 0;
    let n = 0;
    let zmin = Infinity;
    let zmax = -Infinity;
    for (let i = 0; i < offsets.length; i++) {
        const v = z[i];
        if (v == null || !isFinite(v))
            continue;
        const e = offsets[i].e;
        const nn = offsets[i].n;
        Se += e;
        Sn += nn;
        Sz += v;
        See += e * e;
        Snn += nn * nn;
        Sen += e * nn;
        Sez += e * v;
        Snz += nn * v;
        if (v < zmin)
            zmin = v;
        if (v > zmax)
            zmax = v;
        n++;
    }
    if (n < 4)
        return null;
    // 3x3 augmented system, Gaussian elimination with partial pivoting
    const M = [
        [See, Sen, Se, Sez],
        [Sen, Snn, Sn, Snz],
        [Se, Sn, n, Sz]
    ];
    for (let c = 0; c < 3; c++) {
        let p = c;
        for (let r = c + 1; r < 3; r++)
            if (Math.abs(M[r][c]) > Math.abs(M[p][c]))
                p = r;
        if (Math.abs(M[p][c]) < 1e-12)
            return null;
        const tmp = M[c];
        M[c] = M[p];
        M[p] = tmp;
        for (let r = 0; r < 3; r++) {
            if (r === c)
                continue;
            const f = M[r][c] / M[c][c];
            for (let k = c; k < 4; k++)
                M[r][k] -= f * M[c][k];
        }
    }
    const a = M[0][3] / M[0][0];
    const b = M[1][3] / M[1][1];
    const c0 = M[2][3] / M[2][2];
    const zbar = Sz / n;
    let ssTot = 0;
    let ssRes = 0;
    for (let i = 0; i < offsets.length; i++) {
        const v = z[i];
        if (v == null || !isFinite(v))
            continue;
        const e = offsets[i].e;
        const nn = offsets[i].n;
        ssTot += (v - zbar) * (v - zbar);
        const pred = a * e + b * nn + c0;
        ssRes += (v - pred) * (v - pred);
    }
    // ssTot ~ 0 is the flat case, not a divide-by-zero
    const r2 = ssTot < 1e-9 ? null : 1 - ssRes / ssTot;
    return { a, b, r2, n, relief: zmax - zmin };
}
/** Classify agreement across the usable radii. */
export function agreementOf(results, opts) {
    const o = { ...DEFAULTS, ...(opts || {}) };
    const usable = results.filter(r => r.usable && r.azimuth != null);
    const comparedRadii = usable.map(r => r.radiusM);
    if (usable.length === 0)
        return { level: 'NONE', maxDiffDeg: null, comparedRadii };
    if (usable.length === 1)
        return { level: 'SINGLE', maxDiffDeg: 0, comparedRadii };
    let max = 0;
    for (let i = 0; i < usable.length; i++) {
        for (let j = i + 1; j < usable.length; j++) {
            const d = circDiff(usable[i].azimuth, usable[j].azimuth);
            if (d > max)
                max = d;
        }
    }
    const level = max < o.consistentDeg
        ? 'CONSISTENT'
        : max <= o.scaleDependentDeg ? 'SCALE-DEPENDENT' : 'DIVERGENT';
    return { level, maxDiffDeg: max, comparedRadii };
}
/**
 * Full multi-scale analysis.
 * @param elevations aligned to plan.points; null where the DEM returned NoData
 * @param resolutions effective DEM ground sample distance (m) per point, or null
 */
export function analyze(lat, lon, plan, elevations, resolutions, options) {
    const o = { ...DEFAULTS, ...(options || {}) };
    const k = plan.k;
    const radii = plan.radii;
    const offsets = plan.offsets;
    const notes = [];
    const centerElevM = elevations[0] == null ? null : elevations[0];
    const results = radii.map((R, ri) => {
        const lo = 1 + ri * k;
        const subOff = [offsets[0]].concat(offsets.slice(lo, lo + k));
        const subZ = [elevations[0]].concat(elevations.slice(lo, lo + k));
        const subRes = [resolutions[0]].concat(resolutions.slice(lo, lo + k));
        const known = subRes.filter(r => r != null && isFinite(r));
        const resolutionM = known.length ? Math.max.apply(null, known) : null;
        const base = {
            radiusM: R,
            azimuth: null,
            cardinal: null,
            slopePct: null,
            slopeDeg: null,
            r2: null,
            nSamples: 0,
            reliefM: null,
            resolutionM,
            subPixel: false,
            belowNoiseFloor: false,
            usable: false,
            reason: null
        };
        const fit = planeFit(subOff, subZ);
        if (!fit) {
            base.reason = 'No elevation data at this radius';
            return base;
        }
        const slopeRatio = Math.hypot(fit.a, fit.b);
        const azimuth = ((Math.atan2(-fit.a, -fit.b) / DEG) + 360) % 360;
        const subPixel = resolutionM != null && (2 * R) < o.minDemPixelsAcross * resolutionM;
        const noise = verticalNoiseM(resolutionM);
        const belowNoiseFloor = fit.relief < o.noiseFactor * noise;
        const slopePct = slopeRatio * 100;
        let reason = null;
        let usable = true;
        // order matters: report the most fundamental disqualifier first
        if (subPixel) {
            usable = false;
            reason = 'Ring spans under ' + o.minDemPixelsAcross + ' DEM cells here (' +
                (resolutionM == null ? '?' : resolutionM.toFixed(1)) +
                ' m) — not an independent second opinion';
        }
        else if (belowNoiseFloor) {
            usable = false;
            reason = 'Relief across this ring (' + fit.relief.toFixed(2) +
                ' m) is within DEM noise — direction is not meaningful';
        }
        else if (slopePct < o.flatPct) {
            usable = false;
            reason = 'Flat — path indeterminate';
        }
        return {
            radiusM: R,
            azimuth,
            cardinal: cardinal(azimuth),
            slopePct,
            slopeDeg: Math.atan(slopeRatio) / DEG,
            r2: fit.r2,
            nSamples: fit.n,
            reliefM: fit.relief,
            resolutionM,
            subPixel,
            belowNoiseFloor,
            usable,
            reason
        };
    });
    const agreement = agreementOf(results, o);
    // lead with the finest usable radius — the responder is standing there
    const usableList = results.filter(r => r.usable);
    const primary = usableList.length ? usableList[0] : null;
    const finestUsableM = usableList.length
        ? Math.min.apply(null, usableList.map(r => r.radiusM))
        : null;
    const ditchScaleResolved = finestUsableM != null && finestUsableM <= o.ditchScaleM;
    if (results.some(r => r.subPixel)) {
        notes.push('One or more radii are finer than the DEM here; they were excluded from the agreement check.');
    }
    if (!primary) {
        notes.push('No radius produced a defensible direction at this point.');
    }
    if (primary && !ditchScaleResolved) {
        const res = primary.resolutionM;
        notes.push('Ditch scale not resolved here: the finest usable radius is ' + finestUsableM +
            ' m' + (res != null ? ' (DEM is ' + res.toFixed(1) + ' m)' : '') +
            '. A ditch, shoulder or crown could still control the first few metres, ' +
            'and nothing sampled here would see it.');
    }
    if (agreement.level === 'DIVERGENT') {
        notes.push('Micro-topography dominates — likely a ditch, rut, berm or ballast shoulder. There is no single answer here.');
    }
    const lowR2 = usableList.filter(r => r.r2 != null && r.r2 < 0.5);
    if (lowR2.length) {
        notes.push('Poor plane fit at ' + lowR2.map(r => r.radiusM + ' m').join(', ') +
            ' — the ground here is not planar.');
    }
    return {
        lat,
        lon,
        centerElevM,
        radii: results,
        agreement,
        primary,
        ditchScaleResolved,
        finestUsableM,
        notes
    };
}

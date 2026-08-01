import { OctopusClient } from './octopus.js';

let client = null;
let currentConfig = null;
let latestLive = null;
let liveRefreshInterval = null;

const viewLoading = document.getElementById('loading-view');
const viewSetup = document.getElementById('setup-view');
const viewDashboard = document.getElementById('dashboard-view');
const viewEditZone = document.getElementById('edit-zone-view');
const viewZoneOverride = document.getElementById('zone-override-view');
const viewPerformance = document.getElementById('performance-view');
const logoutBtn = document.getElementById('logout-btn');
const linkState = document.getElementById('link-state');
const setupError = document.getElementById('setup-error');
const toasts = document.getElementById('toasts');
const dialog = document.getElementById('dialog');

export function init() {
    const creds = loadCredentials();
    if (creds) {
        client = new OctopusClient(creds.apiKey, creds.account, creds.euid, creds.propertyId);
        showDashboard();
    } else {
        showSetup();
    }

    document.getElementById('setup-form').addEventListener('submit', handleSetup);

    // The schematic and the curve have separate wide and compact layouts.
    let resizeTimer = null;
    let wasCompact = isCompact();
    window.addEventListener('resize', () => {
        if (isCompact() === wasCompact) return;
        wasCompact = isCompact();
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (viewDashboard.classList.contains('hidden')) return;
            const wrap = document.getElementById('schematic-wrap');
            if (wrap) wrap.innerHTML = renderSchematicSvg(latestLive, currentConfig?.heatPump);
            if (curveState && !curveState.dragging && !curveState.probing) repaintCurve();
        }, 150);
    });
}

function loadCredentials() {
    const data = localStorage.getItem('cosy_manager_creds');
    return data ? JSON.parse(data) : null;
}

function saveCredentials(apiKey, account, euid, propertyId) {
    localStorage.setItem('cosy_manager_creds', JSON.stringify({ apiKey, account, euid, propertyId }));
}

export function logout() {
    localStorage.removeItem('cosy_manager_creds');
    client = null;
    currentConfig = null;
    latestLive = null;
    showSetup();
}

// --- Shared UI ------------------------------------------------------------

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
}

export function toast(message, tone = 'info') {
    const el = document.createElement('div');
    el.className = 'toast';
    el.dataset.tone = tone;
    el.innerHTML = `<span class="plate">${tone === 'error' ? 'Failed' : 'Done'}</span><span>${esc(message)}</span>`;
    toasts.appendChild(el);
    setTimeout(() => el.remove(), tone === 'error' ? 8000 : 4000);
}

// Resolves with the dialog form when confirmed, or null when dismissed.
function openDialog({ title, bodyHtml = '', confirmLabel = 'Confirm', danger = false }) {
    const form = document.getElementById('dialog-form');
    const confirmBtn = document.getElementById('dialog-confirm');
    document.getElementById('dialog-title').textContent = title;
    document.getElementById('dialog-body').innerHTML = bodyHtml;
    confirmBtn.textContent = confirmLabel;
    confirmBtn.className = danger ? 'btn btn--danger' : 'btn btn--primary';

    return new Promise(resolve => {
        dialog.addEventListener('close', () => {
            const confirmed = dialog.returnValue === 'confirm';
            resolve(confirmed ? form : null);
            form.reset();
        }, { once: true });
        dialog.showModal();
        const field = form.querySelector('input, select, textarea');
        if (field) field.focus();
    });
}

async function confirmAction({ title, body, confirmLabel = 'Confirm', danger = false }) {
    const result = await openDialog({ title, bodyHtml: `<p>${esc(body)}</p>`, confirmLabel, danger });
    return result !== null;
}

async function promptForText({ title, label, value = '', confirmLabel = 'Save' }) {
    const bodyHtml = `
        <label class="field" style="margin-bottom:0;">
            <span class="plate">${esc(label)}</span>
            <input type="text" name="text" value="${esc(value)}" required maxlength="60">
        </label>`;
    const form = await openDialog({ title, bodyHtml, confirmLabel });
    if (!form) return null;
    return form.text.value.trim();
}

// Wraps a mutation: reports the outcome and reloads the dashboard on success.
async function run(action, successMessage) {
    try {
        await action();
        toast(successMessage);
        await showDashboard();
        return true;
    } catch (e) {
        toast(e.message, 'error');
        return false;
    }
}

// --- Formatting -----------------------------------------------------------

const SENTINEL = -20; // The controller reports unset probes as large negatives.
const isSentinel = t => t == null || parseFloat(t) < SENTINEL;

const num = (v, dp = 1) => (v == null || isNaN(parseFloat(v)) ? null : parseFloat(v).toFixed(dp));
const temp = (v, dp = 1) => (isSentinel(v) ? null : `${num(v, dp)}°`);

function circuitVar(zoneType) {
    if (zoneType === 'HEAT') return 'var(--heat)';
    if (zoneType === 'WATER') return 'var(--water)';
    return 'var(--aux)';
}

function circuitLabel(zoneType) {
    return {
        HEAT: 'Heating',
        WATER: 'Hot water',
        AUXILIARY: 'Auxiliary',
        WIRED_THERMOSTAT: 'Wired stat',
        DIVERTER_VALVE: 'Diverter',
    }[zoneType] || 'Circuit';
}

function readAge(readAt) {
    if (!readAt) return '';
    const secs = Math.round((Date.now() - new Date(readAt)) / 1000);
    if (secs < 60) return `${Math.max(secs, 0)}s ago`;
    if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
    return `${Math.round(secs / 3600)}h ago`;
}

const dayNames = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const dayInitials = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// A zone's live reading: primary sensor if it has one, else its telemetry setpoint.
function zoneReading(zone) {
    const sensors = zone.sensors || [];
    const primary = sensors.find(s => s.code === zone.primarySensor) || sensors[0];
    const measured = primary?.telemetry?.temperatureInCelsius;
    return {
        measured: isSentinel(measured) ? null : parseFloat(measured),
        target: zone.currentOperation?.setpointInCelsius ?? (isSentinel(zone.telemetry?.setpointInCelsius) ? null : zone.telemetry?.setpointInCelsius),
    };
}

function zoneState(zone) {
    const mode = zone.currentOperation?.mode;
    const calling = zone.telemetry?.heatDemand || zone.heatDemand || zone.callForHeat;
    if (calling) return 'calling';
    if (mode === 'OFF' || zone.currentOperation?.action === 'TURN_OFF') return 'off';
    return 'satisfied';
}

function activeZones(config) {
    return (config.zones || []).map(z => z.configuration).filter(z => z.enabled);
}

// --- Views ----------------------------------------------------------------

function hideAllViews() {
    stopLiveRefresh();
    viewLoading.classList.add('hidden');
    viewSetup.classList.add('hidden');
    viewDashboard.classList.add('hidden');
    viewEditZone.classList.add('hidden');
    viewZoneOverride.classList.add('hidden');
    viewPerformance.classList.add('hidden');
    logoutBtn.classList.add('hidden');
}

function showSetup() {
    hideAllViews();
    linkState.classList.add('hidden');
    document.getElementById('setup-form').classList.remove('hidden');
    document.getElementById('device-selection').classList.add('hidden');
    viewSetup.classList.remove('hidden');
}

export async function showDashboard() {
    hideAllViews();
    viewLoading.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');

    try {
        if (!client.token) await client.authenticate();
        currentConfig = await client.getConfiguration();

        // Device-level metadata is supplementary; render without it on failure.
        try {
            currentConfig.device = await client.getDeviceMetadata();
        } catch (e) {
            console.warn('Device metadata unavailable:', e.message);
        }

        try {
            latestLive = await client.getLivePerformance();
        } catch (e) {
            console.warn('Live performance unavailable:', e.message);
            latestLive = null;
        }

        renderDashboard(currentConfig, latestLive);
        startLiveRefresh();
        viewLoading.classList.add('hidden');
        viewDashboard.classList.remove('hidden');
    } catch (err) {
        console.error(err);
        if (err.message.includes('token') || err.message.includes('401')) {
            toast('Session expired. Connect again.', 'error');
            logout();
        } else {
            viewLoading.textContent = err.message;
            toast(err.message, 'error');
        }
    }
}

async function handleSetup(e) {
    e.preventDefault();
    const apiKey = document.getElementById('api-key').value.trim();

    setupError.classList.add('hidden');
    const setupBtn = document.getElementById('setup-btn');
    setupBtn.textContent = 'Connecting…';
    setupBtn.disabled = true;

    try {
        const tempClient = new OctopusClient(apiKey, '', '');
        await tempClient.authenticate();

        setupBtn.textContent = 'Finding heat pumps…';
        const devices = await tempClient.discoverDevices();

        if (devices.length === 0) {
            throw new Error('No heat pumps on this account.');
        } else if (devices.length === 1) {
            finishSetup(apiKey, devices[0].account, devices[0].euid, devices[0].propertyId, tempClient);
        } else {
            const deviceSelector = document.getElementById('device-selector');
            deviceSelector.innerHTML = devices.map(d =>
                `<option value='${esc(JSON.stringify(d))}'>Account ${esc(d.account)} · ${esc(d.euid)}</option>`
            ).join('');
            document.getElementById('setup-form').classList.add('hidden');
            document.getElementById('device-selection').classList.remove('hidden');

            document.getElementById('select-device-btn').onclick = () => {
                const selected = JSON.parse(deviceSelector.value);
                finishSetup(apiKey, selected.account, selected.euid, selected.propertyId, tempClient);
            };
        }
    } catch (err) {
        setupError.textContent = err.message;
        setupError.classList.remove('hidden');
    } finally {
        setupBtn.textContent = 'Connect';
        setupBtn.disabled = false;
    }
}

async function finishSetup(apiKey, account, euid, propertyId, tempClient) {
    tempClient.account = account;
    tempClient.euid = euid;
    tempClient.propertyId = propertyId;
    try {
        await tempClient.getConfiguration();
        saveCredentials(apiKey, account, euid, propertyId);
        client = tempClient;
        showDashboard();
    } catch (err) {
        setupError.textContent = err.message;
        setupError.classList.remove('hidden');
    }
}

// --- Schematic ------------------------------------------------------------
// The hero: outdoor air in, electricity in, heat out to the circuits. The two
// energy bars are drawn to the same scale, so COP reads as length before it
// reads as a number.

const SCHEMATIC = {
    w: 1000,
    h: 212,
    flowY: 46,
    // Clears the efficiency row, whose 19px type reaches y=175.
    loopY: 190,
    dropX: 4,
    barX: 372,
    barMaxW: 500,
    barH: 12,
    // Optical centre lines for electricity, heat and the efficiency readout.
    rowY: [104, 134, 164],
};

// Mirrors the .s-plate / .s-val sizes in style.css. The wide diagram only
// renders above 720px, so the mobile type scale never applies to it.
const S_TYPE = { plate: 9, val: 15, cop: 19 };

// IBM Plex Mono caps and digits stand ~0.70em tall, so their ink sits half of
// that above the baseline. Centring on the ink rather than the baseline is what
// makes a 9px label, a 12px bar and a 15px number read as one row.
const baseline = (centreY, fontPx) => centreY + fontPx * 0.35;

// On a phone the diagram turns the corner: source and pump across the top,
// the balance stacked underneath, flow running down the left edge as before.
const SCHEMATIC_COMPACT = {
    w: 420,
    h: 300,
    barX: 20,
    barMaxW: 380,
};

const isCompact = () => window.matchMedia('(max-width: 720px)').matches;

function renderSchematicSvg(livePerf, heatPump) {
    return isCompact()
        ? renderSchematicCompact(livePerf, heatPump)
        : renderSchematicWide(livePerf, heatPump);
}

// Shared numbers for both layouts.
function schematicFigures(livePerf, heatPump) {
    const pIn = parseFloat(livePerf?.powerInput?.value) || 0;
    const hOut = parseFloat(livePerf?.heatOutput?.value) || 0;
    const running = hOut > 0.05;
    return {
        outdoor: livePerf?.outdoorTemperature?.value,
        flowTemp: heatPump?.heatingFlowTemperature?.currentTemperature?.value,
        cop: parseFloat(livePerf?.coefficientOfPerformance),
        pIn,
        hOut,
        running,
        period: running ? Math.min(Math.max(3.4 - hOut * 0.4, 0.55), 3.4) : 2,
    };
}

function schematicLabel(figures) {
    return `Heat pump flow diagram. Outdoor air ${figures.outdoor != null ? num(figures.outdoor) : 'unknown'} degrees, ` +
        `${figures.pIn.toFixed(2)} kilowatts electricity in, ${figures.hOut.toFixed(2)} kilowatts heat out.`;
}

function renderSchematicCompact(livePerf, heatPump) {
    const s = SCHEMATIC_COMPACT;
    const f = schematicFigures(livePerf, heatPump);
    const perKw = s.barMaxW / Math.max(f.hOut, f.pIn, 3);
    const inW = Math.max(f.pIn * perKw, f.pIn > 0 ? 2 : 0);
    const outW = Math.max(f.hOut * perKw, f.hOut > 0 ? 2 : 0);

    const bar = (y, label, width, value, cls) => `
      <text class="s-plate" x="${s.barX}" y="${y}">${label}</text>
      <text class="s-val" x="${s.w - 8}" y="${y}" text-anchor="end">${value}<tspan class="s-unit"> kW</tspan></text>
      <rect class="${cls}" x="${s.barX}" y="${y + 10}" width="${width}" height="12" />`;

    return `
    <svg class="schematic" viewBox="0 0 ${s.w} ${s.h}" role="img"
         style="--flow-period:${f.period}s" aria-label="${esc(schematicLabel(f))}">
      <text class="s-plate" x="0" y="18">Outdoor air</text>
      <text class="s-val s-val--lg" x="0" y="52">${temp(f.outdoor) ?? '––'}</text>

      <rect class="s-box" x="250" y="8" width="170" height="56" />
      <text class="s-plate" x="335" y="30" text-anchor="middle">Pump</text>
      <text class="s-val" x="335" y="52" text-anchor="middle">${f.running ? 'RUN' : 'IDLE'}</text>

      <path class="s-flow" data-state="${f.running ? 'running' : 'idle'}"
            d="M 335 64 V 92 H 4 V ${s.h}" />

      <text class="s-plate" x="${s.barX}" y="124">Flow to circuits</text>
      <text class="s-val" x="${s.w - 8}" y="124" text-anchor="end">${temp(f.flowTemp, 0) ?? '––'}</text>

      ${bar(160, 'Electricity in', inW, f.pIn.toFixed(2), 's-bar-in')}
      ${bar(212, 'Heat out', outW, f.hOut.toFixed(2), 's-bar-out')}

      <text class="s-plate" x="${s.barX}" y="272">Heat per unit of electricity</text>
      <text class="s-val" x="${s.w - 8}" y="272" text-anchor="end">${f.cop ? `${f.cop.toFixed(2)}<tspan class="s-unit"> ×</tspan>` : '––'}</text>
    </svg>`;
}

function renderSchematicWide(livePerf, heatPump) {
    const s = SCHEMATIC;
    const outdoor = livePerf?.outdoorTemperature?.value;
    const pIn = parseFloat(livePerf?.powerInput?.value) || 0;
    const hOut = parseFloat(livePerf?.heatOutput?.value) || 0;
    const cop = parseFloat(livePerf?.coefficientOfPerformance);
    const flowTemp = heatPump?.heatingFlowTemperature?.currentTemperature?.value;
    const running = hOut > 0.05;

    // Both bars share a scale, so their lengths are directly comparable.
    const perKw = s.barMaxW / Math.max(hOut, pIn, 3);
    const inW = Math.max(pIn * perKw, pIn > 0 ? 2 : 0);
    const outW = Math.max(hOut * perKw, hOut > 0 ? 2 : 0);
    const period = running ? Math.min(Math.max(3.4 - hOut * 0.4, 0.55), 3.4) : 2;

    const flowPath = `M 214 ${s.flowY} H ${s.w - 24} V ${s.loopY} H ${s.dropX} V ${s.h}`;

    // Label, bar and number all hang off one centre line.
    const bar = (cy, label, width, value, cls) => `
      <g>
        <text class="s-plate" x="${s.barX - 16}" y="${baseline(cy, S_TYPE.plate)}" text-anchor="end">${label}</text>
        <rect class="${cls}" x="${s.barX}" y="${cy - s.barH / 2}" width="${width}" height="${s.barH}" />
        <text class="s-val" x="${s.barX + width + 12}" y="${baseline(cy, S_TYPE.val)}">${value}<tspan class="s-unit"> kW</tspan></text>
      </g>`;

    return `
    <svg class="schematic" viewBox="0 0 ${s.w} ${s.h}" role="img"
         style="--flow-period:${period}s"
         aria-label="Heat pump flow diagram. Outdoor air ${outdoor != null ? num(outdoor) : 'unknown'} degrees, ${pIn.toFixed(2)} kilowatts electricity in, ${hOut.toFixed(2)} kilowatts heat out.">
      <text class="s-plate" x="0" y="16">Outdoor air</text>
      <text class="s-val s-val--lg" x="0" y="46">${temp(outdoor) ?? '––'}</text>
      <path class="s-line" d="M 88 40 H 118" marker-end="url(#tip)" />

      <rect class="s-box" x="126" y="${s.flowY - 32}" width="88" height="64" />
      <text class="s-plate" x="170" y="${s.flowY - 12}" text-anchor="middle">Pump</text>
      <text class="s-val" x="170" y="${s.flowY + 12}" text-anchor="middle" style="font-size:13px">${running ? 'RUN' : 'IDLE'}</text>

      <path class="s-flow" data-state="${running ? 'running' : 'idle'}" d="${flowPath}" />

      <text class="s-plate" x="230" y="${s.flowY - 14}">Flow to circuits</text>
      <text class="s-val" x="342" y="${s.flowY - 13}">${temp(flowTemp, 0) ?? '––'}</text>

      ${bar(s.rowY[0], 'Electricity in', inW, pIn.toFixed(2), 's-bar-in')}
      ${bar(s.rowY[1], 'Heat out', outW, hOut.toFixed(2), 's-bar-out')}

      <text class="s-plate" x="${s.barX - 16}" y="${baseline(s.rowY[2], S_TYPE.plate)}" text-anchor="end">Efficiency now</text>
      <text class="s-val" x="${s.barX}" y="${baseline(s.rowY[2], S_TYPE.cop)}" style="font-size:${S_TYPE.cop}px">${cop ? `${cop.toFixed(2)}<tspan class="s-unit"> × more heat than electricity</tspan>` : '––'}</text>

      <defs>
        <marker id="tip" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ink-40)" />
        </marker>
      </defs>
    </svg>`;
}

function renderBranches(config) {
    return activeZones(config).map(zone => {
        const state = zoneState(zone);
        const { measured, target } = zoneReading(zone);
        const stateTag = {
            calling: '<span class="tag tag--solid tag--circuit">Calling for heat</span>',
            satisfied: '<span class="tag">Satisfied</span>',
            off: '<span class="tag tag--dim">Off</span>',
        }[state];

        return `
        <div class="branch" data-state="${state}" style="--circuit:${circuitVar(zone.zoneType)}">
            <div class="branch-id">
                <span class="branch-name">${esc(zone.displayName || zone.code)}</span>
                <span class="tag tag--circuit">${circuitLabel(zone.zoneType)}</span>
                ${stateTag}
                ${zone.emergency ? '<span class="tag tag--warn">Emergency</span>' : ''}
            </div>
            <div class="branch-read">
                ${measured != null ? `<span>${measured.toFixed(1)}°</span>` : ''}
                ${target != null ? `<span class="to">→ ${Number(target).toFixed(1)}°</span>` : ''}
                ${measured == null && target == null ? '<span class="to">No reading</span>' : ''}
            </div>
            <div class="branch-actions">
                <button class="btn btn--quiet btn--sm" onclick="app.showZoneOverride('${esc(zone.code)}')">Override</button>
                <button class="btn btn--quiet btn--sm" onclick="app.showEditZone('${esc(zone.code)}')">Schedule</button>
            </div>
        </div>`;
    }).join('');
}

// --- Weather compensation curve -------------------------------------------
// Same ink as the schematic: the flow line drops out of the diagram and lands
// on this axis. Drag the ends to set the policy; nothing is sent until Save.

const CURVE = {
    w: 720,
    h: 300,
    padL: 46,
    padR: 26,
    padT: 22,
    padB: 40,
    xMin: -8,
    xMax: 18,
    yMin: 20,
    yMax: 60,
};

let curveState = null;

function curveX(t) {
    const c = CURVE;
    return c.padL + ((t - c.xMin) / (c.xMax - c.xMin)) * (c.w - c.padL - c.padR);
}

function curveY(t) {
    const c = CURVE;
    return c.padT + (1 - (t - c.yMin) / (c.yMax - c.yMin)) * (c.h - c.padT - c.padB);
}

function curveTempFromY(y) {
    const c = CURVE;
    const frac = 1 - (y - c.padT) / (c.h - c.padT - c.padB);
    return c.yMin + frac * (c.yMax - c.yMin);
}

function curveTempFromX(x) {
    const c = CURVE;
    const frac = (x - c.padL) / (c.w - c.padL - c.padR);
    return clamp(c.xMin + frac * (c.xMax - c.xMin), c.xMin, c.xMax);
}

function initCurveState(heatPump) {
    const wc = heatPump?.weatherCompensation || {};
    const fixed = heatPump?.heatingFlowTemperature?.currentTemperature?.value;
    const saved = {
        useWc: !!wc.enabled,
        min: parseFloat(wc.currentRange?.minimum?.value ?? 25),
        max: parseFloat(wc.currentRange?.maximum?.value ?? 50),
        fixed: parseFloat(fixed ?? 45),
    };
    curveState = {
        saved,
        draft: { ...saved },
        limits: {
            min: {
                lo: parseFloat(wc.allowableMinimumTemperatureRange?.minimum?.value ?? CURVE.yMin),
                hi: parseFloat(wc.allowableMinimumTemperatureRange?.maximum?.value ?? CURVE.yMax),
            },
            max: {
                lo: parseFloat(wc.allowableMaximumTemperatureRange?.minimum?.value ?? CURVE.yMin),
                hi: parseFloat(wc.allowableMaximumTemperatureRange?.maximum?.value ?? CURVE.yMax),
            },
            fixed: {
                lo: parseFloat(heatPump?.heatingFlowTemperature?.allowableRange?.minimum?.value ?? CURVE.yMin),
                hi: parseFloat(heatPump?.heatingFlowTemperature?.allowableRange?.maximum?.value ?? CURVE.yMax),
            },
        },
        dragging: null,
        probing: false,
        saving: false,
    };
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function curveIsDirty() {
    const { saved, draft } = curveState;
    if (saved.useWc !== draft.useWc) return true;
    return draft.useWc
        ? draft.min !== saved.min || draft.max !== saved.max
        : draft.fixed !== saved.fixed;
}

// Flow the pump should run at, under a given policy, when it is t outside.
// The Now marker and the hover probe both read the line through here.
function policyFlowAt(policy, t) {
    const c = CURVE;
    if (!policy.useWc) return policy.fixed;
    const frac = (clamp(t, c.xMin, c.xMax) - c.xMin) / (c.xMax - c.xMin);
    return policy.max + (policy.min - policy.max) * frac;
}

function policyPath(policy) {
    const c = CURVE;
    if (!policy.useWc) {
        return `M ${curveX(c.xMin)} ${curveY(policy.fixed)} H ${curveX(c.xMax)}`;
    }
    return `M ${curveX(c.xMin)} ${curveY(policy.max)} L ${curveX(c.xMax)} ${curveY(policy.min)}`;
}

function renderCurveSvg(livePerf) {
    const c = CURVE;
    // The plot keeps its height on a phone and loses width, so the labels and
    // handles stay finger- and eye-sized.
    c.w = isCompact() ? 420 : 720;
    c.padL = isCompact() ? 40 : 46;
    const { draft, saved, limits } = curveState;
    const outdoor = livePerf?.outdoorTemperature?.value;
    const nowX = outdoor != null ? curveX(clamp(parseFloat(outdoor), c.xMin, c.xMax)) : null;

    const nowY = outdoor != null
        ? curveY(clamp(policyFlowAt(draft, parseFloat(outdoor)), c.yMin, c.yMax))
        : null;

    const xTicks = isCompact() ? [-5, 5, 15] : [-5, 0, 5, 10, 15];
    const yTicks = [25, 35, 45, 55];

    const grid = [
        ...xTicks.map(t => `<line class="c-grid" x1="${curveX(t)}" y1="${c.padT}" x2="${curveX(t)}" y2="${c.h - c.padB}" />`),
        ...yTicks.map(t => `<line class="c-grid" x1="${c.padL}" y1="${curveY(t)}" x2="${c.w - c.padR}" y2="${curveY(t)}" />`),
    ].join('');

    const labels = [
        ...xTicks.map(t => `<text x="${curveX(t)}" y="${c.h - c.padB + 16}" text-anchor="middle">${t}</text>`),
        ...yTicks.map(t => `<text x="${c.padL - 10}" y="${curveY(t) + 3}" text-anchor="end">${t}</text>`),
    ].join('');

    const handles = draft.useWc
        ? `
        <circle class="c-handle" tabindex="0" role="slider" data-handle="max"
                aria-label="Flow temperature at ${c.xMin} degrees outdoors"
                aria-valuemin="${limits.max.lo}" aria-valuemax="${limits.max.hi}" aria-valuenow="${draft.max}"
                cx="${curveX(c.xMin)}" cy="${curveY(draft.max)}" r="8" />
        <circle class="c-handle" tabindex="0" role="slider" data-handle="min"
                aria-label="Flow temperature at ${c.xMax} degrees outdoors"
                aria-valuemin="${limits.min.lo}" aria-valuemax="${limits.min.hi}" aria-valuenow="${draft.min}"
                cx="${curveX(c.xMax)}" cy="${curveY(draft.min)}" r="8" />
        <text class="c-readout" data-readout="max" x="${curveX(c.xMin) + 14}" y="${curveY(draft.max) - 10}">${draft.max.toFixed(0)}°</text>
        <text class="c-readout" data-readout="min" x="${curveX(c.xMax) - 14}" y="${curveY(draft.min) - 10}" text-anchor="end">${draft.min.toFixed(0)}°</text>`
        : `
        <circle class="c-handle" tabindex="0" role="slider" data-handle="fixed"
                aria-label="Fixed flow temperature"
                aria-valuemin="${limits.fixed.lo}" aria-valuemax="${limits.fixed.hi}" aria-valuenow="${draft.fixed}"
                cx="${curveX(c.xMin)}" cy="${curveY(draft.fixed)}" r="8" />
        <text class="c-readout" data-readout="fixed" x="${curveX(c.xMin) + 14}" y="${curveY(draft.fixed) - 10}">${draft.fixed.toFixed(0)}°</text>`;

    return `
    <svg class="curve" viewBox="0 0 ${c.w} ${c.h}" role="group"
         aria-label="Flow temperature against outdoor temperature">
      <path class="c-drop" d="M 4 0 V ${c.h - c.padB} H ${c.padL}" />
      ${grid}
      <line class="c-axis" x1="${c.padL}" y1="${c.padT}" x2="${c.padL}" y2="${c.h - c.padB}" />
      <line class="c-axis" x1="${c.padL}" y1="${c.h - c.padB}" x2="${c.w - c.padR}" y2="${c.h - c.padB}" />
      ${labels}
      <text x="${c.padL - 10}" y="${c.padT - 8}" text-anchor="end">°C</text>
      <text x="${c.w - c.padR}" y="${c.h - 8}" text-anchor="end">Outdoor °C</text>
      ${curveIsDirty() ? `<path class="c-saved" d="${policyPath(saved)}" />` : ''}
      <path class="c-live" d="${policyPath(draft)}" />
      ${nowX != null ? `
        <line class="c-drop" x1="${nowX}" y1="${nowY}" x2="${nowX}" y2="${c.h - c.padB}" />
        <circle class="c-now-ring" cx="${nowX}" cy="${nowY}" r="11" />
        <circle class="c-now" cx="${nowX}" cy="${nowY}" r="4" />
        <text class="c-readout" x="${nowX + 14}" y="${nowY + 4}">Now</text>` : ''}
      ${handles}
      <g class="c-probe" data-on="false" aria-hidden="true">
        <line class="c-probe-guide" x1="0" y1="${c.padT}" x2="0" y2="${c.h - c.padB}" />
        <path class="c-probe-cross" d="" />
        <circle class="c-probe-dot" cx="0" cy="0" r="3" />
        <text class="c-probe-read" x="0" y="0"><tspan class="c-probe-out" data-probe="out"></tspan><tspan data-probe="flow" dx="4"></tspan></text>
      </g>
    </svg>`;
}

function renderCurveSheet(livePerf) {
    const { draft } = curveState;
    const dirty = curveIsDirty();
    const summary = draft.useWc
        ? `Flow follows the weather: ${draft.max.toFixed(0)}° when it's ${CURVE.xMin}° out, ${draft.min.toFixed(0)}° when it's ${CURVE.xMax}° out.`
        : `Flow holds at ${draft.fixed.toFixed(0)}° whatever the weather.`;

    return `
    <section class="sheet" id="curve-sheet">
        <div class="sheet-head">
            <span class="plate">Flow policy</span>
            <div class="head-actions">
                <button class="btn btn--sm ${draft.useWc ? 'btn--primary' : 'btn--quiet'}" onclick="app.setCurveMode(true)">Weather</button>
                <button class="btn btn--sm ${draft.useWc ? 'btn--quiet' : 'btn--primary'}" onclick="app.setCurveMode(false)">Fixed</button>
            </div>
        </div>
        <div class="curve-wrap" id="curve-wrap">${renderCurveSvg(livePerf)}</div>
        <div class="curve-foot">
            <span class="prose" style="margin:0">${esc(summary)}</span>
            <div class="actions">
                <button class="btn btn--quiet btn--sm" onclick="app.resetCurve()" ${dirty ? '' : 'disabled'}>Discard</button>
                <button class="btn btn--primary btn--sm" onclick="app.saveCurve()" ${dirty ? '' : 'disabled'}>Save policy</button>
            </div>
        </div>
    </section>`;
}

function repaintCurve() {
    const sheet = document.getElementById('curve-sheet');
    if (!sheet) return;
    sheet.outerHTML = renderCurveSheet(latestLive);
    bindCurve();
}

// Dragging moves SVG attributes directly, so the pointer keeps its capture and
// the sheet only re-renders (to refresh Save/Discard) once the drag ends.
function bindCurve() {
    const svg = document.querySelector('#curve-wrap .curve');
    if (!svg) return;

    const setValue = (name, value) => {
        const { lo, hi } = curveState.limits[name];
        const next = Math.round(clamp(value, lo, hi));
        if (next === curveState.draft[name]) return false;
        curveState.draft[name] = next;
        return true;
    };

    const paintDrag = () => {
        const { draft } = curveState;
        svg.querySelector('.c-live').setAttribute('d', policyPath(draft));
        svg.querySelectorAll('.c-handle').forEach(h => {
            const value = draft[h.dataset.handle];
            h.setAttribute('cy', curveY(value));
            h.setAttribute('aria-valuenow', value);
        });
        svg.querySelectorAll('.c-readout[data-readout]').forEach(readout => {
            const value = draft[readout.dataset.readout];
            readout.setAttribute('y', curveY(value) - 10);
            readout.textContent = `${value.toFixed(0)}°`;
        });
    };

    svg.querySelectorAll('.c-handle').forEach(handle => {
        const name = handle.dataset.handle;

        handle.addEventListener('pointerdown', e => {
            e.preventDefault();
            curveState.dragging = name;
            handle.setPointerCapture(e.pointerId);
        });

        handle.addEventListener('pointermove', e => {
            if (curveState.dragging !== name) return;
            const pt = svg.createSVGPoint();
            pt.x = e.clientX;
            pt.y = e.clientY;
            const local = pt.matrixTransform(svg.getScreenCTM().inverse());
            if (setValue(name, curveTempFromY(local.y))) paintDrag();
        });

        const endDrag = () => {
            if (curveState.dragging !== name) return;
            curveState.dragging = null;
            repaintCurve();
        };
        handle.addEventListener('pointerup', endDrag);
        handle.addEventListener('pointercancel', endDrag);

        handle.addEventListener('keydown', e => {
            const step = e.shiftKey ? 5 : 1;
            const up = e.key === 'ArrowUp' || e.key === 'ArrowRight';
            const down = e.key === 'ArrowDown' || e.key === 'ArrowLeft';
            if (!up && !down) return;
            e.preventDefault();
            if (setValue(name, curveState.draft[name] + (up ? step : -step))) {
                repaintCurve();
                document.querySelector(`.c-handle[data-handle="${name}"]`)?.focus();
            }
        });
    });

    bindCurveProbe(svg);
}

// Hovering the plot reads the policy back: a crosshair where the pointer is,
// and a dot on the line showing the flow temperature it would ask for there.
// Hover-capable pointers only, so touch keeps the plot's drag gestures.
function bindCurveProbe(svg) {
    const probe = svg.querySelector('.c-probe');
    if (!probe || !matchMedia('(hover: hover)').matches) return;

    const guide = probe.querySelector('.c-probe-guide');
    const cross = probe.querySelector('.c-probe-cross');
    const dot = probe.querySelector('.c-probe-dot');
    const read = probe.querySelector('.c-probe-read');
    const outText = probe.querySelector('[data-probe="out"]');
    const flowText = probe.querySelector('[data-probe="flow"]');

    const hide = () => {
        probe.dataset.on = 'false';
        curveState.probing = false;
    };

    svg.addEventListener('pointermove', e => {
        const c = CURVE;
        if (curveState.dragging) {
            hide();
            return;
        }

        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const local = pt.matrixTransform(svg.getScreenCTM().inverse());
        const inPlot = local.x >= c.padL && local.x <= c.w - c.padR
            && local.y >= c.padT && local.y <= c.h - c.padB;
        if (!inPlot) {
            hide();
            return;
        }

        const outdoorT = curveTempFromX(local.x);
        const flowT = clamp(policyFlowAt(curveState.draft, outdoorT), c.yMin, c.yMax);
        const dotY = curveY(flowT);
        // Near the right margin the chip would run off the plot, so it flips.
        const flip = local.x + 90 > c.w - c.padR;

        guide.setAttribute('x1', local.x);
        guide.setAttribute('x2', local.x);
        cross.setAttribute('d', `M ${local.x - 4} ${local.y} h 8 M ${local.x} ${local.y - 4} v 8`);
        dot.setAttribute('cx', local.x);
        dot.setAttribute('cy', dotY);
        read.setAttribute('x', local.x + (flip ? -10 : 10));
        read.setAttribute('y', dotY + 4);
        read.setAttribute('text-anchor', flip ? 'end' : 'start');
        outText.textContent = `${outdoorT.toFixed(0)}° →`;
        flowText.textContent = `${flowT.toFixed(0)}°`;

        probe.dataset.on = 'true';
        curveState.probing = true;
    });

    svg.addEventListener('pointerleave', hide);
}

export function setCurveMode(useWc) {
    curveState.draft.useWc = useWc;
    repaintCurve();
}

export function resetCurve() {
    curveState.draft = { ...curveState.saved };
    repaintCurve();
}

export async function saveCurve() {
    const { draft } = curveState;
    if (draft.useWc && draft.min > draft.max) {
        toast('The warm-weather flow temperature must sit below the cold-weather one.', 'error');
        return;
    }
    try {
        await client.updateFlowTemperatureConfiguration(draft.useWc, draft.fixed, draft.min, draft.max);
        curveState.saved = { ...draft };
        toast('Flow policy saved');
        repaintCurve();
    } catch (e) {
        toast(e.message, 'error');
    }
}

// --- Dashboard ------------------------------------------------------------

function renderDashboard(config, livePerf) {
    const hp = config.heatPump || {};
    const controller = config.controller || {};
    const perf = config.performance || {};
    const device = config.device || {};

    initCurveState(hp);

    linkState.classList.remove('hidden');
    const faults = hp.faultCodes?.length ? hp.faultCodes : null;
    linkState.dataset.state = faults ? 'fault' : (controller.connected ? 'on' : 'off');
    linkState.textContent = faults ? `Fault ${faults.join(', ')}` : (controller.connected ? 'Connected' : 'Offline');

    const zones = activeZones(config);

    let html = `
    <section class="sheet schematic-sheet">
        <div class="sheet-head">
            <span class="plate">Right now</span>
            <div class="head-actions">
                <span class="plate" id="live-age">${esc(readAge(livePerf?.readAt))}</span>
            </div>
        </div>
        <div id="schematic-wrap">${renderSchematicSvg(livePerf, hp)}</div>
        <div class="branches">${renderBranches(config)}</div>
    </section>`;

    html += renderCurveSheet(livePerf);

    html += `<div class="columns">${zones.map(zone => renderZoneSheet(zone)).join('')}</div>`;

    html += `
    <section class="sheet">
        <div class="sheet-head">
            <span class="plate">Performance</span>
            <div class="head-actions">
                <button class="btn btn--quiet btn--sm" onclick="app.showPerformanceHistory()">Last 14 days</button>
            </div>
        </div>
        <dl class="spec">
            <dt>Seasonal efficiency</dt><dd>${num(perf.seasonalCoefficientOfPerformance, 2) ?? '––'}</dd>
            <dt>Heat delivered</dt><dd>${num(perf.heatOutput?.value) ?? '––'} kWh</dd>
            <dt>Electricity used</dt><dd>${num(perf.energyInput?.value) ?? '––'} kWh</dd>
            <dt>Counted since</dt><dd>${hp.latestCounterReset ? esc(new Date(hp.latestCounterReset).toLocaleDateString()) : '––'}</dd>
        </dl>
    </section>

    <details class="sheet">
        <summary class="plate" style="cursor:pointer;list-style:none;">Controller detail</summary>
        <div style="margin-top:1.5rem;display:grid;gap:1.5rem;">
            <div class="actions">
                <button class="btn btn--quiet btn--sm" onclick="app.toggleQuieterMode(${!hp.quieterModeEnabled})">
                    ${hp.quieterModeEnabled ? 'Turn quieter mode off' : 'Turn quieter mode on'}
                </button>
                ${device.controlMode === 'SMART' ? '' : '<button class="btn btn--quiet btn--sm" onclick="app.setupSmartControl()">Let Octopus optimise</button>'}
            </div>
            <dl class="spec">
                <dt>Model</dt><dd>${esc(hp.model || '––')}</dd>
                <dt>Serial</dt><dd>${esc(hp.serialNumber || '––')}</dd>
                <dt>Quieter mode</dt><dd>${hp.quieterModeEnabled ? 'On' : 'Off'}</dd>
                <dt>Optimisation</dt><dd>${device.controlMode === 'SMART' ? 'Octopus is optimising' : 'You are in control'}</dd>
                <dt>Hot water range</dt><dd>${hp.minWaterSetpoint ?? '––'}–${hp.maxWaterSetpoint ?? '––'}°C</dd>
                <dt>Faults</dt><dd>${faults ? esc(faults.join(', ')) : 'None'}</dd>
                <dt>Controller state</dt><dd>${esc(controller.state?.join(', ') || '––')}</dd>
                <dt>Hardware</dt><dd>${esc(hp.hardwareVersion || '––')}</dd>
                <dt>Firmware</dt><dd>ESP32 ${esc(controller.firmwareConfiguration?.esp32 || '––')} · EFR32 ${esc(controller.firmwareConfiguration?.efr32 || '––')}</dd>
                <dt>EUI</dt><dd>${esc(controller.firmwareConfiguration?.eui || '––')}</dd>
                <dt>Last restart</dt><dd>${controller.lastReset ? esc(new Date(controller.lastReset).toLocaleString()) : '––'}</dd>
            </dl>
        </div>
    </details>`;

    viewDashboard.innerHTML = html;
    bindCurve();
}

function renderZoneSheet(zone) {
    const { measured, target } = zoneReading(zone);
    const state = zoneState(zone);
    const mode = zone.currentOperation?.mode;

    const sensors = (zone.sensors || []).filter(s => !(s.telemetry && isSentinel(s.telemetry.temperatureInCelsius)));

    const sensorsHtml = sensors.length ? `
        <div>
            <div class="subhead">Sensors</div>
            ${sensors.map(s => {
                const primary = zone.primarySensor === s.code;
                const offline = s.connectivity && !s.connectivity.online;
                const parts = [];
                if (s.telemetry) {
                    if (!isSentinel(s.telemetry.temperatureInCelsius)) parts.push(`${num(s.telemetry.temperatureInCelsius)}°`);
                    if (s.telemetry.humidityPercentage) parts.push(`${s.telemetry.humidityPercentage}% RH`);
                    if (s.telemetry.voltage) parts.push(`${s.telemetry.voltage}V`);
                    if (s.telemetry.rssi != null) parts.push(`${s.telemetry.rssi} dBm`);
                }
                return `
                <div class="sensor" data-offline="${offline}">
                    <div class="sensor-name">
                        ${primary ? '<span class="sensor-primary" title="Sets this zone\'s temperature">◆</span>' : ''}
                        <span>${esc(s.displayName || s.code)}</span>
                        ${offline ? '<span class="tag tag--warn">Offline</span>' : ''}
                    </div>
                    <div class="sensor-read">${parts.join(' · ') || '––'}</div>
                    <div class="sensor-tools">
                        <button class="btn btn--quiet btn--sm" onclick="app.renameSensor('${esc(s.code)}')">Rename</button>
                        ${primary ? '' : `<button class="btn btn--quiet btn--sm" onclick="app.setPrimarySensor('${esc(zone.code)}','${esc(s.code)}')">Use for this zone</button>`}
                    </div>
                </div>`;
            }).join('')}
        </div>` : '';

    const schedulesHtml = zone.schedules?.length ? `
        <table class="sched">
            <thead><tr><th>Days</th><th>Slots</th></tr></thead>
            <tbody>
                ${zone.schedules.map(s => `
                <tr>
                    <td>${renderDayMask(s.days)}</td>
                    <td>${s.settings.map(slot => `
                        <div class="slot">
                            <span class="slot-time">${esc(slot.time)}</span>
                            ${slot.action === 'OFF'
                                ? '<span class="slot-off">off</span>'
                                : `<span class="slot-set">${slot.setpointInCelsius != null ? `${Number(slot.setpointInCelsius).toFixed(1)}°` : esc(slot.action)}</span>`}
                        </div>`).join('')}
                    </td>
                </tr>`).join('')}
            </tbody>
        </table>` : '<p class="empty">No schedule set.</p>';

    return `
    <section class="sheet zone stack" data-state="${state}" style="--circuit:${circuitVar(zone.zoneType)}">
        <div>
            <div class="zone-head">
                <span class="zone-name">${esc(zone.displayName || zone.code)}</span>
                <span class="tag tag--circuit">${circuitLabel(zone.zoneType)}</span>
            </div>
            <div class="reading">
                <span class="reading-now">${measured != null ? `${measured.toFixed(1)}°` : (target != null ? `${Number(target).toFixed(1)}°` : '––')}</span>
                <span class="reading-target">${
                    measured != null
                        ? (target != null ? `target ${Number(target).toFixed(1)}°` : '')
                        : (target != null ? 'target · no sensor here' : '')
                }</span>
            </div>
            <div class="tags" style="margin-top:.75rem;">
                ${mode ? `<span class="tag">${esc(mode)}</span>` : ''}
                ${state === 'calling' ? '<span class="tag tag--solid tag--circuit">Calling for heat</span>' : ''}
                ${zone.telemetry?.relaySwitchedOn ? '<span class="tag tag--circuit">Relay on</span>' : ''}
                ${zone.emergency ? '<span class="tag tag--warn">Emergency</span>' : ''}
            </div>
        </div>
        ${sensorsHtml}
        <div>
            <div class="subhead">Schedule</div>
            ${schedulesHtml}
        </div>
        <div class="actions">
            <button class="btn btn--primary btn--sm" onclick="app.showZoneOverride('${esc(zone.code)}')">Override</button>
            <button class="btn btn--quiet btn--sm" onclick="app.showEditZone('${esc(zone.code)}')">Edit schedule</button>
            <button class="btn btn--quiet btn--sm" onclick="app.renameZone('${esc(zone.code)}')">Rename</button>
        </div>
    </section>`;
}

function renderDayMask(mask) {
    return `<div class="daymask">${dayInitials.map((d, i) =>
        `<span class="daymask-cell" data-on="${mask[i] === '1'}" title="${dayNames[i]}">${d}</span>`
    ).join('')}</div>`;
}

// --- Live refresh ---------------------------------------------------------

function startLiveRefresh() {
    stopLiveRefresh();
    liveRefreshInterval = setInterval(updateLive, 5000);
}

function stopLiveRefresh() {
    if (liveRefreshInterval) {
        clearInterval(liveRefreshInterval);
        liveRefreshInterval = null;
    }
}

async function updateLive() {
    if (!client || viewDashboard.classList.contains('hidden')) return;

    try {
        latestLive = await client.getLivePerformance();
    } catch (e) {
        console.warn('Live performance refresh failed:', e.message);
        return;
    }

    const wrap = document.getElementById('schematic-wrap');
    if (wrap) wrap.innerHTML = renderSchematicSvg(latestLive, currentConfig?.heatPump);
    const age = document.getElementById('live-age');
    if (age) age.textContent = readAge(latestLive?.readAt);

    // Leave the curve alone while it is being edited or read.
    if (curveState && !curveState.dragging && !curveState.probing && !curveIsDirty()) repaintCurve();
}

// --- Schedule editor ------------------------------------------------------

export function showEditZone(zoneCode) {
    const zone = currentConfig.zones.find(z => z.configuration.code === zoneCode)?.configuration;
    if (!zone) return;

    hideAllViews();
    logoutBtn.classList.remove('hidden');
    viewEditZone.classList.remove('hidden');

    viewEditZone.innerHTML = `
        <button class="btn btn--quiet btn--sm backlink" onclick="app.showDashboard()">← Dashboard</button>
        <section class="sheet zone" style="--circuit:${circuitVar(zone.zoneType)}">
            <div class="sheet-head">
                <span class="plate">Schedule · ${esc(zone.displayName || zone.code)}</span>
            </div>
            <p class="prose" style="margin-bottom:1.5rem;">
                Each group applies to the days you tick. A slot runs from its start time until the next one.
            </p>
            <form id="scheduleForm" onsubmit="app.handleSaveSchedule(event, '${esc(zone.code)}', '${esc(zone.zoneType)}')">
                <div id="groups">${(zone.schedules || []).map(s => renderGroup(s)).join('')}</div>
                <div style="margin-bottom:1.5rem;">
                    <button type="button" class="btn btn--quiet btn--sm" onclick="app.addGroup()">Add day group</button>
                </div>
                <div class="actions">
                    <button type="submit" class="btn btn--primary">Save schedule</button>
                    <button type="button" class="btn btn--quiet" onclick="app.showDashboard()">Cancel</button>
                </div>
            </form>
        </section>`;
}

function renderGroup(sched) {
    const mask = sched ? sched.days : '0000000';
    const settings = sched ? sched.settings : [];

    return `
    <div class="group">
        <div class="group-head">
            <span class="plate">Day group</span>
            <button type="button" class="btn btn--danger btn--sm" onclick="app.removeGroup(this)">Remove</button>
        </div>
        <div class="dayrow" style="margin-bottom:1rem;">
            ${dayNames.map((d, i) => `
            <label class="daypick">
                <input type="checkbox" value="${d}" ${mask[i] === '1' ? 'checked' : ''}>
                <span>${d.slice(0, 2)}</span>
            </label>`).join('')}
        </div>
        <table class="sched">
            <thead>
                <tr><th style="width:8rem;">From</th><th style="width:10rem;">Then</th><th style="width:7rem;">Target</th><th></th></tr>
            </thead>
            <tbody class="slots-body">${settings.map(slot => renderSlotRow(slot)).join('')}</tbody>
        </table>
        <button type="button" class="btn btn--quiet btn--sm" style="margin-top:.75rem;" onclick="app.addSlot(this)">Add slot</button>
    </div>`;
}

function renderSlotRow(slot) {
    const isHeat = slot && slot.action !== 'OFF';
    const tempVal = slot?.setpointInCelsius != null ? slot.setpointInCelsius : '';
    const timeVal = slot ? slot.time : '';

    return `
    <tr class="slot-edit">
        <td><input type="time" value="${esc(timeVal)}" required></td>
        <td>
            <select onchange="app.toggleSetpoint(this)">
                <option value="HEAT" ${isHeat ? 'selected' : ''}>Heat to</option>
                <option value="OFF" ${isHeat ? '' : 'selected'}>Off</option>
            </select>
        </td>
        <td class="setpoint-cell">
            <input type="number" value="${esc(tempVal)}" min="5" max="80" step="0.5" placeholder="°C" ${isHeat ? '' : 'style="visibility:hidden"'}>
        </td>
        <td><button type="button" class="btn btn--quiet btn--sm" onclick="app.removeSlot(this)" aria-label="Remove slot">✕</button></td>
    </tr>`;
}

export function handleSaveSchedule(e, zoneCode, zoneType) {
    e.preventDefault();

    const groups = [];
    document.querySelectorAll('#groups .group').forEach(gBlock => {
        const checkedDays = [...gBlock.querySelectorAll('.dayrow input:checked')].map(cb => cb.value);
        const mask = dayNames.map(d => (checkedDays.includes(d) ? '1' : '0')).join('');
        if (mask === '0000000') return;

        const settings = [];
        gBlock.querySelectorAll('.slots-body tr').forEach(row => {
            const time = row.querySelector('input[type=time]').value;
            const action = row.querySelector('select').value;
            const setpoint = row.querySelector('input[type=number]').value;
            if (!time) return;

            if (action === 'HEAT') {
                if (!setpoint) return; // A heat slot without a target is not a slot.
                settings.push({ time, action: 'SET_TEMPERATURE', setpointInCelsius: parseFloat(setpoint) });
            } else {
                settings.push({ time, action: 'TURN_OFF', setpointInCelsius: null });
            }
        });

        if (settings.length > 0) groups.push({ days: mask, settings });
    });

    const submitBtn = e.target.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    client.setZoneSchedules(zoneCode, zoneType, groups)
        .then(() => {
            toast('Schedule saved');
            showDashboard();
        })
        .catch(err => {
            toast(err.message, 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save schedule';
        });
}

export function removeGroup(btn) {
    const groups = document.querySelectorAll('#groups .group');
    if (groups.length <= 1) {
        toast('Keep at least one day group. Remove its slots to clear the schedule.', 'error');
        return;
    }
    btn.closest('.group').remove();
}

export function removeSlot(btn) {
    btn.closest('tr').remove();
}

export function addGroup() {
    document.getElementById('groups').insertAdjacentHTML('beforeend', renderGroup(null));
}

export function addSlot(btn) {
    btn.previousElementSibling.querySelector('.slots-body').insertAdjacentHTML('beforeend', renderSlotRow(null));
}

export function toggleSetpoint(select) {
    const setpoint = select.closest('tr').querySelector('input[type=number]');
    setpoint.style.visibility = select.value === 'OFF' ? 'hidden' : 'visible';
    if (select.value === 'OFF') setpoint.value = '';
}

// --- Overrides ------------------------------------------------------------

export function showZoneOverride(zoneCode) {
    const zone = currentConfig.zones.find(z => z.configuration.code === zoneCode)?.configuration;
    if (!zone) return;

    const { target } = zoneReading(zone);

    hideAllViews();
    logoutBtn.classList.remove('hidden');
    viewZoneOverride.classList.remove('hidden');

    viewZoneOverride.innerHTML = `
        <button class="btn btn--quiet btn--sm backlink" onclick="app.showDashboard()">← Dashboard</button>
        <section class="sheet sheet--narrow zone" style="--circuit:${circuitVar(zone.zoneType)}">
            <div class="sheet-head"><span class="plate">Override · ${esc(zone.displayName || zone.code)}</span></div>
            <p class="prose" style="margin-bottom:1.5rem;">
                Overrides sit on top of the schedule. Leave the end time empty to hold it until you change it back.
            </p>
            <form onsubmit="event.preventDefault(); app.submitZoneOverride(this, '${esc(zone.code)}')">
                <label class="field">
                    <span class="plate">Mode</span>
                    <select name="mode" onchange="app.toggleOverrideAction(this.value)">
                        <option value="AUTO">Follow the schedule</option>
                        <option value="ON" selected>Heat now</option>
                        <option value="BOOST">Boost</option>
                        <option value="OFF">Off</option>
                    </select>
                </label>
                <label class="field" id="ov-setpoint">
                    <span class="plate">Target</span>
                    <input type="number" name="setpoint" value="${target != null ? Number(target).toFixed(1) : '21'}" min="5" max="80" step="0.5">
                </label>
                <label class="field">
                    <span class="plate">Until</span>
                    <input type="datetime-local" name="endAt">
                    <span class="field-hint">Empty = no end time</span>
                </label>
                <div class="actions">
                    <button type="submit" class="btn btn--primary">Apply override</button>
                    <button type="button" class="btn btn--quiet" onclick="app.showDashboard()">Cancel</button>
                </div>
            </form>
        </section>`;
}

export function toggleOverrideAction(mode) {
    document.getElementById('ov-setpoint').style.display = (mode === 'ON' || mode === 'BOOST') ? 'block' : 'none';
}

export async function submitZoneOverride(form, zoneCode) {
    const mode = form.mode.value;
    let action = null;
    let setpoint = '';

    if (mode === 'ON' || mode === 'BOOST') {
        action = 'SET_TEMPERATURE';
        setpoint = form.setpoint.value;
    } else if (mode === 'OFF') {
        action = 'TURN_OFF';
    }

    let endAt = form.endAt.value;
    if (endAt) endAt = new Date(endAt).toISOString().split('.')[0] + 'Z';

    await run(
        () => client.setZoneMode(zoneCode, mode, endAt, setpoint, action),
        mode === 'AUTO' ? 'Back on schedule' : 'Override applied',
    );
}

// --- Controller actions ---------------------------------------------------

export async function toggleQuieterMode(enabled) {
    const ok = await confirmAction({
        title: enabled ? 'Turn quieter mode on' : 'Turn quieter mode off',
        body: enabled
            ? 'The pump runs slower and quieter. It may take longer to reach temperature.'
            : 'The pump returns to full output.',
        confirmLabel: enabled ? 'Turn on' : 'Turn off',
    });
    if (!ok) return;
    await run(() => client.setQuieterMode(enabled), enabled ? 'Quieter mode on' : 'Quieter mode off');
}

export async function renameZone(zoneCode) {
    const zone = currentConfig.zones.find(z => z.configuration.code === zoneCode)?.configuration;
    if (!zone) return;
    const name = await promptForText({
        title: 'Rename zone',
        label: 'Zone name',
        value: zone.displayName || '',
    });
    if (!name || name === zone.displayName) return;
    await run(() => client.updateZoneDisplayName(zoneCode, name), 'Zone renamed');
}

export async function renameSensor(sensorCode) {
    let current = '';
    currentConfig.zones.forEach(z => {
        const match = (z.configuration.sensors || []).find(s => s.code === sensorCode);
        if (match) current = match.displayName || '';
    });
    const name = await promptForText({
        title: 'Rename sensor',
        label: 'Sensor name',
        value: current,
    });
    if (!name || name === current) return;
    await run(() => client.updateSensorDisplayName(sensorCode, name), 'Sensor renamed');
}

export async function setPrimarySensor(zoneCode, sensorCode) {
    const ok = await confirmAction({
        title: 'Use this sensor',
        body: 'This zone will follow this sensor when deciding whether to call for heat.',
        confirmLabel: 'Use it',
    });
    if (!ok) return;
    await run(() => client.setZonePrimarySensor(zoneCode, sensorCode), 'Sensor set for this zone');
}

export async function setupSmartControl() {
    const ok = await confirmAction({
        title: 'Let Octopus optimise',
        body: 'Octopus takes over scheduling to run the pump when electricity is cheapest.',
        confirmLabel: 'Hand over',
    });
    if (!ok) return;
    await run(() => client.setupSmartControl(), 'Optimisation requested');
}

// --- History --------------------------------------------------------------

export async function showPerformanceHistory() {
    hideAllViews();
    viewLoading.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');

    try {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 14);

        const [days, totals] = await Promise.all([
            client.getPerformanceHistory(start.toISOString(), end.toISOString(), 'DAY'),
            client.getTimeRangedPerformance(start.toISOString(), end.toISOString()),
        ]);

        const rows = [...(days || [])]
            .map(d => {
                const energyIn = parseFloat(d.energyInput?.value);
                const energyOut = parseFloat(d.energyOutput?.value);
                return {
                    date: new Date(d.startAt),
                    outdoor: parseFloat(d.outdoorTemperature?.value),
                    energyIn,
                    energyOut,
                    cop: energyIn > 0 && energyOut > 0 ? energyOut / energyIn : null,
                };
            })
            .sort((a, b) => b.date - a.date);

        viewPerformance.innerHTML = `
        <button class="btn btn--quiet btn--sm backlink" onclick="app.showDashboard()">← Dashboard</button>
        <section class="sheet">
            <div class="sheet-head"><span class="plate">Last 14 days</span></div>
            <div class="totals">
                <div class="total-item">
                    <span class="plate">Efficiency</span>
                    <span class="total-val">${num(totals?.coefficientOfPerformance, 2) ?? '––'}</span>
                </div>
                <div class="total-item">
                    <span class="plate">Electricity used</span>
                    <span class="total-val">${num(totals?.energyInput?.value) ?? '––'}<span class="s-unit" style="font-size:13px"> kWh</span></span>
                </div>
                <div class="total-item">
                    <span class="plate">Heat delivered</span>
                    <span class="total-val">${num(totals?.energyOutput?.value) ?? '––'}<span class="s-unit" style="font-size:13px"> kWh</span></span>
                </div>
            </div>
            ${rows.length ? `
            <table class="history">
                <thead>
                    <tr><th>Day</th><th>Outdoor</th><th>In</th><th>Out</th><th>Efficiency</th></tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                    <tr>
                        <td>${esc(r.date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))}</td>
                        <td>${isNaN(r.outdoor) ? '––' : `${r.outdoor.toFixed(1)}°`}</td>
                        <td>${isNaN(r.energyIn) ? '––' : r.energyIn.toFixed(1)}</td>
                        <td>${isNaN(r.energyOut) ? '––' : r.energyOut.toFixed(1)}</td>
                        <td>${r.cop ? r.cop.toFixed(2) : '––'}</td>
                    </tr>`).join('')}
                </tbody>
            </table>` : '<p class="empty">No readings in the last 14 days.</p>'}
        </section>`;

        viewLoading.classList.add('hidden');
        viewPerformance.classList.remove('hidden');
    } catch (e) {
        viewLoading.classList.add('hidden');
        toast(e.message, 'error');
        showDashboard();
    }
}

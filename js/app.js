import { OctopusClient } from './octopus.js';

let client = null;
let currentConfig = null;
let liveRefreshInterval = null;

const viewLoading = document.getElementById('loading-view');
const viewSetup = document.getElementById('setup-view');
const viewDashboard = document.getElementById('dashboard-view');
const viewEditZone = document.getElementById('edit-zone-view');
const viewFlowTemp = document.getElementById('flow-temp-view');
const viewZoneOverride = document.getElementById('zone-override-view');
const viewPerformance = document.getElementById('performance-view');
const logoutBtn = document.getElementById('logout-btn');
const setupError = document.getElementById('setup-error');

export function init() {
    const creds = loadCredentials();
    if (creds) {
        client = new OctopusClient(creds.apiKey, creds.account, creds.euid, creds.propertyId);
        showDashboard();
    } else {
        showSetup();
    }

    document.getElementById('setup-form').addEventListener('submit', handleSetup);
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
    showSetup();
}

function hideAllViews() {
    stopLiveRefresh();
    viewLoading.classList.add('hidden');
    viewSetup.classList.add('hidden');
    viewDashboard.classList.add('hidden');
    viewEditZone.classList.add('hidden');
    if (viewFlowTemp) viewFlowTemp.classList.add('hidden');
    if (viewZoneOverride) viewZoneOverride.classList.add('hidden');
    if (viewPerformance) viewPerformance.classList.add('hidden');
    logoutBtn.classList.add('hidden');
}

function showSetup() {
    hideAllViews();
    document.getElementById('setup-form').classList.remove('hidden');
    document.getElementById('device-selection').classList.add('hidden');
    viewSetup.classList.remove('hidden');
}

export async function showDashboard() {
    hideAllViews();
    viewLoading.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');

    try {
        if (!client.token) {
            await client.authenticate();
        }
        currentConfig = await client.getConfiguration();
        // Fetch live performance concurrently, don't let it block the dashboard
        let livePerf = null;
        try { livePerf = await client.getLivePerformance(); } catch (e) { console.warn('Live perf unavailable:', e.message); }
        renderDashboard(currentConfig, livePerf);
        startLiveRefresh();
        viewLoading.classList.add('hidden');
        viewDashboard.classList.remove('hidden');
    } catch (err) {
        console.error(err);
        alert("Failed to load dashboard: " + err.message);
        if (err.message.includes("token") || err.message.includes("401")) {
            logout();
        } else {
            viewLoading.innerText = "Error: " + err.message;
        }
    }
}

async function handleSetup(e) {
    e.preventDefault();
    const apiKey = document.getElementById('api-key').value.trim();

    setupError.classList.add('hidden');
    const setupBtn = document.getElementById('setup-btn');
    setupBtn.textContent = 'Connecting...';
    setupBtn.disabled = true;

    try {
        const tempClient = new OctopusClient(apiKey, '', '');
        await tempClient.authenticate();

        setupBtn.textContent = 'Discovering devices...';
        const devices = await tempClient.discoverDevices();

        if (devices.length === 0) {
            throw new Error("No heat pumps found on your account.");
        } else if (devices.length === 1) {
            finishSetup(apiKey, devices[0].account, devices[0].euid, devices[0].propertyId, tempClient);
        } else {
            const deviceSelector = document.getElementById('device-selector');
            deviceSelector.innerHTML = devices.map(d =>
                `<option value='${JSON.stringify(d)}'>Account ${d.account} - Device ${d.euid}</option>`
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
        setupError.textContent = "Failed to load heat pump data: " + err.message;
        setupError.classList.remove('hidden');
    }
}

// --- Dashboard Rendering ---

function renderLivePerformance(livePerf) {
    if (!livePerf) return '';

    const cop = livePerf.coefficientOfPerformance ? parseFloat(livePerf.coefficientOfPerformance).toFixed(2) : '-';
    const pIn = livePerf.powerInput?.value ? parseFloat(livePerf.powerInput.value).toFixed(2) + ' kW' : '-';
    const hOut = livePerf.heatOutput?.value ? parseFloat(livePerf.heatOutput.value).toFixed(2) + ' kW' : '-';
    const outT = livePerf.outdoorTemperature?.value != null ? parseFloat(livePerf.outdoorTemperature.value).toFixed(1) + '°C' : '-';
    const age = livePerf.readAt ? Math.round((Date.now() - new Date(livePerf.readAt)) / 60000) : null;
    const ageStr = age !== null ? (age < 2 ? 'Just now' : `${age}m ago`) : '';

    return `
        <div style="background:#fff;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,.05);padding:1.25rem 1.75rem;margin-bottom:2rem;">
            <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.9rem;">
                <span style="font-size:1rem;font-weight:600;color:#2d3748;">⚡ Live</span>
                ${ageStr ? `<span style="font-size:.75rem;color:#a0aec0;">${ageStr}</span>` : ''}
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:1rem;">
                <div class="live-stat">
                    <div class="live-stat-label">COP</div>
                    <div class="live-stat-value">${cop}</div>
                </div>
                <div class="live-stat">
                    <div class="live-stat-label">Power In</div>
                    <div class="live-stat-value">${pIn}</div>
                </div>
                <div class="live-stat">
                    <div class="live-stat-label">Heat Out</div>
                    <div class="live-stat-value">${hOut}</div>
                </div>
                <div class="live-stat">
                    <div class="live-stat-label">Outdoor Temp</div>
                    <div class="live-stat-value">${outT}</div>
                </div>
            </div>
        </div>`;
}

function startLiveRefresh() {
    stopLiveRefresh();
    liveRefreshInterval = setInterval(updateLivePerformance, 5000);
}

function stopLiveRefresh() {
    if (liveRefreshInterval) {
        clearInterval(liveRefreshInterval);
        liveRefreshInterval = null;
    }
}

async function updateLivePerformance() {
    if (!client || viewDashboard.classList.contains('hidden')) return; // Only if visible

    try {
        const livePerf = await client.getLivePerformance();
        const container = document.getElementById('live-performance-container');
        if (container) {
            container.innerHTML = renderLivePerformance(livePerf);
        }
    } catch (e) {
        console.warn('Live perf refresh failed:', e.message);
    }
}

function renderDashboard(config, livePerf) {
    const hp = config.heatPump || {};
    const c = config.controller || {};
    const p = config.performance || {};

    // safe getters
    const flowTemp = hp.heatingFlowTemperature?.currentTemperature?.value != null ? hp.heatingFlowTemperature.currentTemperature.value : '-';

    const wComp = hp.weatherCompensation || {};
    let wCompHtml = wComp.enabled ? '<span class="badge">Enabled</span>' : 'Disabled';
    if (wComp.enabled && wComp.currentRange) {
        wCompHtml += ` <span style="font-size:0.85rem;color:#718096;">(${wComp.currentRange.minimum?.value || '-'} - ${wComp.currentRange.maximum?.value || '-'}°C)</span>`;
    }

    let flowTempHtml = `<strong>Fixed Flow Temp:</strong> ${flowTemp}°C`;
    if (wComp.enabled) {
        flowTempHtml += ` <span style="font-size:0.8rem;color:#718096;">(Inactive)</span>`;
    } else {
        flowTempHtml += ` <span style="font-size:0.8rem;color:#38a169;">(Active)</span>`;
    }
    flowTempHtml += ` <a href="javascript:void(0)" onclick="app.showFlowTempEditor()" style="margin-left:.25rem;color:#4299e1;">[Configure Flow]</a>`;

    const fmtUnit = (u) => u === 'KILOWATT_HOUR' ? 'kWh' : (u || '');

    let html = `<div id="live-performance-container">${renderLivePerformance(livePerf)}</div>`;

    html += `
        <h2 style="margin-bottom:1.5rem;font-size:1.3rem;">
          System Overview
          <div style="font-size:.85rem;font-weight:400;color:#718096;margin-top:.5rem;">
            ${c.connected ? '<span class="connected">● Connected</span>' : '<span class="disconnected">● Disconnected</span>'}
            &nbsp;·&nbsp; ${hp.model || 'Unknown Model'} (SN: ${hp.serialNumber || 'Unknown'})
          </div>
        </h2>`;

    html += `
        <div class="grid-2" style="margin-bottom: 2rem;">
            <div class="card">
                <div class="card-title">Controller & Hardware</div>
                <div style="font-size: .95rem; line-height: 1.8; color: #4a5568;">
                    <strong>State:</strong> ${c.state?.join(', ') || 'Unknown'}<br/>
                    <strong>Smart Control:</strong> <a href="javascript:void(0)" onclick="app.setupSmartControl()" style="margin-left:.25rem;color:#4299e1;">[Setup]</a><br/>
                    <strong>HW Version:</strong> ${hp.hardwareVersion || 'Unknown'}<br/>
                    <strong>FW (ESP32):</strong> ${c.firmwareConfiguration?.esp32 || 'Unknown'}<br/>
                    <strong>FW (EFR32):</strong> ${c.firmwareConfiguration?.efr32 || 'Unknown'}<br/>
                    <strong>EUI:</strong> ${c.firmwareConfiguration?.eui || 'Unknown'}<br/>
                    <strong>Password:</strong> <code>${c.accessPointPassword || '***'}</code><br/>
                    <strong>Faults:</strong> ${hp.faultCodes?.length ? hp.faultCodes.join(', ') : 'None'}<br/>
                    <strong>Quieter Mode:</strong> ${hp.quieterModeEnabled ? 'Yes' : 'No'} <a href="javascript:void(0)" onclick="app.toggleQuieterMode(${!hp.quieterModeEnabled})" style="margin-left:.25rem;color:#4299e1;">[Toggle]</a><br/>
                    <strong>Last Reset:</strong> ${c.lastReset ? new Date(c.lastReset).toLocaleString() : 'Unknown'}
                </div>
            </div>
            
            <div class="card">
                <div class="card-title" style="display:flex; align-items:center;">
                    Heating & Performance
                    <a href="javascript:void(0)" onclick="app.showPerformanceHistory()" style="margin-left:auto;font-size:0.85rem;color:#4299e1;font-weight:400;">[Daily History]</a>
                </div>
                <div style="font-size: .95rem; line-height: 1.8; color: #4a5568;">
                    ${flowTempHtml}<br/>
                    <strong>Hot Water Limits:</strong> ${hp.minWaterSetpoint || '-'}°C - ${hp.maxWaterSetpoint || '-'}°C<br/>
                    <strong>Weather Comp:</strong> ${wCompHtml}<br/>
                    <hr style="margin: .5rem 0; border: 0; border-top: 1px solid #e2e8f0;">
                    <strong>SCOP:</strong> ${p?.seasonalCoefficientOfPerformance ? parseFloat(p.seasonalCoefficientOfPerformance).toFixed(2) : 'N/A'}<br/>
                    <strong>Heat Output:</strong> ${p?.heatOutput?.value ? parseFloat(p.heatOutput.value).toFixed(1) : 0} ${fmtUnit(p?.heatOutput?.unit)}<br/>
                    <strong>Energy Input:</strong> ${p?.energyInput?.value ? parseFloat(p.energyInput.value).toFixed(1) : 0} ${fmtUnit(p?.energyInput?.unit)}<br/>
                    <strong>Read At:</strong> ${p?.readAt ? new Date(p.readAt).toLocaleString() : 'Unknown'}
                </div>
            </div>
        </div>

        <h2 style="margin-bottom:1.5rem;font-size:1.3rem;">Heat Pump Zones</h2>
        <div class="grid-2">
    `;

    config.zones.forEach(container => {
        const zone = container.configuration;
        // Hide disabled zones
        if (!zone.enabled) return;

        const typeBadge = getZoneTypeBadge(zone.zoneType);
        const heatDemandBadge = zone.heatDemand ? '<span class="badge" style="background:#e53e3e;color:white;">🔥 Heat Demand</span>' : '';
        const callForHeatBadge = zone.callForHeat ? '<span class="badge" style="background:#dd6b20;color:white;">Call for Heat</span>' : '';
        const emergencyBadge = zone.emergency ? '<span class="badge" style="background:#e53e3e;color:white;">Emergency</span>' : '';

        const isSentinel = (t) => t == null || parseFloat(t) < -20;
        const sensors = (zone.sensors || []).filter(s =>
            !(s.telemetry && isSentinel(s.telemetry.temperatureInCelsius))
        );
        let sensorsHtml = '';
        if (sensors.length > 0) {
            sensorsHtml = `
                <div style="margin-top: 1.25rem;">
                    <div style="font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#a0aec0;margin-bottom:.5rem;">Sensors</div>
                    ${sensors.map(s => {
                const isPrimary = (zone.primarySensor === s.code);
                const isOffline = s.connectivity && !s.connectivity.online;
                const badTemp = s.telemetry && isSentinel(s.telemetry.temperatureInCelsius);
                const dimmed = isOffline || badTemp;
                const opacity = dimmed ? 'opacity:.45;' : '';

                let metaChips = [];
                if (s.firmwareVersion && s.firmwareVersion !== '0D') metaChips.push(`<span class="chip" style="background:#f7fafc;color:#718096;">FW ${s.firmwareVersion}</span>`);

                let telemetryLine = '';
                if (s.telemetry) {
                    let parts = [];
                    if (!isSentinel(s.telemetry.temperatureInCelsius)) parts.push(`${parseFloat(s.telemetry.temperatureInCelsius).toFixed(1)}°C`);
                    if (s.telemetry.humidityPercentage) parts.push(`${s.telemetry.humidityPercentage}% RH`);
                    if (s.telemetry.rssi != null) parts.push(`📶 ${s.telemetry.rssi} dBm`);
                    if (s.telemetry.voltage) parts.push(`${s.telemetry.voltage}V`);
                    if (parts.length) telemetryLine = `<span style="color:#718096;">${parts.join(' · ')}</span>`;
                }
                const connChip = s.connectivity
                    ? (s.connectivity.online
                        ? `<span class="chip" style="background:#f0fff4;color:#276749;">● Online</span>`
                        : `<span class="chip" style="background:#fff5f5;color:#c53030;">● Offline</span>`)
                    : '';

                const primaryStar = isPrimary ? `<span title="Primary sensor" style="color:#e05c35;margin-right:.2rem;">★</span>` : `<span style="color:transparent;margin-right:.2rem;">★</span>`;

                const renameBtn = `<button class="chip-btn" onclick="app.renameSensor('${s.code}', '${s.displayName || ''}')">Rename</button>`;
                const setPrimaryBtn = !isPrimary ? `<button class="chip-btn" onclick="app.setPrimarySensor('${zone.code}', '${s.code}')">Set Primary</button>` : '';

                return `<div class="sensor-row" style="${opacity}">
                            <div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;">
                                ${primaryStar}<span style="font-size:.85rem;font-weight:500;color:#2d3748;">${s.displayName || s.code}</span>
                                <span style="font-size:.75rem;color:#a0aec0;">${s.type}</span>
                                ${metaChips.join('')}
                                ${connChip}
                            </div>
                            ${telemetryLine ? `<div style="font-size:.8rem;color:#718096;padding-left:1.4rem;margin-top:.15rem;">${telemetryLine}</div>` : ''}
                            <div style="padding-left:1.4rem;margin-top:.25rem;display:flex;gap:.35rem;flex-wrap:wrap;">${renameBtn}${setPrimaryBtn}</div>
                        </div>`;
            }).join('')}
                </div>
            `;
        }

        let schedulesHtml = '';
        if (zone.schedules && zone.schedules.length > 0) {
            schedulesHtml = `
                <table>
                  <thead><tr><th>Days</th><th>Slots</th></tr></thead>
                  <tbody>
                    ${zone.schedules.map(s => `
                        <tr>
                            <td style="white-space:nowrap;">${fmtDays(s.days)}</td>
                            <td>
                                ${s.settings.map(slot => `
                                    <div style="margin:.1rem 0;">
                                        <code style="font-size:.8rem;">${slot.time}</code>
                                        ${fmtAction(slot.action, slot.setpointInCelsius)}
                                    </div>
                                `).join('')}
                            </td>
                        </tr>
                    `).join('')}
                  </tbody>
                </table>
            `;
        } else {
            schedulesHtml = '<span class="no-schedules">No schedules configured.</span>';
        }

        let prevOpHtml = '';
        if (zone.previousOperation) {
            const prevAction = zone.previousOperation.action || '-';
            prevOpHtml = `<br/>Previous: <strong>${zone.previousOperation.mode || 'None'}</strong> &nbsp;·&nbsp; Action: <strong>${prevAction}</strong>`;
        }

        html += `
            <div class="card">
                <div class="card-title" style="flex-wrap: wrap; gap: .5rem;">
                    ${zone.displayName}
                    <button class="btn btn-secondary btn-sm" style="padding:.1rem .5rem;" onclick="app.renameZone('${zone.code}', '${zone.displayName || ''}')">Rename</button>
                    ${typeBadge}
                    ${heatDemandBadge}
                    ${callForHeatBadge}
                    ${emergencyBadge}
                    <button class="btn btn-sm btn-secondary" style="margin-left:auto;padding:.1rem .5rem;" onclick="app.showZoneOverride('${zone.code}')">Override</button>
                </div>
                <div class="zone-meta">
                    Mode: <strong>${zone.currentOperation?.mode || 'None'}</strong> <a href="javascript:void(0)" onclick="app.changeZoneMode('${zone.code}', '${zone.currentOperation?.mode || 'AUTO'}')" style="margin-left:.25rem;color:#4299e1;">[Change]</a>
                    ${zone.currentOperation?.setpointInCelsius ? `&nbsp;·&nbsp; Setpoint: <strong>${zone.currentOperation.setpointInCelsius.toFixed(1)}°C</strong>` : ''}
                    ${zone.currentOperation?.action ? `&nbsp;·&nbsp; Action: <strong>${zone.currentOperation.action}</strong>` : ''}
                    ${prevOpHtml}
                    ${zone.telemetry ? `<hr style="margin:.75rem 0 .5rem 0;border:0;border-top:1px dashed #cbd5e0;"/>
                    <div style="display:flex;flex-wrap:wrap;gap:.35rem;align-items:center;margin-top:.25rem;">
                        ${zone.telemetry.mode ? `<span class="chip">${zone.telemetry.mode}</span>` : ''}
                        ${(zone.telemetry.setpointInCelsius != null && zone.telemetry.setpointInCelsius > -200) ? `<span class="chip" style="background:#ebf8ff;color:#2c5282;">🌡 ${parseFloat(zone.telemetry.setpointInCelsius).toFixed(1)}°C</span>` : ''}
                        ${zone.telemetry.heatDemand ? `<span class="chip" style="background:#fff5f0;color:#c05621;">🔥 Heat Demand</span>` : `<span class="chip" style="background:#f7fafc;color:#a0aec0;">No Heat Demand</span>`}
                        ${zone.telemetry.relaySwitchedOn ? `<span class="chip" style="background:#fff5f5;color:#c53030;">⚡ Relay ON</span>` : `<span class="chip" style="background:#f7fafc;color:#a0aec0;">Relay OFF</span>`}
                    </div>` : ''}
                </div>
                ${sensorsHtml}
                <div style="margin-top:1rem;">
                    ${schedulesHtml}
                </div>
                <div style="margin-top:1rem;">
                    <button class="btn btn-primary btn-sm" onclick="app.showEditZone('${zone.code}')">Edit Schedule</button>
                </div>
            </div>
        `;
    });

    html += '</div>';
    viewDashboard.innerHTML = html;
}

function getZoneTypeBadge(type) {
    if (type === 'HEAT') return '<span class="badge">Heating</span>';
    if (type === 'WATER') return '<span class="badge water">Hot Water</span>';
    if (type === 'AUXILIARY') return '<span class="badge aux">Auxiliary</span>';
    if (type === 'WIRED_THERMOSTAT') return '<span class="badge aux">Wired Thermostat</span>';
    if (type === 'DIVERTER_VALVE') return '<span class="badge aux">Diverter Valve</span>';
    return '';
}

function fmtAction(action, setpoint) {
    if (action === "OFF") return `<span style="color:#742a2a">▼ Off</span>`;
    return `<span style="color:#2b6cb0">🌡 ${setpoint ? Number(setpoint).toFixed(1) : action}°C</span>`;
}

// --- Edit Zone Rendering ---

export function showEditZone(zoneCode) {
    const zoneContainer = currentConfig.zones.find(z => z.configuration.code === zoneCode);
    if (!zoneContainer) return;
    const zone = zoneContainer.configuration;

    hideAllViews();
    logoutBtn.classList.remove('hidden');
    viewEditZone.classList.remove('hidden');

    renderEditZoneForm(zone);
}

function renderEditZoneForm(zone) {
    // We'll attach the zone object to the DOM or keep a reference to render the form
    // For simplicity, I'll generate the full HTML string again.

    let html = `
        <div style="margin-bottom:1rem;">
          <a href="#" onclick="app.showDashboard(); return false;" class="btn btn-secondary btn-sm">← Back</a>
        </div>
        <div id="edit-msg" class="alert hidden"></div>
        <div class="card">
            <div class="card-title">
                ${zone.displayName}
                ${getZoneTypeBadge(zone.zoneType)}
            </div>
            <p style="font-size:.85rem;color:#718096;margin-bottom:1.25rem;">
                Edit the weekly schedule for this zone.
            </p>
            <form id="scheduleForm" onsubmit="app.handleSaveSchedule(event, '${zone.code}', '${zone.zoneType}')">
                <div id="groups">
    `;

    (zone.schedules || []).forEach((sched, gi) => {
        html += renderGroup(gi, sched);
    });

    html += `
                </div>
                <div style="margin-bottom:1.5rem;">
                    <button type="button" class="btn btn-secondary" onclick="app.addGroup()">+ Add Day Group</button>
                </div>
                <div class="actions">
                    <button type="submit" class="btn btn-primary">Save Schedule</button>
                    <a href="#" onclick="app.showDashboard(); return false;" class="btn btn-secondary">Cancel</a>
                </div>
            </form>
        </div>
    `;

    viewEditZone.innerHTML = html;
}

// --- Helpers for Bitmasks ---

const dayNames = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const dayShort = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtDays(mask) {
    const active = [];
    for (let i = 0; i < 7; i++) {
        if (mask[i] === '1') active.push(dayShort[i]);
    }
    return active.length > 0 ? active.join(', ') : mask;
}

// --- Exporting for UI interaction ---
// The following functions need to be available globally or via the app object for the inline onclick handlers

export function handleSaveSchedule(e, zoneCode, zoneType) {
    e.preventDefault();
    const form = e.target;
    const msg = document.getElementById('edit-msg');

    // Parse form data manually
    // We can't use FormData easily because of the dynamic structure, so we'll walk the DOM
    const groups = [];
    document.querySelectorAll('#groups .group-block').forEach(gBlock => {
        // Days
        const checkedDays = [];
        gBlock.querySelectorAll('.days-check input:checked').forEach(cb => {
            checkedDays.push(cb.value);
        });

        let mask = "";
        for (const d of dayNames) {
            mask += checkedDays.includes(d) ? "1" : "0";
        }

        if (mask === "0000000") return; // Skip empty day groups

        // Slots
        const settings = [];
        gBlock.querySelectorAll('.slots-body tr').forEach(row => {
            const time = row.querySelector('input[type=text]').value;
            const action = row.querySelector('select').value;
            const setpoint = row.querySelector('input[type=number]').value;

            if (!time) return;

            const slot = { time, action };
            if (action === "HEAT" && setpoint) {
                slot.action = "SET_TEMPERATURE";
                slot.setpointInCelsius = parseFloat(setpoint);
            } else if (action === "HEAT" && !setpoint) {
                // Skip invalid heat slot
                return;
            } else {
                slot.action = "TURN_OFF";
                slot.setpointInCelsius = null;
            }
            settings.push(slot);
        });

        if (settings.length > 0) {
            groups.push({ days: mask, settings });
        }
    });

    msg.className = 'alert alert-success';
    msg.textContent = 'Saving...';
    msg.classList.remove('hidden');

    client.setZoneSchedules(zoneCode, zoneType, groups).then(() => {
        msg.textContent = 'Schedule saved successfully!';
    }).catch(err => {
        msg.className = 'alert alert-error';
        msg.textContent = err.message;
    });
}

function renderGroup(gi, sched) {
    const mask = sched ? sched.days : "0000000";
    const settings = sched ? sched.settings : [];

    let html = `
    <div class="group-block" style="border:1px solid #e2e8f0;border-radius:8px;padding:1rem;margin-bottom:1rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem;">
            <strong>Day Group</strong>
            <button type="button" class="btn btn-danger btn-sm" onclick="app.removeGroup(this)">Remove Group</button>
        </div>
        <div style="margin-bottom:.75rem;">
            <label style="font-size:.85rem;font-weight:600;display:block;margin-bottom:.4rem;">Days</label>
            <div class="days-check">
    `;

    dayNames.forEach((d, i) => {
        const checked = mask[i] === '1' ? 'checked' : '';
        html += `<label><input type="checkbox" value="${d}" ${checked}> ${d}</label>`;
    });

    html += `
            </div>
        </div>
        <div>
            <label style="font-size:.85rem;font-weight:600;display:block;margin-bottom:.4rem;">Time Slots</label>
            <table style="width:100%;margin-bottom:.5rem;">
                <thead><tr><th style="width:110px;">Time</th><th style="width:160px;">Action</th><th style="width:100px;">Temp (°C)</th><th style="width:60px;"></th></tr></thead>
                <tbody class="slots-body">
    `;

    settings.forEach(slot => {
        html += renderSlotRow(slot);
    });

    html += `
                </tbody>
            </table>
            <button type="button" class="btn btn-secondary btn-sm" onclick="app.addSlot(this)">+ Add Slot</button>
        </div>
    </div>`;
    return html;
}

function renderSlotRow(slot) {
    const isHeat = slot && slot.action !== 'OFF';
    const tempVal = (slot && slot.setpointInCelsius != null) ? slot.setpointInCelsius : '';
    const timeVal = slot ? slot.time : '';
    const styleHidden = isHeat ? '' : 'visibility:hidden';

    return `
    <tr class="slot-row">
        <td><input type="text" value="${timeVal}" placeholder="06:00" pattern="[0-2][0-9]:[0-5][0-9]" required></td>
        <td>
            <select onchange="app.toggleSetpoint(this)">
                <option value="HEAT" ${isHeat ? 'selected' : ''}>Heat to temp</option>
                <option value="OFF" ${!isHeat ? 'selected' : ''}>Off</option>
            </select>
        </td>
        <td><input class="setpoint-field" type="number" value="${tempVal}" min="5" max="80" step="0.5" placeholder="°C" style="${styleHidden}"></td>
        <td><button type="button" class="btn btn-danger btn-sm" onclick="app.removeSlot(this)">✕</button></td>
    </tr>`;
}

// UI helper functions attached to 'app' object
export function removeGroup(btn) {
    const groups = document.querySelectorAll('#groups .group-block');
    if (groups.length <= 1) {
        alert("You must have at least one schedule group. To clear completely, delete all the time slots.");
        return;
    }
    btn.closest('.group-block').remove();
}

export function removeSlot(btn) {
    btn.closest('tr').remove();
}

export function addGroup() {
    document.getElementById('groups').insertAdjacentHTML('beforeend', renderGroup(0, null));
}

export function addSlot(btn) {
    const tbody = btn.previousElementSibling.querySelector('.slots-body');
    tbody.insertAdjacentHTML('beforeend', renderSlotRow(null));
}

export function toggleSetpoint(sel) {
    const row = sel.closest('tr');
    const sp = row.querySelector('input[type=number]');
    sp.style.visibility = sel.value === 'OFF' ? 'hidden' : 'visible';
    if (sel.value === 'OFF') sp.value = '';
}

export async function toggleQuieterMode(enabled) {
    if (!confirm(`Turn quieter mode ${enabled ? 'ON' : 'OFF'}?`)) return;
    try {
        await client.setQuieterMode(enabled);
        await showDashboard(); // refresh
    } catch (e) {
        alert("Failed to toggle quieter mode: " + e.message);
    }
}

export async function renameZone(zoneCode, currentName) {
    const val = prompt(`Enter new name for zone ${zoneCode}:`, currentName || "");
    if (val === null || val === currentName) return;
    try {
        await client.updateZoneDisplayName(zoneCode, val);
        await showDashboard();
    } catch (e) {
        alert("Failed to rename zone: " + e.message);
    }
}

export async function setupSmartControl() {
    if (!confirm("Are you sure you want to setup smart control for this heat pump?")) return;
    try {
        await client.setupSmartControl();
        alert("Smart control setup initiated!");
        await showDashboard();
    } catch (e) {
        alert("Failed to setup smart control: " + e.message);
    }
}

export async function renameSensor(sensorCode, currentName) {
    const val = prompt(`Enter new name for sensor ${sensorCode}:`, currentName || "");
    if (val === null || val === currentName) return;
    try {
        await client.updateSensorDisplayName(sensorCode, val);
        await showDashboard();
    } catch (e) {
        alert("Failed to rename sensor: " + e.message);
    }
}

export async function setPrimarySensor(zoneCode, sensorCode) {
    if (!confirm(`Make sensor ${sensorCode} the primary sensor for this zone?`)) return;
    try {
        await client.setZonePrimarySensor(zoneCode, sensorCode);
        await showDashboard();
    } catch (e) {
        alert("Failed to set primary sensor: " + e.message);
    }
}

// --- Specialized View Forms ---

export function showFlowTempEditor() {
    const hp = currentConfig.heatPump;
    const wComp = hp.weatherCompensation || {};
    const flowTemp = hp.heatingFlowTemperature?.currentTemperature?.value || 50;

    let html = `
        <div class="card" style="max-width:600px;margin:0 auto;">
            <div class="card-title">Flow Temperature Settings</div>
            <form id="flow-temp-form" onsubmit="event.preventDefault(); app.submitFlowTempEditor(this)">
                <div style="margin-bottom:1rem;">
                    <label style="display:block;margin-bottom:.5rem;">
                        <input type="checkbox" name="useWc" onchange="app.toggleWcFields(this.checked)" ${wComp.enabled ? 'checked' : ''}> Use Weather Compensation
                    </label>
                </div>
                
                <div id="ft-fixed" style="${wComp.enabled ? 'display:none;' : ''}">
                    <label style="display:block;margin-bottom:.5rem;">Fixed Flow Temperature (°C)</label>
                    <input type="number" name="flowTemp" value="${flowTemp}" step="1">
                </div>
                
                <div id="ft-wc" style="${wComp.enabled ? '' : 'display:none;'}">
                    <label style="display:block;margin-bottom:.25rem;">Weather Comp Min Temp (°C) <span style="font-size:0.75rem;color:#718096;">(Allowed: ${wComp.allowableMinimumTemperatureRange?.minimum?.value || '-'}-${wComp.allowableMinimumTemperatureRange?.maximum?.value || '-'})</span></label>
                    <input type="number" name="wcMin" value="${wComp.currentRange?.minimum?.value || 25}" min="${wComp.allowableMinimumTemperatureRange?.minimum?.value || ''}" max="${wComp.allowableMinimumTemperatureRange?.maximum?.value || ''}" step="1">
                    
                    <label style="display:block;margin-top:1rem;margin-bottom:.25rem;">Weather Comp Max Temp (°C) <span style="font-size:0.75rem;color:#718096;">(Allowed: ${wComp.allowableMaximumTemperatureRange?.minimum?.value || '-'}-${wComp.allowableMaximumTemperatureRange?.maximum?.value || '-'})</span></label>
                    <input type="number" name="wcMax" value="${wComp.currentRange?.maximum?.value || 50}" min="${wComp.allowableMaximumTemperatureRange?.minimum?.value || ''}" max="${wComp.allowableMaximumTemperatureRange?.maximum?.value || ''}" step="1">
                </div>
                
                <div style="margin-top:1.5rem;">
                    <button type="submit" class="btn btn-primary">Save Settings</button>
                    <button type="button" class="btn btn-secondary" onclick="app.showDashboard()">Cancel</button>
                </div>
            </form>
        </div>
    `;
    viewFlowTemp.innerHTML = html;

    document.getElementById('dashboard-view').classList.add('hidden');
    document.getElementById('edit-zone-view').classList.add('hidden');
    if (viewZoneOverride) viewZoneOverride.classList.add('hidden');
    viewFlowTemp.classList.remove('hidden');
}

export function toggleWcFields(checked) {
    document.getElementById('ft-fixed').style.display = checked ? 'none' : 'block';
    document.getElementById('ft-wc').style.display = checked ? 'block' : 'none';
}

export async function submitFlowTempEditor(form) {
    const useWc = form.useWc.checked;
    const flowTemp = form.flowTemp.value;
    const wcMin = form.wcMin.value;
    const wcMax = form.wcMax.value;

    try {
        await client.updateFlowTemperatureConfiguration(useWc, flowTemp, wcMin, wcMax);
        alert("Flow Temperature Configuration Updated!");
        await showDashboard();
    } catch (e) {
        alert("Failed to update: " + e.message);
    }
}

export function showZoneOverride(zoneCode) {
    const zoneContainer = currentConfig.zones.find(z => z.configuration.code === zoneCode);
    if (!zoneContainer) return;
    const z = zoneContainer.configuration;

    let html = `
        <div class="card" style="max-width:600px;margin:0 auto;">
            <div class="card-title">Quick Override - ${z.displayName}</div>
            <form onsubmit="event.preventDefault(); app.submitZoneOverride(this, '${zoneCode}')">
                <div style="margin-bottom:1rem;">
                    <label style="display:block;margin-bottom:.5rem;">Mode</label>
                    <select name="mode" style="width:100%" onchange="app.toggleOverrideAction(this.value)">
                        <option value="">Maintain Current Mode</option>
                        <option value="AUTO">AUTO (Follow Schedule)</option>
                        <option value="ON">ON</option>
                        <option value="OFF">OFF</option>
                        <option value="BOOST">BOOST</option>
                    </select>
                </div>
                <div id="ov-action-box" style="margin-bottom:1rem; display:none;">
                    <label style="display:block;margin-bottom:.5rem;">Action</label>
                    <select name="action" style="width:100%" onchange="app.toggleOverrideSetpoint(this.value)">
                        <option value="SET_TEMPERATURE">Set Temperature</option>
                        <option value="TURN_ON">Turn On (Ignore Setpoint)</option>
                        <option value="TURN_OFF">Turn Off</option>
                    </select>
                </div>
                <div id="ov-setpoint" style="margin-bottom:1rem; display:none;">
                    <label style="display:block;margin-bottom:.5rem;">Target Setpoint (°C)</label>
                    <input type="number" name="setpoint" value="21" step="0.5">
                </div>
                <div style="margin-bottom:1rem;">
                    <label style="display:block;margin-bottom:.5rem;">End Time (Leave empty for permanent override)</label>
                    <input type="datetime-local" name="endAt">
                </div>
                <div style="margin-top:1.5rem;">
                    <button type="submit" class="btn btn-primary">Apply Override</button>
                    <button type="button" class="btn btn-secondary" onclick="app.showDashboard()">Cancel</button>
                </div>
            </form>
        </div>
    `;
    viewZoneOverride.innerHTML = html;

    document.getElementById('dashboard-view').classList.add('hidden');
    document.getElementById('edit-zone-view').classList.add('hidden');
    if (viewFlowTemp) viewFlowTemp.classList.add('hidden');
    viewZoneOverride.classList.remove('hidden');
}

export function toggleOverrideAction(mode) {
    const box = document.getElementById('ov-action-box');
    const sp = document.getElementById('ov-setpoint');
    if (mode === 'OFF' || mode === 'AUTO') {
        box.style.display = 'none';
        sp.style.display = 'none';
    } else {
        box.style.display = 'block';
        toggleOverrideSetpoint(document.querySelector('#ov-action-box select').value);
    }
}

export function toggleOverrideSetpoint(action) {
    document.getElementById('ov-setpoint').style.display = action === 'SET_TEMPERATURE' ? 'block' : 'none';
}

export async function changeZoneMode(zoneCode, currentMode) {
    const mode = prompt(`Enter new mode for zone ${zoneCode} (AUTO, ON, OFF, BOOST):`, currentMode || "AUTO");
    if (!mode) return;
    
    const validModes = ['AUTO', 'ON', 'OFF', 'BOOST'];
    const cleanMode = mode.toUpperCase().trim();
    
    if (!validModes.includes(cleanMode)) {
        alert("Invalid mode. Must be one of: AUTO, ON, OFF, BOOST");
        return;
    }
    
    if (cleanMode === currentMode) return;
    
    try {
        await client.setZoneMode(zoneCode, cleanMode, null, null, null);
        alert("Zone mode updated!");
        await showDashboard();
    } catch (e) {
        alert("Failed to change zone mode: " + e.message);
    }
}

export async function submitZoneOverride(form, zoneCode) {
    const mode = form.mode.value || null;

    // In GraphQL, ON, OFF, AUTO, BOOST are enums passed directly.
    let action = null;
    let setpoint = '';

    if (mode === 'ON' || mode === 'BOOST' || mode === null) {
        action = form.action.value;
        if (action === 'SET_TEMPERATURE') {
            setpoint = form.setpoint.value;
        }
    } else if (mode === 'OFF') {
        action = 'TURN_OFF';
    } else if (mode === 'AUTO') {
        action = null;
    }

    let endAt = form.endAt.value;
    if (endAt) {
        endAt = new Date(endAt).toISOString().split('.')[0] + 'Z';
    }

    try {
        await client.setZoneMode(zoneCode, mode, endAt, setpoint, action);
        alert("Override Applied!");
        await showDashboard();
    } catch (e) {
        alert("Failed to apply override: " + e.message);
    }
}

export async function showPerformanceHistory() {
    viewLoading.classList.remove('hidden');
    hideAllViews();
    viewLoading.classList.remove('hidden');

    try {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 14);

        const allData = await client.getPerformanceHistory(start.toISOString(), end.toISOString());
        const totalData = await client.getTimeRangedPerformance(start.toISOString(), end.toISOString());

        let totalHtml = '';
        if (totalData) {
            const outEVal = parseFloat(totalData.energyOutput?.value);
            const inVal = parseFloat(totalData.energyInput?.value);
            const cop = totalData.coefficientOfPerformance ? parseFloat(totalData.coefficientOfPerformance).toFixed(2) : '-';
            const elIn = !isNaN(inVal) ? inVal.toFixed(1) + ' kWh' : '-';
            const htOut = !isNaN(outEVal) ? outEVal.toFixed(1) + ' kWh' : '-';
            totalHtml = `
                <div style="margin-bottom: 2rem; background: #f7fafc; padding: 1rem; border-radius: 8px; border: 1px solid #e2e8f0;">
                    <h3 style="margin-bottom: .5rem; font-size: 1rem; color: #2d3748;">14-Day Totals</h3>
                    <div style="display:flex; gap: 2rem; font-size: .95rem; color: #4a5568;">
                        <div><strong>Energy In:</strong> ${elIn}</div>
                        <div><strong>Heat Out:</strong> ${htOut}</div>
                        <div><strong>Overall COP:</strong> ${cop}</div>
                    </div>
                </div>
            `;
        }

        let rows = '';
        if (allData && allData.length > 0) {
            // Sort so newest week is at the top
            const sorted = [...allData].sort((a, b) => new Date(b.startAt) - new Date(a.startAt));

            rows = sorted.map(d => {
                const outVal = parseFloat(d.outdoorTemperature?.value);
                const inVal = parseFloat(d.energyInput?.value);
                const outEVal = parseFloat(d.energyOutput?.value);
                const outT = !isNaN(outVal) ? outVal.toFixed(1) + '°C' : '-';
                const elIn = !isNaN(inVal) ? inVal.toFixed(1) + ' kWh' : '-';
                const htOut = !isNaN(outEVal) ? outEVal.toFixed(1) + ' kWh' : '-';
                let cop = '-';
                if (inVal > 0 && outEVal > 0) {
                    cop = (outEVal / inVal).toFixed(2);
                }
                const dateStr = new Date(d.startAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

                return `<tr>
                    <td style="padding:.5rem; border-bottom:1px solid #edf2f7;">${dateStr}</td>
                    <td style="padding:.5rem; border-bottom:1px solid #edf2f7;">${outT}</td>
                    <td style="padding:.5rem; border-bottom:1px solid #edf2f7;">${elIn}</td>
                    <td style="padding:.5rem; border-bottom:1px solid #edf2f7;">${htOut}</td>
                    <td style="padding:.5rem; border-bottom:1px solid #edf2f7;"><strong>${cop}</strong></td>
                </tr>`;
            }).join('');
        } else {
            rows = `<tr><td colspan="5" style="text-align:center; padding:1rem;">No history available for the last 14 days.</td></tr>`;
        }

        viewPerformance.innerHTML = `
            <div class="card" style="margin: 0 auto;">
                <div class="card-title">Daily Performance History</div>
                ${totalHtml}
                <div style="overflow-x: auto;">
                    <table style="width:100%; text-align:left; border-collapse: collapse;">
                        <thead>
                            <tr>
                                <th style="border-bottom:2px solid #e2e8f0; padding:.5rem;">Date</th>
                                <th style="border-bottom:2px solid #e2e8f0; padding:.5rem;">Avg Outdoor Temp</th>
                                <th style="border-bottom:2px solid #e2e8f0; padding:.5rem;">Energy In</th>
                                <th style="border-bottom:2px solid #e2e8f0; padding:.5rem;">Heat Out</th>
                                <th style="border-bottom:2px solid #e2e8f0; padding:.5rem;">COP</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                    </table>
                </div>
                <div style="margin-top:2rem;">
                    <button class="btn btn-primary" onclick="app.showDashboard()">Back to Dashboard</button>
                </div>
            </div>
        `;

        viewLoading.classList.add('hidden');
        viewPerformance.classList.remove('hidden');
        logoutBtn.classList.remove('hidden');
    } catch (e) {
        alert("Failed to load history: " + e.message);
        viewLoading.classList.add('hidden');
    }
}

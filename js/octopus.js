// Octopus Energy API Client

const API_URL = "https://api.octopus.energy/v1/graphql/";
const BACKEND_API_URL = "https://api.backend.octopus.energy/v1/graphql/";

export class OctopusClient {
    constructor(apiKey, account, euid, propertyId = null) {
        this.apiKey = apiKey;
        this.account = account;
        this.euid = euid;
        this.propertyId = propertyId;
        this.token = null;
    }

    async authenticate() {
        const query = `
            mutation ObtainToken($apiKey: String!) {
                obtainKrakenToken(input: { APIKey: $apiKey }) {
                    token
                }
            }`;
        
        const data = await this.gql(query, { apiKey: this.apiKey }, false);
        if (!data.obtainKrakenToken) {
            throw new Error("No token returned");
        }
        this.token = data.obtainKrakenToken.token;
        return this.token;
    }

    async discoverDevices() {
        const viewerQuery = `
            query ViewerQuery {
                viewer {
                    accounts {
                        number
                        ... on AccountType {
                            properties {
                                id
                                electricityMeterPoints {
                                    mpan
                                    meters {
                                        id
                                        serialNumber
                                    }
                                }
                            }
                        }
                    }
                }
            }`;
        
        const viewerData = await this.gql(viewerQuery, {}, true, false);
        const accounts = viewerData?.viewer?.accounts || [];
        
        const devices = [];
        for (const account of accounts) {
            const properties = account.properties || [];
            for (const property of properties) {
                const controllersQuery = `
                    query GetHeatPumps($accountNumber: String!, $propertyId: ID!) {
                        heatPumpControllersAtLocation(accountNumber: $accountNumber, propertyId: $propertyId) {
                            controller { euid }
                            location { propertyId }
                        }
                    }`;
                
                const data = await this.gql(controllersQuery, { 
                    accountNumber: account.number, 
                    propertyId: property.id 
                }, true, true);
                
                const controllers = data?.heatPumpControllersAtLocation || [];
                for (const ctrl of controllers) {
                    devices.push({ 
                        account: account.number, 
                        euid: ctrl.controller?.euid,
                        propertyId: ctrl.location?.propertyId || property.id
                    });
                }
            }
        }
        
        return devices;
    }

    async getConfiguration() {
        const query = `
            query GetConfig($accountNumber: String!, $euid: ID!) {
                heatPumpControllerConfiguration(accountNumber: $accountNumber, euid: $euid) {
                    controller {
                        accessPointPassword
                        connected
                        heatPumpTimezone
                        firmwareConfiguration {
                            efr32
                            esp32
                            eui
                        }
                        lastReset
                        state
                    }
                    heatPump {
                        faultCodes
                        hardwareVersion
                        hasHeatPumpCompatibleCylinder
                        heatingFlowTemperature {
                            currentTemperature { unit value }
                            allowableRange { maximum { unit value } minimum { unit value } }
                        }
                        latestCounterReset
                        maxWaterSetpoint
                        minWaterSetpoint
                        manifoldEnabled
                        model
                        serialNumber
                        quieterModeEnabled
                        weatherCompensation {
                            allowableMaximumTemperatureRange { maximum { unit value } minimum { unit value } }
                            allowableMinimumTemperatureRange { maximum { unit value } minimum { unit value } }
                            currentRange { maximum { unit value } minimum { unit value } }
                            enabled
                        }
                    }
                    zones {
                        configuration {
                            callForHeat
                            zoneType
                            sensors {
                                ... on ZigbeeSensorConfiguration { id boostEnabled code displayName firmwareVersion type }
                                ... on ADCSensorConfiguration { code displayName enabled type }
                            }
                            primarySensor
                            previousOperation { action mode setpointInCelsius }
                            emergency
                            enabled
                            heatDemand
                            displayName
                            currentOperation { end action setpointInCelsius mode }
                            code
                        }
                        schedules {
                            days
                            settings { action setpointInCelsius startTime zoneState }
                        }
                    }
                }
                heatPumpLifetimePerformance(accountNumber: $accountNumber, euid: $euid) {
                    seasonalCoefficientOfPerformance
                    heatOutput { unit value }
                    energyInput { unit value }
                    readAt
                }
                heatPumpControllerStatus(accountNumber: $accountNumber, euid: $euid) {
                    sensors {
                        code
                        connectivity { online retrievedAt }
                        telemetry { temperatureInCelsius humidityPercentage rssi voltage retrievedAt }
                    }
                    zones {
                        zone
                        telemetry { setpointInCelsius mode relaySwitchedOn heatDemand retrievedAt }
                    }
                }
            }`;

        const data = await this.gql(query, {
            accountNumber: this.account,
            euid: this.euid
        }, true, true);

        if (!data.heatPumpControllerConfiguration) {
            throw new Error("No configuration returned (check account number and EUID)");
        }

        const config = data.heatPumpControllerConfiguration;
        config.performance = data.heatPumpLifetimePerformance;
        const status = data.heatPumpControllerStatus;
        
        // Merge schedules and telemetry into configuration for easier consumption
        config.zones.forEach(z => {
            z.configuration.schedules = (z.schedules || []).map(s => this.toSchedule(s));
            
            if (status && status.zones) {
                const zStatus = status.zones.find(st => st.zone === z.configuration.code);
                if (zStatus) z.configuration.telemetry = zStatus.telemetry;
            }
            if (status && status.sensors && z.configuration.sensors) {
                z.configuration.sensors.forEach(s => {
                    const sStatus = status.sensors.find(st => st.code === s.code);
                    if (sStatus) {
                        s.connectivity = sStatus.connectivity;
                        s.telemetry = sStatus.telemetry;
                    }
                });
            }
        });

        return config;
    }

    async setZoneSchedules(zoneCode, zoneType, schedules) {
        const query = `
            mutation SetZoneSchedules($accountNumber: String!, $euid: ID!, $params: SetZoneSchedulesParameters!) {
                heatPumpSetZoneSchedules(
                    accountNumber: $accountNumber
                    euid: $euid
                    zoneScheduleParameters: $params
                ) {
                    transactionId
                }
            }`;

        // Transform schedules for mutation
        const mutationSchedules = schedules.map(s => {
            return {
                days: s.days,
                settings: s.settings.map(slot => {
                    let t = slot.time;
                    if (t.length === 5) t += ":00";
                    
                    let action = slot.action;
                    if (zoneType === "WATER" || zoneType === "HEAT") {
                        if (action === "TURN_OFF") action = "OFF";
                        else if (action === "TURN_ON") action = "ON";
                    }
                    const mSlot = {
                        time: t,
                        action
                    };
                    if (slot.setpointInCelsius != null) {
                        mSlot.setpointInCelsius = String(slot.setpointInCelsius);
                    }
                    return mSlot;
                })
            };
        });

        const vars = {
            accountNumber: this.account,
            euid: this.euid,
            params: {
                zone: zoneCode,
                schedules: mutationSchedules
            }
        };

        await this.gql(query, vars, true, true);
    }

    // Helper: Convert API schedule (read) to App schedule (write)
    toSchedule(apiSchedule) {
        return {
            days: apiSchedule.days,
            settings: apiSchedule.settings.map(s => {
                let t = s.startTime;
                if (t.length >= 8) t = t.substring(0, 5); // Trim seconds
                return {
                    time: t,
                    action: s.action === "SET_TEMPERATURE" ? "HEAT" : (s.action === "TURN_OFF" ? "OFF" : s.action),
                    setpointInCelsius: s.setpointInCelsius
                };
            })
        };
    }

    async gql(query, variables, authed, useBackend = false, retry = true) {
        const headers = {
            'Content-Type': 'application/json'
        };
        if (authed) {
            if (!this.token) throw new Error("Not authenticated");
            headers['Authorization'] = useBackend ? this.token : 'JWT ' + this.token;
        }

        const url = useBackend ? BACKEND_API_URL : API_URL;

        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ query, variables })
        });

        if (response.status === 401 && authed && retry) {
            await this.authenticate();
            return this.gql(query, variables, authed, useBackend, false);
        }

        const result = await response.json();

        if (result.errors && result.errors.length > 0) {
            const details = result.errors.map(e => {
                let msg = e.message;
                if (e.path) msg += ` [path: ${e.path.join('.')}]`;
                if (e.extensions) msg += ` [${JSON.stringify(e.extensions)}]`;
                return msg;
            }).join('; ');

            if (authed && retry && (details.toLowerCase().includes("token") || details.includes("401") || details.toLowerCase().includes("signature has expired"))) {
                await this.authenticate();
                return this.gql(query, variables, authed, useBackend, false);
            }

            console.error('GraphQL Errors:', JSON.stringify(result.errors, null, 2));
            throw new Error(details);
        }

        return result.data;
    }

    // --- Device Mutations ---
    
    async setQuieterMode(enabled) {
        const query = `mutation($a: String!, $e: ID!, $q: Boolean!) { heatPumpSetHushMode(accountNumber: $a, euid: $e, hushModeEnabled: $q) { transactionId } }`;
        return this.gql(query, { a: this.account, e: this.euid, q: enabled }, true, true);
    }

    async updateSensorDisplayName(sensorCode, displayName) {
        const query = `mutation($a: String!, $e: ID!, $u: [UpdateSensorDisplayNameInput!]!) { heatPumpBulkUpdateSensorDisplayName(accountNumber: $a, euid: $e, updates: $u) { transactionId } }`;
        return this.gql(query, { a: this.account, e: this.euid, u: [{ sensorCode, displayName }] }, true, true);
    }

    async setupSmartControl() {
        if (!this.propertyId) throw new Error("Property ID not available to setup smart control.");
        const query = `mutation($a: String!, $p: ID!, $e: ID!) { heatPumpSetupSmartControl(input: { accountNumber: $a, propertyId: $p, euid: $e }) { success } }`;
        return this.gql(query, { a: this.account, p: this.propertyId, e: this.euid }, true, true);
    }

    async updateZoneDisplayName(zoneCode, newDisplayName) {
        const query = `mutation($a: String!, $e: ID!, $u: [SetZoneDisplayNameParameters!]!) { heatPumpBulkUpdateZoneDisplayNames(accountNumber: $a, euid: $e, updates: $u) { transactionIds { transactionId } } }`;
        return this.gql(query, { a: this.account, e: this.euid, u: [{ zoneCode, newDisplayName }] }, true, true);
    }

    async setZonePrimarySensor(zone, sensorCode) {
        const query = `mutation { heatPumpSetZonePrimarySensor(accountNumber: "${this.account}", euid: "${this.euid}", operationParameters: {zone: ${zone}, sensorCode: "${sensorCode}"}) { transactionId } }`;
        return this.gql(query, {}, true, true);
    }

    async setZoneMode(zone, mode, endAt, setpoint, action) {
        let opArgs = `{zone: ${zone}`;
        if (mode) opArgs += `, mode: ${mode}`;
        if (action) opArgs += `, scheduleOverrideAction: ${action}`;
        if (endAt) opArgs += `, endAt: "${endAt}"`;
        if (setpoint) opArgs += `, setpointInCelsius: "${setpoint}"`;
        opArgs += `}`;
        
        const query = `mutation { heatPumpSetZoneMode(accountNumber: "${this.account}", euid: "${this.euid}", operationParameters: ${opArgs}) { transactionId } }`;
        return this.gql(query, {}, true, true);
    }

    async updateFlowTemperatureConfiguration(useWc, flowTemp, minTemp, maxTemp) {
        let flowTempStr = flowTemp ? `"${flowTemp}"` : `""`;
        let minTempStr = minTemp ? `"${minTemp}"` : `""`;
        let maxTempStr = maxTemp ? `"${maxTemp}"` : `""`;
        
        let wcValues = `weatherCompensationValues: {minimum: {value: ${minTempStr}, unit: DEGREES_CELSIUS}, maximum: {value: ${maxTempStr}, unit: DEGREES_CELSIUS}}`;
        let flowValues = `flowTemperature: {value: ${flowTempStr}, unit: DEGREES_CELSIUS}`;
        
        const query = `mutation { heatPumpUpdateFlowTemperatureConfiguration(accountNumber: "${this.account}", euid: "${this.euid}", flowTemperatureInput: {useWeatherCompensation: ${useWc}, ${flowValues}, ${wcValues}}) { transactionId } }`;
        return this.gql(query, {}, true, true);
    }

    // --- Live Performance ---

    async getLivePerformance() {
        const query = `query GetLivePerformance($accountNumber: String!, $euid: ID!) {
            heatPumpLivePerformance(accountNumber: $accountNumber, euid: $euid) {
                readAt
                coefficientOfPerformance
                powerInput { value unit }
                heatOutput { value unit }
                outdoorTemperature { value unit }
            }
        }`;
        const data = await this.gql(query, { accountNumber: this.account, euid: this.euid }, true, true);
        return data.heatPumpLivePerformance;
    }

    // --- Performance History ---
    
    async getPerformanceHistory(startAt, endAt, grouping = 'WEEK') {
        const queryStr = `query GetPerformance($accountNumber: String!, $euid: ID!, $start: DateTime!, $end: DateTime!, $grouping: PerformanceGrouping!) {
            heatPumpTimeSeriesPerformance(accountNumber: $accountNumber, euid: $euid, performanceGrouping: $grouping, startAt: $start, endAt: $end) {
                startAt
                endAt
                outdoorTemperature { unit value }
                energyOutput { unit value }
                energyInput { unit value }
            }
        }`;
        const data = await this.gql(queryStr, { accountNumber: this.account, euid: this.euid, start: startAt, end: endAt, grouping }, true, true);
        return data.heatPumpTimeSeriesPerformance || [];
    }

    async getTimeRangedPerformance(startAt, endAt) {
        const query = `query GetTotalPerformance($a: String!, $e: ID!, $start: DateTime!, $end: DateTime!) {
            heatPumpTimeRangedPerformance(accountNumber: $a, euid: $e, startAt: $start, endAt: $end) {
                coefficientOfPerformance
                energyInput { unit value }
                energyOutput { unit value }
            }
        }`;
        const data = await this.gql(query, { a: this.account, e: this.euid, start: startAt, end: endAt }, true, true);
        return data.heatPumpTimeRangedPerformance;
    }
}


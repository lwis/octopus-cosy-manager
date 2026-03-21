// Octopus Energy API Client

const API_URL = "https://api.octopus.energy/v1/graphql/";

export class OctopusClient {
    constructor(apiKey, account, euid) {
        this.apiKey = apiKey;
        this.account = account;
        this.euid = euid;
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
            query GetViewerAccounts {
                viewer {
                    accounts {
                        number
                    }
                }
            }`;
        
        const viewerData = await this.gql(viewerQuery, {}, true);
        const accounts = viewerData?.viewer?.accounts || [];
        
        const devices = [];
        for (const account of accounts) {
            const euidQuery = `
                query GetHeatPumps($accountNumber: String!) {
                    octoHeatPumpControllerEuids(accountNumber: $accountNumber)
                }`;
            
            const euidData = await this.gql(euidQuery, { accountNumber: account.number }, true);
            const euids = euidData?.octoHeatPumpControllerEuids || [];
            
            for (const euid of euids) {
                devices.push({ account: account.number, euid });
            }
        }
        
        return devices;
    }

    async getConfiguration() {
        const query = `
            query GetConfig($accountNumber: String!, $euid: ID!) {
                octoHeatPumpControllerConfiguration(accountNumber: $accountNumber, euid: $euid) {
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
                            allowableRange { maximum { unit value } minimum { unit value } }
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
                octoHeatPumpLifetimePerformance(euid: $euid) {
                    seasonalCoefficientOfPerformance
                    heatOutput { unit value }
                    energyInput { unit value }
                    readAt
                }
                octoHeatPumpControllerStatus(accountNumber: $accountNumber, euid: $euid) {
                    sensors {
                        code
                        connectivity { online retrievedAt }
                        telemetry { temperatureInCelsius humidityPercentage voltage retrievedAt }
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
        }, true);

        if (!data.octoHeatPumpControllerConfiguration) {
            throw new Error("No configuration returned (check account number and EUID)");
        }

        const config = data.octoHeatPumpControllerConfiguration;
        config.performance = data.octoHeatPumpLifetimePerformance;
        const status = data.octoHeatPumpControllerStatus;
        
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

    async setZoneSchedules(zoneCode, schedules) {
        const query = `
            mutation SetZoneSchedules($accountNumber: String!, $euid: ID!, $params: SetZoneSchedulesParameters!) {
                octoHeatPumpSetZoneSchedules(
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
                    
                    const mSlot = {
                        time: t,
                        action: slot.action
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

        await this.gql(query, vars, true);
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

    async gql(query, variables, authed) {
        const headers = {
            'Content-Type': 'application/json'
        };
        if (authed) {
            if (!this.token) throw new Error("Not authenticated");
            headers['Authorization'] = 'JWT ' + this.token;
        }

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ query, variables })
        });

        const result = await response.json();

        if (result.errors && result.errors.length > 0) {
            console.error('GraphQL Errors:', JSON.stringify(result.errors, null, 2));
            const details = result.errors.map(e => {
                let msg = e.message;
                if (e.path) msg += ` [path: ${e.path.join('.')}]`;
                if (e.extensions) msg += ` [${JSON.stringify(e.extensions)}]`;
                return msg;
            }).join('; ');
            throw new Error(details);
        }

        return result.data;
    }

    // --- Device Mutations ---
    
    async rebootController() {
        const query = `mutation($a: String!, $e: ID!) { octoHeatPumpRebootController(accountNumber: $a, euid: $e) { transactionId } }`;
        return this.gql(query, { a: this.account, e: this.euid }, true);
    }

    async setQuieterMode(enabled) {
        const query = `mutation($e: ID!, $q: Boolean!) { octoHeatPumpSetQuieterMode(euid: $e, quieterModeEnabled: $q) { transactionId } }`;
        return this.gql(query, { e: this.euid, q: enabled }, true);
    }

    async updateWaterSetpoint(setpoint) {
        const query = `mutation($a: String!, $e: ID!, $s: Int!) { octoHeatPumpUpdateWaterSetpoint(accountNumber: $a, euid: $e, setpoint: $s) { transactionId } }`;
        return this.gql(query, { a: this.account, e: this.euid, s: parseInt(setpoint, 10) }, true);
    }

    async updateSensorDisplayName(sensorCode, displayName) {
        const query = `mutation($a: String!, $e: ID!, $sc: String!, $dn: String!) { octoHeatPumpUpdateSensorDisplayName(accountNumber: $a, euid: $e, sensorCode: $sc, displayName: $dn) { transactionId } }`;
        return this.gql(query, { a: this.account, e: this.euid, sc: sensorCode, dn: displayName }, true);
    }

    async setZonePrimarySensor(zone, sensorCode) {
        const query = `mutation { octoHeatPumpSetZonePrimarySensor(accountNumber: "${this.account}", euid: "${this.euid}", operationParameters: {zone: ${zone}, sensorCode: "${sensorCode}"}) { transactionId } }`;
        return this.gql(query, {}, true);
    }

    async setZoneMode(zone, mode, endAt, setpoint, action) {
        let opArgs = `{zone: ${zone}`;
        if (mode) opArgs += `, mode: ${mode}`;
        if (action) opArgs += `, scheduleOverrideAction: ${action}`;
        if (endAt) opArgs += `, endAt: "${endAt}"`;
        if (setpoint) opArgs += `, setpointInCelsius: "${setpoint}"`;
        opArgs += `}`;
        
        const query = `mutation { octoHeatPumpSetZoneMode(accountNumber: "${this.account}", euid: "${this.euid}", operationParameters: ${opArgs}) { transactionId } }`;
        return this.gql(query, {}, true);
    }

    async updateFlowTemperatureConfiguration(useWc, flowTemp, minTemp, maxTemp) {
        let flowTempStr = flowTemp ? `"${flowTemp}"` : `""`;
        let minTempStr = minTemp ? `"${minTemp}"` : `""`;
        let maxTempStr = maxTemp ? `"${maxTemp}"` : `""`;
        
        let wcValues = `weatherCompensationValues: {minimum: {value: ${minTempStr}, unit: DEGREES_CELSIUS}, maximum: {value: ${maxTempStr}, unit: DEGREES_CELSIUS}}`;
        let flowValues = `flowTemperature: {value: ${flowTempStr}, unit: DEGREES_CELSIUS}`;
        
        const query = `mutation { octoHeatPumpUpdateFlowTemperatureConfiguration(euid: "${this.euid}", flowTemperatureInput: {useWeatherCompensation: ${useWc}, ${flowValues}, ${wcValues}}) { transactionId } }`;
        return this.gql(query, {}, true);
    }

    // --- Live Performance ---

    async getLivePerformance() {
        const query = `query GetLivePerformance($euid: ID!) {
            octoHeatPumpLivePerformance(euid: $euid) {
                readAt
                coefficientOfPerformance
                powerInput { value unit }
                heatOutput { value unit }
                outdoorTemperature { value unit }
            }
        }`;
        const data = await this.gql(query, { euid: this.euid }, true);
        return data.octoHeatPumpLivePerformance;
    }

    // --- Performance History ---
    
    async getPerformanceHistory(startAt, endAt, grouping = 'WEEK') {
        const queryStr = `query GetPerformance($euid: ID!, $start: DateTime!, $end: DateTime!, $grouping: PerformanceGrouping!) {
            octoHeatPumpTimeSeriesPerformance(euid: $euid, performanceGrouping: $grouping, startAt: $start, endAt: $end) {
                startAt
                endAt
                outdoorTemperature { unit value }
                energyOutput { unit value }
                energyInput { unit value }
            }
        }`;
        const data = await this.gql(queryStr, { euid: this.euid, start: startAt, end: endAt, grouping }, true);
        return data.octoHeatPumpTimeSeriesPerformance || [];
    }
}

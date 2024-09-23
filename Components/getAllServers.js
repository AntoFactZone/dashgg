const fetch = require('node-fetch');
const settings = require('../settings.json');

module.exports = async () => {
    try {
        const response = await fetch(
            settings.pterodactyl.domain + "/api/application/servers?per_page=1000000",
            {
                headers: {
                    "Authorization": `Bearer ${settings.pterodactyl.key}`
                }
            }
        );

        // Check if the response is not OK
        if (!response.ok) {
            console.error(`Failed to fetch servers. Status: ${response.status}`);
            return [];
        }

        // Check if the response content type is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            console.error(`Invalid content type: ${contentType}`);
            return [];
        }

        const servers = await response.json();
        return servers.data || [];
    } catch (error) {
        console.error(`Error fetching servers: ${error.message}`);
        return [];
    }
};
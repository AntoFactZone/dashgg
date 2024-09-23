const settings = require("../settings.json");
const { CronJob } = require('cron');
const getAllServers = require('../Components/getAllServers');
const fetch = require('node-fetch');

module.exports.load = async function (app, db) {

    app.get(`/api/renewalstatus`, async (req, res) => {
        if (!settings.renewals.status) return res.json({ error: true });
        if (!req.query.id) return res.json({ error: true });
        if (!req.session.pterodactyl) res.json({ error: true });
        if (req.session.pterodactyl.relationships.servers.data.filter(server => server.attributes.id == req.query.id).length == 0) return res.json({ error: true });
    
        const lastRenew = await db.get(`lastrenewal-${req.query.id}`);
            
        const isSuspended = await db.get(`suspended-${req.query.id}`);
        if (isSuspended) {
            return res.json({ text: 'Server is suspended. Click on renew to unsuspend.', suspended: true });
        }
        
        if (lastRenew > Date.now()) return res.json({ text: 'Renewed', success: true })
        else {
            if ((Date.now() - lastRenew) > (settings.renewals.delay * 86400000)) {
                return res.json({ text: 'Last chance to renew!', renewable: true })
            }
            const time = msToDaysAndHours((settings.renewals.delay * 86400000) - (Date.now() - lastRenew))
            return res.json({ text: time, renewable: true })
        }    });
     

    app.get(`/renew`, async (req, res) => {
        if (!settings.renewals.status) return res.send(`Renewals are currently disabled.`);
        if (!req.query.id) return res.send(`Missing ID.`);
        if (!req.session.pterodactyl) return res.redirect(`/login`);
        if (req.session.pterodactyl.relationships.servers.data.filter(server => server.attributes.id == req.query.id).length == 0) return res.send(`No server with that ID was found!`);
    
        // Allow renewal only if the user has enough coins
        let coins = await db.get("coins-" + req.session.userinfo.id);
        coins = coins ? coins : 0;
    
        if (settings.renewals.cost > coins) {
            return res.redirect(`/dashboard` + "?err=CANNOTAFFORDRENEWAL");
        }
    
        // Check affordability before attempting to unsuspend
        if (coins >= settings.renewals.cost) {
            // Unsuspend server only if the user has enough coins
            let unsuspendResults = await fetch(
                settings.pterodactyl.domain + "/api/application/servers/" + req.query.id + "/unsuspend",
                {
                    method: "post",
                    headers: {
                        'Content-Type': 'application/json',
                        "Authorization": `Bearer ${settings.pterodactyl.key}`
                    }
                }
            );
    
            let unsuspendOk = await unsuspendResults.ok;
            if (unsuspendOk === true) {
                // console.log(`Server with ID ${req.query.id} unsuspended.`);
                await db.delete(`suspended-${req.query.id}`);
    
                // Update the lastRenew timestamp when the server is successfully renewed
                await db.set(`lastrenewal-${req.query.id}`, Date.now());
    
                // Deduct coins for the renewal
                await db.set("coins-" + req.session.userinfo.id, coins - settings.renewals.cost);
    
                return res.redirect(`/dashboard` + `?success=RENEWED`);
            } else {
                //console.error(`Failed to unsuspend server with ID ${req.query.id}. Report admin`);
                return res.redirect(`/dashboard` + `?err=UNSUSPEND_FAILED`);
            }
        } else {
            return res.redirect(`/dashboard` + "?err=CANNOTAFFORDRENEWAL");
        }
    });         

    new CronJob(`*/10 * * * * *`, async () => { // Run every 10 seconds
        if (settings.renewals.status) {
            //console.log('Running renewal check...');
            try {
                const servers = await getAllServers();
                if (!Array.isArray(servers)) {
                    console.error('Error: getAllServers did not return an array.');
                    return;
                }
    
                for (const server of servers) {
                    const id = server.attributes.id;
                    const lastRenew = await db.get(`lastrenewal-${id}`);
                    if (!lastRenew) continue;
    
                    const isSuspended = await db.get(`suspended-${id}`);
                    if (isSuspended) continue; // Skip checking suspended servers
    
                    if (lastRenew < Date.now() && (Date.now() - lastRenew) > (settings.renewals.delay * 86400000)) {
                        // Server overdue for renewal - suspend the server
                        let suspensionResults = await fetch(
                            settings.pterodactyl.domain + "/api/application/servers/" + id + "/suspend",
                            {
                                method: "post",
                                headers: {
                                    'Content-Type': 'application/json',
                                    "Authorization": `Bearer ${settings.pterodactyl.key}`
                                }
                            }
                        );
                        let suspensionOk = await suspensionResults.ok;
                        if (suspensionOk === true) {
                            //console.log(`Server with ID ${id} failed renewal and was suspended.`);
                            await db.set(`suspended-${id}`, true);
                            await db.delete(`lastrenewal-${id}`);
                        }
                    } else if (lastRenew < Date.now()) {
                        // Server is overdue, but not for suspension, you may add additional handling here if needed
                        //console.log(`Server with ID ${id} is overdue for renewal.But not suspended, report admin`);
                    }                 
                }
                //console.log('Renewal check over!');
            } catch (error) {
                console.error('Error during renewal check:', error);
            }
        }
    }, null, true, 'Asia/Kolkata') // Set timezone to Asia/Kolkata
        .start();       

    function msToDaysAndHours(ms) {
        const msInDay = 86400000;
        const msInHour = 3600000;

        const days = Math.floor(ms / msInDay);
        const hours = Math.round((ms - (days * msInDay)) / msInHour * 100) / 100;

        let pluralDays = `s`;
        if (days === 1) {
            pluralDays = ``;
        }
        let pluralHours = `s`;
        if (hours === 1) {
            pluralHours = ``;
        }

        return `${days} day${pluralDays} and ${hours} hour${pluralHours}`;
    }
};
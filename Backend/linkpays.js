const fetch = require('node-fetch');
const settings = require('../settings.json');

module.exports.load = async function (app, db) {
  const lpcodes = {};
  const cooldowns = {};

  function generateUserCode() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return code;
  }

  app.get(`/linkpays/generate`, async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect("/login");
  
    const userId = req.session.userinfo.id;

    if (cooldowns[userId] && cooldowns[userId] > Date.now()) {
      return res.redirect(`/linkpays`);
    } else if (cooldowns[userId]) {
      delete cooldowns[userId];
    }
  
    const dailyTotal = await db.get(`dailylinkpays-${userId}`);
    if (dailyTotal && dailyTotal >= settings.linkpays.dailyLimit) {
      return res.redirect(`/linkpays?err=REACHEDDAILYLIMIT`);
    }
  
    const userCode = generateUserCode();
    lpcodes[userId] = {
      code: userCode,
      generated: Date.now(),
      redeemed: false,
    };
  
    const link = `${settings.api.client.oauth2.link}/linkpays/redeem/${userCode}`;
    const alias = generateUserCode();
  
    // Log settings to verify the availability of API keys
    //console.log("Settings for linkpays:", settings.linkpays);
  
    // Ensure that the API keys are defined in the settings
    const apiKey1 = settings.linkpays.apiKey;
    const apiKey2 = settings.linkpays.apiKey;
    const apiKeyDefault = settings.linkpays.apiKey;

    if (!apiKey1 || !apiKey2 || !apiKeyDefault) {
      console.error('One or more API keys are undefined. Please check your settings.json file.');
      return res.status(500).json({ error: 'API_KEY_UNDEFINED' });
    }
  
    // Randomly select an API key with a probability of 33%
    const randomProbability = Math.random();
    let selectedApiKey;

    if (randomProbability < 0.33) {
      selectedApiKey = apiKey1;
    } else if (randomProbability < 0.67) {
      selectedApiKey = apiKey2;
    } else {
      selectedApiKey = apiKeyDefault;
    }
  
    //console.log(`Selected API key for user ${userId}: ${selectedApiKey}`);
  
    try {
      const response = await fetch(`https://linkpays.in/api?api=${selectedApiKey}&url=${encodeURIComponent(link)}&alias=ishanactyl${alias}`);
      const data = await response.json();
      if (response.ok) {
        //console.log(`${req.session.userinfo.username} generated a linkpays link: `, data.shortenedUrl);
        res.json({ link: data.shortenedUrl });
      } else {
        console.error('Error response from linkpays.in:', data);
        res.status(500).json({ error: 'linkpaysERROR' });
      }
    } catch (error) {
      console.error('Error generating linkpays.io link:', error);
      res.status(500).json({ error: 'linkpaysERROR' });
    }
  });

  app.get(`/linkpays/redeem/:code`, async (req, res) => {
  if (!req.session.pterodactyl) return res.redirect("/");
  
  const userId = req.session.userinfo.id;
  const code = req.params.code;

  if (cooldowns[userId] && cooldowns[userId] > Date.now()) {
    return res.redirect(`/linkpays`);
  } else if (cooldowns[userId]) {
    delete cooldowns[userId];
  }
  
  if (!code) return res.send('<body style="background-color: #1b1c1d;"><center><h1 style="color: white">Error Code: HCLP001</h1><br><h2 style="color: white">You can get more information about this code on our <a style="color: white" href="https://discord.gg/">support</a> server!</h2></center>');

  const usercode = lpcodes[userId];
  if (!usercode) return res.redirect(`/linkpays`);
  if (usercode.code !== code) return res.redirect(`/linkpays`);
  if (usercode.redeemed) return res.redirect(`/linkpays`);

  usercode.redeemed = true;

  if (((Date.now() - usercode.generated) / 1000) < settings.linkpays.minTimeToComplete) {
    return res.send('<body style="background-color: #1b1c1d;"><center><h1 style="color: white">Error Code: HCLP002</h1><br><h2 style="color: white">You can get more information about this code on our <a style="color: white" href="https://discord.gg/">support</a> server!</h2></center>');
  }

  cooldowns[userId] = Date.now() + settings.linkpays.cooldown * 60 * 1000;

  // Retrieve the dailyTotal from the database
  const dailyTotal = await db.get(`dailylinkpays-${userId}`);
  
  await db.set(`dailylinkpays-${userId}`, (dailyTotal || 0) + 1);
  const coins = await db.get(`coins-${userId}`);
  await db.set(`coins-${userId}`, (coins || 0) + settings.linkpays.coins);

  res.redirect(`/linkpays?err=SUCCESSlinkpays`);
});
};
const express = require("express");
const { chromium } = require("playwright");
const app = express();

app.use(express.json());
app.use(express.static("public")); // serve HTML/JS

function isValidTikTokImage(url) {
    if (!url) return false;
    const l = url.toLowerCase();
    const blocked = ["avatar","profile","userpic","default_avatar","headshot","p16-sign","p19-sign","p23-sign"];
    if (blocked.some(k => l.includes(k))) return false;
    if (!l.endsWith(".jpg") && !l.endsWith(".jpeg") && !l.endsWith(".png") && !l.endsWith(".webp")) return false;
    return true;
}

async function extractTikTokImages(url) {
    const images = [];
    const seen = new Set();

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                   "AppleWebKit/537.36 (KHTML, like Gecko) " +
                   "Chrome/120.0.0.0 Safari/537.36",
        viewport: { width: 1920, height: 1080 },
        locale: "en-US",
        colorScheme: "light",
        acceptDownloads: true,
        javaScriptEnabled: true
    });

    const page = await context.newPage();
    await page.goto(url, { timeout: 60000 });
    await page.waitForLoadState("networkidle");

    const metaSelectors = ["meta[property='og:image']","meta[name='twitter:image']","meta[itemprop='image']"];
    for (const sel of metaSelectors) {
        const el = await page.$(sel);
        if (el) {
            const content = await el.getAttribute("content");
            if (content && isValidTikTokImage(content) && !seen.has(content)) {
                images.push(content);
                seen.add(content);
            }
        }
    }

    const imgs = await page.$$("img");
    for (const img of imgs) {
        try {
            const src = await img.getAttribute("src");
            const box = await img.boundingBox();
            if (!src || !box || box.width < 100 || box.height < 100) continue;
            if (isValidTikTokImage(src) && !seen.has(src)) {
                images.push(src);
                seen.add(src);
            }
        } catch(e){ continue; }
    }

    await browser.close();
    return images;
}

app.post("/extract", async (req, res) => {
    const url = req.body.url;
    if (!url) return res.status(400).json({error:"Missing URL"});
    try {
        const images = await extractTikTokImages(url);
        res.json({images});
    } catch(e) {
        console.error(e);
        res.status(500).json({error:"Failed to extract images"});
    }
});

app.listen(3000, () => console.log("Server running at http://localhost:3000"));

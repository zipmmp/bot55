const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const axios = require('axios');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Config
const PORT = process.env.PORT || 3000;

// Helper functions
function isValidTiktokImage(url) {
    if (!url || typeof url !== 'string') return false;
    
    const urlLower = url.toLowerCase();
    
    // Filter profile images
    const profileKeywords = [
        'avatar', 'profile', 'userpic', 'default_avatar',
        'headshot', 'p16-sign', 'p19-sign', 'p23-sign',
        'user-avatar', '_720x720', '_100x100'
    ];
    
    if (profileKeywords.some(keyword => urlLower.includes(keyword))) {
        return false;
    }
    
    // Check extensions
    const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    if (!validExtensions.some(ext => urlLower.includes(ext))) {
        return false;
    }
    
    return true;
}

// API Endpoints
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'TikTok Image Extractor API is running' });
});

app.post('/api/extract', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }
        
        if (!url.includes('tiktok.com')) {
            return res.status(400).json({ error: 'Invalid TikTok URL' });
        }
        
        console.log(`Starting extraction from: ${url}`);
        
        // Launch browser
        const browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080'
            ]
        });
        
        const page = await browser.newPage();
        
        // Set user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Navigate to URL
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Scroll to load more content
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    
                    if (totalHeight >= scrollHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });
        
        // Wait for content to load
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Extract images
        const images = await page.evaluate(() => {
            const results = new Set();
            
            // Get meta tags images
            const metaSelectors = [
                'meta[property="og:image"]',
                'meta[name="twitter:image"]',
                'meta[itemprop="image"]'
            ];
            
            metaSelectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    const content = el.getAttribute('content');
                    if (content) results.add(content);
                });
            });
            
            // Get img elements
            const imgElements = document.querySelectorAll('img');
            imgElements.forEach(img => {
                const src = img.getAttribute('src');
                const srcset = img.getAttribute('srcset');
                
                if (src) results.add(src);
                
                if (srcset) {
                    srcset.split(',').forEach(part => {
                        const url = part.trim().split(' ')[0];
                        if (url) results.add(url);
                    });
                }
            });
            
            // Get background images
            const elementsWithBg = document.querySelectorAll('div, section, article');
            elementsWithBg.forEach(el => {
                const style = el.getAttribute('style');
                if (style && style.includes('background-image')) {
                    const match = style.match(/url\(['"]?(.*?)['"]?\)/);
                    if (match && match[1]) {
                        results.add(match[1]);
                    }
                }
            });
            
            return Array.from(results);
        });
        
        // Close browser
        await browser.close();
        
        // Filter images
        const validImages = images.filter(img => isValidTiktokImage(img));
        const uniqueImages = [...new Set(validImages)];
        
        console.log(`Found ${uniqueImages.length} valid images`);
        
        res.json({
            success: true,
            totalFound: images.length,
            validImages: uniqueImages.length,
            images: uniqueImages,
            metadata: {
                url,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Extraction error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.get('/api/download/:url*', async (req, res) => {
    try {
        const imageUrl = req.params.url + (req.params[0] || '');
        
        if (!imageUrl) {
            return res.status(400).json({ error: 'Image URL is required' });
        }
        
        // Download image
        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://www.tiktok.com/'
            }
        });
        
        // Set headers for download
        res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.setHeader('Content-Disposition', `attachment; filename="tiktok_image_${Date.now()}.jpg"`);
        
        // Send image
        res.send(response.data);
        
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Failed to download image' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('API Endpoints:');
    console.log(`  GET  /api/health`);
    console.log(`  POST /api/extract`);
    console.log(`  GET  /api/download/:url`);
});

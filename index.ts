const { chromium, Browser, Page } = await import('playwright@1.52.0');
const { Cron } = await import('croner@9.0.0');
import fs from 'fs/promises';
import path from 'path';

// Configuration
const FLOTILLA_URL = 'https://flotilla-orpin.vercel.app/';
const SLACK_WEBHOOK_URL = process.env.WEBHOOK; // Replace with your actual webhook URL
const MMSI = '232057367';
const SCREENSHOT_DIR = './screenshots';

// Gaza Strip approximate coordinates (center)
const GAZA_COORDINATES = {
  lat: 31.5,
  lon: 34.45
};

interface Position {
  lat: number;
  lon: number;
  speed: number;
  last_position_epoch: number;
  last_position_UTC: string;
}

interface Vessel {
  uuid: string;
  name: string;
  mmsi: string;
  imo: string | null;
  eni: string | null;
  country_iso: string;
  type: string;
  type_specific: string;
  positions: Position[];
}

interface ApiResponse {
  days: number;
  start: string;
  vessels: {
    [mmsi: string]: Vessel;
  };
}

/**
 * Calculate distance between two coordinates using Haversine formula
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * Get vessel data from API
 */
async function getVesselData(): Promise<{ vessel: Vessel; distanceToGaza: number } | null> {
  try {
    const today = new Date().toISOString().split('T')[0];
    const response = await fetch(`https://flotilla-orpin.vercel.app/api/vessel?start=${today}&mmsis=${MMSI}`);
    const data = await response.json() as ApiResponse;
    
    const vessel = data.vessels[MMSI];
    if (!vessel || !vessel.positions || vessel.positions.length === 0) {
      console.log('No vessel data or positions found');
      return null;
    }

    const firstPosition = vessel.positions[0];
    const distanceToGaza = calculateDistance(
      firstPosition.lat,
      firstPosition.lon,
      GAZA_COORDINATES.lat,
      GAZA_COORDINATES.lon
    );

    return { vessel, distanceToGaza };
  } catch (error) {
    console.error('Error fetching vessel data:', error);
    return null;
  }
}

/**
 * Take screenshot of the canvas element
 */
async function takeScreenshot(): Promise<string | null> {
  let browser: Browser | null = null;
  
  try {
    // Ensure screenshots directory exists
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set viewport size
    await page.setViewportSize({ width: 1920, height: 1080 });
    
    console.log('Navigating to flotilla website...');
    await page.goto(FLOTILLA_URL, { waitUntil: 'networkidle' });
    
    // Wait for canvas to load
    console.log('Waiting for canvas element...');
    await page.waitForSelector('canvas', { timeout: 30000 });
    
    // Wait a bit more for the canvas to render content
    await page.waitForTimeout(5000);
    
    // Take screenshot of the canvas element
    const canvas = await page.locator('canvas').first();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `flotilla-canvas-${timestamp}.png`;
    const filepath = path.join(SCREENSHOT_DIR, filename);
    
    await canvas.screenshot({ path: filepath });
    console.log(`Screenshot saved: ${filepath}`);
    
    return filepath;
  } catch (error) {
    console.error('Error taking screenshot:', error);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Send screenshot to Slack
 */
async function sendToSlack(imagePath: string, vesselInfo?: { vessel: Vessel; distanceToGaza: number }): Promise<void> {
  try {
    if (!SLACK_WEBHOOK_URL || SLACK_WEBHOOK_URL === 'YOUR_SLACK_WEBHOOK_URL_HERE') {
      console.error('Please set your Slack webhook URL in the configuration');
      return;
    }

    const imageBuffer = await fs.readFile(imagePath);
    const form = new FormData();
    
    // Create message text
    let messageText = `📸 Flotilla Canvas Screenshot - ${new Date().toISOString()}`;
    
    if (vesselInfo) {
      const { vessel, distanceToGaza } = vesselInfo;
      const position = vessel.positions[0];
      messageText += `\n\n🚢 **${vessel.name}** (MMSI: ${vessel.mmsi})`;
      messageText += `\n📍 Position: ${position.lat.toFixed(6)}, ${position.lon.toFixed(6)}`;
      messageText += `\n📏 Distance to Gaza Strip: **${distanceToGaza.toFixed(2)} km**`;
      messageText += `\n⏰ Last Position: ${position.last_position_UTC}`;
      messageText += `\n🚤 Speed: ${position.speed.toFixed(1)} knots`;
    }

    // For webhook, we need to send as a regular POST with JSON
    const payload = {
      text: messageText,
      username: 'Flotilla Bot',
      icon_emoji: ':ship:'
    };

    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      console.log('Message sent to Slack successfully');
      
      // Note: Webhook URLs don't support file uploads directly
      // You would need to use Slack's files.upload API with a bot token for image uploads
      console.log('Note: Image upload requires Slack Bot Token and files.upload API');
    } else {
      console.error('Failed to send to Slack:', response.statusText);
    }
  } catch (error) {
    console.error('Error sending to Slack:', error);
  }
}

/**
 * Main function to execute the screenshot and send process
 */
async function executeScreenshotProcess(): Promise<void> {
  console.log(`Starting screenshot process at ${new Date().toISOString()}`);
  
  try {
    // Get vessel data first
    const vesselData = await getVesselData();
    if (vesselData) {
      console.log(`Vessel ${vesselData.vessel.name} is ${vesselData.distanceToGaza.toFixed(2)} km from Gaza Strip`);
    }

    // Take screenshot
    const screenshotPath = await takeScreenshot();
    
    if (screenshotPath) {
      // Send to Slack
      await sendToSlack(screenshotPath, vesselData || undefined);
      
      // Clean up old screenshots (keep only last 10)
      await cleanupOldScreenshots();
    } else {
      console.error('Failed to take screenshot');
    }
  } catch (error) {
    console.error('Error in screenshot process:', error);
  }
  
  console.log(`Screenshot process completed at ${new Date().toISOString()}`);
}

/**
 * Clean up old screenshots to save disk space
 */
async function cleanupOldScreenshots(): Promise<void> {
  try {
    const files = await fs.readdir(SCREENSHOT_DIR);
    const screenshots = files
      .filter(file => file.startsWith('flotilla-canvas-') && file.endsWith('.png'))
      .map(file => ({
        name: file,
        path: path.join(SCREENSHOT_DIR, file)
      }))
      .sort((a, b) => b.name.localeCompare(a.name)); // Sort by name (newest first due to timestamp)

    // Keep only the 10 most recent screenshots
    if (screenshots.length > 10) {
      const filesToDelete = screenshots.slice(10);
      for (const file of filesToDelete) {
        await fs.unlink(file.path);
        console.log(`Deleted old screenshot: ${file.name}`);
      }
    }
  } catch (error) {
    console.error('Error cleaning up old screenshots:', error);
  }
}

/**
 * Initialize the cron job
 */
function initializeCronJob(): void {
  console.log('Initializing cron job to run every 6 hours...');
  
  // Run every 6 hours: 0 */6 * * *
  const job = Cron('0 */6 * * *', {
    name: 'flotilla-screenshot',
    timezone: 'UTC'
  }, executeScreenshotProcess);

  console.log('Cron job initialized. Next run:', job.nextRun()?.toISOString());
  
  // Run once immediately for testing
  console.log('Running initial screenshot...');
  executeScreenshotProcess();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Start the application
if (require.main === module) {
  initializeCronJob();
}

export {
  executeScreenshotProcess,
  getVesselData,
  calculateDistance,
  takeScreenshot,
  sendToSlack
};

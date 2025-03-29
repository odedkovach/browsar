const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

// Configure the OpenAI client using your API key from environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Helper function to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Create screenshots directory if it doesn't exist
const screenshotsDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

// Helper function to take screenshots with timestamp
const takeScreenshot = async (page, name) => {
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const filename = `${name}_${timestamp}.png`;
  const filepath = path.join(screenshotsDir, filename);
  await page.screenshot({ path: filepath });
  console.log(`Screenshot saved: ${filename}`);
  return filepath;
};

// Helper function to highlight an element before interacting with it
const highlightElement = async (page, element, color = 'red') => {
  await page.evaluate((el, color) => {
    const originalStyle = el.style.border;
    const originalBg = el.style.backgroundColor;
    
    // Add a highlight
    el.style.border = `3px solid ${color}`;
    el.style.backgroundColor = color === 'red' ? 'rgba(255, 0, 0, 0.2)' : 'rgba(0, 255, 0, 0.2)';
    el.style.boxShadow = '0 0 10px rgba(255, 0, 0, 0.7)';
    
    // Scroll element into view
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Return the original styles so we can restore them later if needed
    return { originalStyle, originalBg };
  }, element, color);
  
  // Wait a moment with the highlight visible
  await delay(1000);
};

async function handleCaptchaVerification(page) {
  try {
    console.log('Handling text verification');
    await takeScreenshot(page, 'before_text_verification');
    
    console.log('Looking for verification elements...');
    
    // Wait for verification elements to be visible
    await page.waitForSelector('img[data-v-6aff2c22]', { visible: true, timeout: 10000 })
      .catch(() => console.log('Verification image not found with first selector, trying alternatives...'));
    
    // Try multiple selectors for the verification image
    const imgSelectors = [
      'img[data-v-6aff2c22]', 
      'img.captcha-image', 
      'div.captcha-container img', 
      'div[class*="captcha"] img'
    ];
    
    // Find verification image
    let verificationImg = null;
    
    // Try each selector until we find the image
    for (const imgSel of imgSelectors) {
      verificationImg = await page.$(imgSel);
      if (verificationImg) {
        console.log(`Found verification image with selector: ${imgSel}`);
        break;
      }
    }
    
    if (!verificationImg) {
      console.error('❌ Could not find verification image');
      await takeScreenshot(page, 'verification_image_not_found');
      return false;
    }
    
    console.log('Found verification image');
    
    // Highlight the verification image for better recognition
    await highlightElement(page, verificationImg);
    await takeScreenshot(page, 'text_verification');
    
    // Get verification text from the image using GPT-4o
    const verificationText = await getVerificationText(page);
    if (!verificationText) {
      console.error('❌ Could not get verification text');
      return false;
    }
    
    console.log(`Text detected: ${verificationText}`);
    
    // Using exact selector based on form HTML
    // Email
    await page.locator('div:nth-of-type(10) input').click();
    await page.locator('div:nth-of-type(10) input').fill(verificationText);
    
    // Wait for verification to complete
    await delay(1000);
    
    // Just continue - we can't rely on the verification check
    console.log('✅ Completed verification step');
    return true;
  } catch (error) {
    console.error('Error in handleCaptchaVerification:', error);
    await takeScreenshot(page, 'error_captcha_verification');
    return false;
  }
}

async function getVerificationText(page) {
  try {
    // Take a full screenshot with the highlighted image
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filename = `text_verification_${timestamp}.png`;
    const filepath = path.join(screenshotsDir, filename);
    
    // Take full screenshot
    await page.screenshot({
      path: filepath,
      fullPage: true
    });
    console.log(`Full screenshot with highlighted text saved: ${filename}`);
    
    // Read the image file and convert to base64
    const imageBuffer = fs.readFileSync(filepath);
    const base64Image = imageBuffer.toString('base64');
    
    // Create a simpler prompt that explicitly asks for just the text
    const prompt = "Return ONLY the letters and numbers you see in the red rectangle. Do not add any other text or phrases like 'The text is'";
    
    console.log(`Sending request to OpenAI with prompt: "${prompt}"`);
    
    // Send to GPT-4o for analysis
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${base64Image}`
              }
            }
          ]
        }
      ]
    });
    
    // Log the full response for debugging
    console.log('Raw OpenAI response:');
    console.log(JSON.stringify(response, null, 2));
    
    let verificationText = response.choices[0].message.content.trim();
    
    // Remove common prefixes that might be included
    const prefixesToRemove = [
      "The text in the red rectangle is",
      "The text is",
      "The captcha is",
      "The code is",
      "The verification code is",
      "The text reads",
      "I see",
      "It says"
    ];
    
    for (const prefix of prefixesToRemove) {
      if (verificationText.toLowerCase().startsWith(prefix.toLowerCase())) {
        verificationText = verificationText.substring(prefix.length).trim();
      }
    }
    
    // Remove any quotation marks, colons, or periods
    verificationText = verificationText.replace(/["':,.]/g, '').trim();
    
    console.log(`Processed verification text: "${verificationText}"`);
    return verificationText;
  } catch (error) {
    console.error('❌ Error getting verification text:', error.message);
    return null;
  }
}

module.exports = {
  handleCaptchaVerification,
  getVerificationText,
  takeScreenshot,
  highlightElement,
  delay
}; 
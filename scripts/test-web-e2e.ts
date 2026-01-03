import puppeteer from 'puppeteer'

const FRONTEND_URL = 'http://localhost:5173'

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function testWebInterface() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--window-size=1280,900']
  })
  
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  
  try {
    console.log('1. Loading settings page...')
    await page.goto(`${FRONTEND_URL}/settings`, { waitUntil: 'networkidle2', timeout: 30000 })
    await delay(3000)
    
    // Get all text content
    const bodyText = await page.evaluate(() => document.body.innerText)
    console.log('\n2. Page content preview:')
    console.log('─'.repeat(50))
    console.log(bodyText.substring(0, 2000))
    console.log('─'.repeat(50))
    
    // Check for specific elements
    console.log('\n3. Looking for voice-related elements...')
    
    const html = await page.content()
    
    // Search for voice-related strings in HTML
    const voiceTerms = ['stt', 'tts', 'speech', 'voice', 'whisper', 'talk', 'microphone', 'transcri']
    for (const term of voiceTerms) {
      const regex = new RegExp(term, 'gi')
      const matches = html.match(regex)
      if (matches && matches.length > 0) {
        console.log(`   "${term}": found ${matches.length} times`)
      }
    }
    
    // Get all links/tabs
    console.log('\n4. Available navigation elements:')
    const links = await page.$$eval('a, [role="tab"], nav button', els => 
      els.map(el => ({ text: el.textContent?.trim(), href: el.getAttribute('href') }))
        .filter(l => l.text && l.text.length < 50)
    )
    links.forEach(l => console.log(`   - ${l.text} ${l.href ? `(${l.href})` : ''}`))
    
    await page.screenshot({ path: '/tmp/opencode-settings-debug.png', fullPage: true })
    console.log('\n5. Screenshot saved to /tmp/opencode-settings-debug.png')
    
    await browser.close()
    
  } catch (error) {
    console.error('Error:', error)
    await browser.close()
  }
}

testWebInterface()

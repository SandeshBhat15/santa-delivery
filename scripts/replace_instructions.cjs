const fs = require('fs');
let js = fs.readFileSync('src/ui/UIManager.js', 'utf8');
js = js.replace(/\r\n/g, '\n');

const lines = js.split('\n');
const startIdx = lines.findIndex(l => l.includes('// 3. INSTRUCTIONS MODAL'));
const endIdx = lines.findIndex((l, i) => i > startIdx && l.includes('// 5. VICTORY / RESULTS MODAL'));

console.log('startIdx:', startIdx, 'endIdx:', endIdx);

const replacement = [
  '    // 3. INSTRUCTIONS MODAL (Responsive Graphic Cards for Desktop & Mobile)',
  '    const instructionsScreen = document.createElement("div");',
  '    instructionsScreen.id = "screen-instructions";',
  '    instructionsScreen.className = "screen-overlay screen-instructions hidden";',
  '    instructionsScreen.innerHTML = `',
  '      <div class="instructions-card-wrapper">',
  '        <!-- Instructions Visual Showcase: Desktop & Mobile Switching Image -->',
  '        <div class="instructions-poster-container">',
  '          <picture>',
  '            <source media="(max-width: 768px)" srcset="/assets/custom_ui/instructions_mobile.png" />',
  '            <img src="/assets/custom_ui/instructions_desktop.png" alt="How to Play" class="instructions-poster-img" />',
  '          </picture>',
  '        </div>',
  '',
  '        <!-- Action Buttons: Play Now & Back -->',
  '        <footer class="instructions-actions-bar">',
  '          <button id="btn-instructions-back" class="btn-image-action btn-sm" aria-label="Back">',
  '            <img src="/assets/custom_ui/btn_back.png" alt="Back" class="btn-image-asset" />',
  '          </button>',
  '          <button id="btn-instructions-close" class="btn-image-action" aria-label="Play Now">',
  '            <img src="/assets/custom_ui/btn_play.png" alt="Play Now" class="btn-image-asset" />',
  '          </button>',
  '        </footer>',
  '      </div>',
  '    `;',
  ''
].join('\n');

lines.splice(startIdx, endIdx - startIdx, replacement);
fs.writeFileSync('src/ui/UIManager.js', lines.join('\r\n'), 'utf8');
console.log('Successfully replaced instructions modal!');

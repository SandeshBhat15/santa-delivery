const fs = require('fs');
let content = fs.readFileSync('src/style.css', 'utf8');

// Remove from bottom
content = content.replace(/\r?\n@import '\.\/ui\/styles\/responsive_fix\.css';/, '');

// Add to top after festive_premium.css
content = content.replace(
  "@import './ui/styles/festive_premium.css';",
  "@import './ui/styles/festive_premium.css';\n@import './ui/styles/responsive_fix.css';"
);

fs.writeFileSync('src/style.css', content, 'utf8');
console.log('Fixed CSS import order');

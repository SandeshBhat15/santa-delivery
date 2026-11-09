const fs = require('fs');
let content = fs.readFileSync('src/style.css', 'utf8');

// Replace old imports
content = content.replace(
  /@import '\.\/ui\/styles\/festive_premium\.css';\r?\n@import '\.\/ui\/styles\/theme\.css';\r?\n@import '\.\/ui\/styles\/hud\.css';\r?\n@import '\.\/ui\/styles\/screens\.css';\r?\n@import '\.\/ui\/styles\/results\.css';\r?\n@import '\.\/ui\/styles\/responsive\.css';/,
  "@import './ui/styles/theme.css';\n@import './ui/styles/festive_premium.css';"
);

fs.writeFileSync('src/style.css', content, 'utf8');
console.log('Successfully updated style.css imports!');

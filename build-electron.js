const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Building Next.js for standalone output...');
execSync('npm run build', { stdio: 'inherit' });

console.log('Copying static assets to standalone directory...');
const standaloneDir = path.join(__dirname, '.next', 'standalone');
const staticDirSrc = path.join(__dirname, '.next', 'static');
const staticDirDest = path.join(standaloneDir, '.next', 'static');
const publicDirSrc = path.join(__dirname, 'public');
const publicDirDest = path.join(standaloneDir, 'public');

// Helper to copy dirs recursively
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (fs.existsSync(staticDirSrc)) copyDir(staticDirSrc, staticDirDest);
if (fs.existsSync(publicDirSrc)) copyDir(publicDirSrc, publicDirDest);

console.log('Static assets copied successfully.');

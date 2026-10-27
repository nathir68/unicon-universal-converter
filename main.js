const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow;
let serverProcess;

const getFreePort = () => {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
};

async function createWindow() {
  const port = await getFreePort();
  
  // Define path to Next.js server
  const serverPath = path.join(__dirname, '.next', 'standalone', 'server.js');
  
  console.log('Starting Next.js server on port:', port);
  serverProcess = spawn('node', [serverPath], {
    env: {
      ...process.env,
      PORT: port,
      NODE_ENV: 'production'
    }
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`Next.js: ${data}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`Next.js Error: ${data}`);
  });

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "UniConvert",
    icon: path.join(__dirname, 'public', 'logo.jpg'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
    },
  });

  // Polling to check if server is ready before loading
  const checkServerReady = setInterval(() => {
    http.get(`http://localhost:${port}`, (res) => {
      if (res.statusCode === 200) {
        clearInterval(checkServerReady);
        mainWindow.loadURL(`http://localhost:${port}`);
      }
    }).on('error', () => {
      // Server not ready yet
    });
  }, 200);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (serverProcess) serverProcess.kill();
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('will-quit', () => {
  if (serverProcess) serverProcess.kill();
});

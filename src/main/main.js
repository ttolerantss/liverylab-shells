const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { parseYft } = require('../lib/yft-parser');
const { writeObj } = require('../lib/obj-writer');

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

function getIconPath() {
  const possiblePaths = [
    path.join(process.resourcesPath, 'icon.ico'),
    path.join(__dirname, '../assets/logol.ico'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'assets', 'logol.ico'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return possiblePaths[0];
}

function createWindow() {
  Menu.setApplicationMenu(null);

  const mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: 'LiveryLab Shells',
    icon: getIconPath(),
    frame: false,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function getMainWindow() {
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
}

ipcMain.on('minimize-window', () => {
  const win = getMainWindow();
  if (win) win.minimize();
});

ipcMain.on('maximize-window', () => {
  const win = getMainWindow();
  if (win) (win.isMaximized() ? win.unmaximize() : win.maximize());
});

ipcMain.on('close-window', () => {
  const win = getMainWindow();
  if (win) win.close();
});

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('open-yft-dialog', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select YFT XML File',
    filters: [
      { name: 'YFT XML', extensions: ['xml'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('select-output-directory', async (event, defaultPath) => {
  const result = await dialog.showOpenDialog({
    title: 'Select Output Folder',
    defaultPath: defaultPath || undefined,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('show-in-folder', (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
});

ipcMain.handle('extract-bodyshell', async (event, args) => {
  const { inputPath, outputDir, yUp, shaderWhitelist } = args;
  const win = BrowserWindow.fromWebContents(event.sender);
  const send = (stage, info) => {
    if (win && !win.isDestroyed()) win.webContents.send('extract-progress', { stage, info });
  };

  try {
    if (!inputPath || !fs.existsSync(inputPath)) {
      throw new Error('Input file does not exist');
    }
    send('reading-file');
    const xmlText = fs.readFileSync(inputPath, 'utf8');

    const result = parseYft(xmlText, {
      shaderWhitelist,
      onProgress: send,
    });

    if (result.geometries.length === 0) {
      return {
        ok: false,
        error: 'No geometries matched the paint shader whitelist — nothing to write.',
        shaders: result.shaders,
        discardedCount: result.discardedCount,
        warnings: result.warnings,
        lodUsed: result.lodUsed,
      };
    }

    const baseName = path.basename(inputPath).replace(/\.yft\.xml$/i, '').replace(/\.xml$/i, '');
    const targetDir = outputDir && fs.existsSync(outputDir) ? outputDir : path.dirname(inputPath);
    const outputPath = path.join(targetDir, `${baseName}_bodyshell.obj`);

    send('writing-obj');
    const written = await writeObj({
      outputPath,
      geometries: result.geometries,
      yUp: !!yUp,
      sourceName: path.basename(inputPath),
    });

    return {
      ok: true,
      writtenPath: written.writtenPath,
      vertexCount: written.vertexCount,
      faceCount: written.faceCount,
      groupNames: written.groupNames,
      keptCount: result.geometries.length,
      discardedCount: result.discardedCount,
      shaders: result.shaders,
      lodUsed: result.lodUsed,
      warnings: result.warnings,
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

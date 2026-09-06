const path = require('path');
const vscode = require('vscode');

const JSON_GLOBS = [
  'static/assets/spines/**/*.json',
  'public/assets/spines/**/*.json',
  'assets/spines/**/*.json',
  'src/assets/spines/**/*.json',
];
const EXCLUDE_GLOB = '**/{node_modules,.git,dist,build,storybook-static}/**';

async function activate(context) {
  let openedAutomatically = false;
  const output = vscode.window.createOutputChannel('Spine Viewer');
  context.subscriptions.push(output);

  const log = (message) => {
    output.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
  };

  const openViewer = async () => {
    log('Opening viewer panel.');
    const panel = vscode.window.createWebviewPanel(
      'spineViewer',
      'Spine Viewer',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: getLocalResourceRoots(context),
      },
    );

    panel.webview.onDidReceiveMessage((message) => {
      if (message?.type === 'log') {
        log(`[webview] ${message.message}`);
      }
    });

    panel.webview.html = getWebviewHtml({
      context,
      panel,
      spines: [],
      initialMessage: 'Scanning workspace spines...',
    });

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Scanning workspace spines',
          cancellable: false,
        },
        async () => {
          log(`Scanning roots: ${getScanRoots().map((root) => root.fsPath).join(', ')}`);
          const spines = await scanWorkspaceSpines();
          log(`Found ${spines.length} skeletons.`);
          log(`Skeletons with atlas: ${spines.filter((item) => item.atlasUri).length}.`);
          panel.webview.html = getWebviewHtml({
            context,
            panel,
            spines,
            initialMessage: spines.length
              ? ''
              : 'No Spine skeleton JSON files were found in this workspace.',
          });

          log(`Viewer ready with ${spines.length} skeletons.`);
        },
      );
    } catch (error) {
      const message = error?.message ?? String(error);
      log(`Scan failed: ${message}`);
      panel.webview.html = getWebviewHtml({
        context,
        panel,
        spines: [],
        initialMessage: message,
      });
      vscode.window.showErrorMessage(`Spine Viewer failed: ${message}`);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('spineViewer.open', openViewer),
  );
  const openAutomatically = () => {
    if (openedAutomatically) return;
    if (context.extensionMode !== vscode.ExtensionMode.Development) return;
    if (!vscode.workspace.workspaceFolders?.length) return;

    openedAutomatically = true;
    setTimeout(() => {
      openViewer();
    }, 300);
  };

  openAutomatically();
  setTimeout(openAutomatically, 1500);
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(openAutomatically));
}

function getLocalResourceRoots(context) {
  return [
    context.extensionUri,
    ...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri),
  ];
}

async function scanWorkspaceSpines() {
  const roots = getScanRoots();
  const skeletonUris = uniqueUris(
    (
      await Promise.all(
        roots.flatMap((root) =>
          JSON_GLOBS.map((glob) =>
            vscode.workspace.findFiles(
              new vscode.RelativePattern(root.fsPath, glob),
              EXCLUDE_GLOB,
              2000,
            ),
          ),
        ),
      )
    ).flat(),
  );
  const items = [];

  for (const skeletonUri of skeletonUris) {
    const json = await readJson(skeletonUri);
    if (!json?.skeleton || !json?.animations || typeof json.animations !== 'object') {
      continue;
    }

    const atlasUri = await findAtlasForSkeleton(skeletonUri);
    const atlasPages = atlasUri ? await readAtlasPages(atlasUri) : [];
    const animations = Object.keys(json.animations).sort((a, b) => a.localeCompare(b));
    const root = vscode.workspace.getWorkspaceFolder(skeletonUri);
    const relativePath = root
      ? path.relative(root.uri.fsPath, skeletonUri.fsPath)
      : skeletonUri.fsPath;

    items.push({
      id: skeletonUri.toString(),
      name: path.basename(skeletonUri.fsPath, '.json'),
      folder: path.basename(path.dirname(skeletonUri.fsPath)),
      relativePath,
      skeletonUri: skeletonUri.toString(),
      atlasUri: atlasUri?.toString() ?? null,
      atlasText: atlasUri ? await readText(atlasUri) : null,
      atlasPages: atlasPages.map((pageName) => ({
        name: pageName,
        uri: vscode.Uri.file(path.join(path.dirname(atlasUri.fsPath), pageName)).toString(),
      })),
      animations,
      defaultAnimation: pickDefaultAnimation(animations),
    });
  }

  return items.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function readAtlasPages(uri) {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf8');
    const pages = [];

    for (const rawLine of text.split(/\r\n|\r|\n/)) {
      const line = rawLine.trim();
      if (!line || line.includes(':')) continue;
      if (/\.(png|webp|jpg|jpeg)$/i.test(line)) {
        pages.push(line);
      }
    }

    return pages;
  } catch {
    return [];
  }
}

function getScanRoots() {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const activeFile = vscode.window.activeTextEditor?.document.uri;
  const activeAppRoot = activeFile ? findAppRoot(activeFile.fsPath) : null;

  if (activeAppRoot) {
    return [vscode.Uri.file(activeAppRoot)];
  }

  return workspaceFolders.map((folder) => folder.uri);
}

function findAppRoot(filePath) {
  const parts = filePath.split(path.sep);
  const appsIndex = parts.lastIndexOf('apps');
  if (appsIndex < 0 || appsIndex + 1 >= parts.length) {
    return null;
  }

  return parts.slice(0, appsIndex + 2).join(path.sep);
}

function uniqueUris(uris) {
  const seen = new Set();
  return uris.filter((uri) => {
    const key = uri.toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readJson(uri) {
  try {
    return JSON.parse(await readText(uri));
  } catch {
    return null;
  }
}

async function readText(uri) {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString('utf8');
}

async function findAtlasForSkeleton(skeletonUri) {
  const dir = vscode.Uri.file(path.dirname(skeletonUri.fsPath));
  const skeletonName = path.basename(skeletonUri.fsPath, '.json');
  const sameNameAtlas = vscode.Uri.joinPath(dir, `${skeletonName}.atlas`);

  if (await exists(sameNameAtlas)) {
    return sameNameAtlas;
  }

  const atlasUris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(dir.fsPath, '*.atlas'),
    undefined,
    20,
  );

  if (atlasUris.length === 1) {
    return atlasUris[0];
  }

  const folderName = path.basename(dir.fsPath);
  return (
    atlasUris.find((uri) => path.basename(uri.fsPath, '.atlas') === folderName) ??
    atlasUris.find((uri) => path.basename(uri.fsPath).toLowerCase().includes('symbol')) ??
    atlasUris[0] ??
    null
  );
}

async function exists(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function pickDefaultAnimation(animations) {
  return (
    animations.find((name) => name === 'default') ??
    animations.find((name) => name === 'Idle') ??
    animations.find((name) => name === 'idle') ??
    animations[0] ??
    null
  );
}

function getWebviewHtml({ context, panel, spines, initialMessage = '' }) {
  const { webview } = panel;
  const nonce = getNonce();
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'viewer.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'viewer.js'));
  const runtimeUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'runtime.js'));

  const payload = {
    spines: spines.map((item) => ({
      ...item,
      skeletonUrl: webview.asWebviewUri(vscode.Uri.parse(item.skeletonUri)).toString(),
      atlasUrl: item.atlasUri ? webview.asWebviewUri(vscode.Uri.parse(item.atlasUri)).toString() : null,
      atlasImages: Object.fromEntries(
        item.atlasPages.map((page) => [
          page.name,
          webview.asWebviewUri(vscode.Uri.parse(page.uri)).toString(),
        ]),
      ),
    })),
    runtimeUrl: runtimeUri.toString(),
    initialMessage,
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; connect-src ${webview.cspSource};">
  <link rel="stylesheet" href="${cssUri}">
  <title>Spine Viewer</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">
    window.__SPINE_VIEWER_DATA__ = ${JSON.stringify(payload)};
  </script>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};

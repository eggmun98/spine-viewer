const path = require('path');
const vscode = require('vscode');

const ATLAS_GLOB = '**/*.atlas';
const SKELETON_GLOB = '**/*.json';
const EXCLUDE_GLOB =
  '**/{node_modules,.git,dist,build,out,coverage,storybook-static,.svelte-kit,.next,.nuxt,.cache}/**';

function activate(context) {
  const output = vscode.window.createOutputChannel('Spine Viewer');
  context.subscriptions.push(output);

  const log = (message) => {
    output.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
  };

  const tree = new SpineTreeProvider(log);
  const preview = new SpinePreview(context, log);

  const view = vscode.window.createTreeView('spineViewer.tree', {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  context.subscriptions.push(view, preview);

  context.subscriptions.push(
    vscode.commands.registerCommand('spineViewer.refresh', () => tree.refresh()),
    vscode.commands.registerCommand('spineViewer.preview', (node) => preview.show(node)),
    vscode.commands.registerCommand('spineViewer.open', () =>
      vscode.commands.executeCommand('spineViewer.tree.focus'),
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(() => tree.refresh()),
  );
}

/* ------------------------------------------------------------------ *
 * Discovery
 * ------------------------------------------------------------------ */

// Skeletons are found by their atlas, not by a hardcoded assets path: a Spine
// skeleton always sits next to its atlas, and `.atlas` is close to unique to
// Spine. That keeps discovery working whatever a project calls its folders.
async function findSkeletons() {
  const [atlasUris, jsonUris] = await Promise.all([
    vscode.workspace.findFiles(ATLAS_GLOB, EXCLUDE_GLOB),
    vscode.workspace.findFiles(SKELETON_GLOB, EXCLUDE_GLOB),
  ]);

  const atlasDirs = new Set(atlasUris.map((uri) => path.dirname(uri.fsPath)));
  return jsonUris
    .filter((uri) => atlasDirs.has(path.dirname(uri.fsPath)))
    .sort((a, b) => a.fsPath.localeCompare(b.fsPath));
}

/* ------------------------------------------------------------------ *
 * Tree
 * ------------------------------------------------------------------ */

class SpineTreeProvider {
  constructor(log) {
    this.log = log;
    this.root = null;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }

  refresh() {
    this.root = null;
    this.emitter.fire();
  }

  async getChildren(node) {
    if (node) return node.children ?? [];

    if (!this.root) {
      const started = Date.now();
      const uris = await findSkeletons();
      this.root = buildTree(uris);
      this.log(`Found ${uris.length} skeletons in ${Date.now() - started}ms.`);
    }

    return this.root;
  }

  getTreeItem(node) {
    if (node.kind === 'skeleton') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.resourceUri = node.uri;
      item.iconPath = new vscode.ThemeIcon('symbol-color');
      item.tooltip = vscode.workspace.asRelativePath(node.uri, true);
      item.command = {
        command: 'spineViewer.preview',
        title: 'Preview Spine Skeleton',
        arguments: [node],
      };
      return item;
    }

    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
    item.iconPath = vscode.ThemeIcon.Folder;
    item.description = `${countSkeletons(node)}`;
    return item;
  }
}

function countSkeletons(node) {
  if (node.kind === 'skeleton') return 1;
  return node.children.reduce((sum, child) => sum + countSkeletons(child), 0);
}

function buildTree(uris) {
  if (uris.length === 0) return [];

  const entries = uris.map((uri) => ({
    uri,
    segments: vscode.workspace.asRelativePath(uri, true).split(/[\\/]/),
  }));

  // Every project buries its skeletons under some fixed prefix. Drop whatever
  // all of them share so the tree starts where the paths actually diverge.
  const depth = commonPrefixLength(entries.map((entry) => entry.segments));
  const root = { kind: 'folder', label: '', children: [] };

  for (const { uri, segments } of entries) {
    const trail = segments.slice(depth);
    const name = trail.pop();
    let cursor = root;

    for (const part of trail) {
      let next = cursor.children.find(
        (child) => child.kind === 'folder' && child.label === part,
      );
      if (!next) {
        next = { kind: 'folder', label: part, children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    }

    cursor.children.push({ kind: 'skeleton', label: name.replace(/\.json$/i, ''), uri });
  }

  compact(root);
  return root.children;
}

function commonPrefixLength(paths) {
  const [first] = paths;
  let depth = 0;

  // Never consume the file name itself, or a single skeleton would have no label.
  while (depth < first.length - 1 && paths.every((p) => p[depth] === first[depth])) {
    depth += 1;
  }

  return depth;
}

// A folder with nothing to choose inside it is a wasted click, so fold it away
// the way the Explorer's compact folders do. Over half the spine folders here
// hold a single skeleton named after the folder.
function compact(node) {
  for (const child of node.children) {
    if (child.kind === 'folder') compact(child);
  }

  node.children = node.children.map(collapse);
  node.children.sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1) || a.label.localeCompare(b.label),
  );
}

function collapse(node) {
  let current = node;

  while (
    current.kind === 'folder' &&
    current.children.length === 1 &&
    current.children[0].kind === 'folder'
  ) {
    const only = current.children[0];
    current = { kind: 'folder', label: `${current.label}/${only.label}`, children: only.children };
  }

  if (
    current.kind === 'folder' &&
    current.children.length === 1 &&
    current.children[0].kind === 'skeleton'
  ) {
    const skeleton = current.children[0];
    // Keep the folder name when it says something the file name does not,
    // otherwise sibling rows could end up identical.
    const label =
      current.label.toLowerCase() === skeleton.label.toLowerCase()
        ? skeleton.label
        : `${current.label} / ${skeleton.label}`;
    return { ...skeleton, label };
  }

  return current;
}

/* ------------------------------------------------------------------ *
 * Preview panel
 * ------------------------------------------------------------------ */

class SpinePreview {
  constructor(context, log) {
    this.context = context;
    this.log = log;
    this.panel = null;
    this.pending = null;
  }

  dispose() {
    this.panel?.dispose();
  }

  async show(node) {
    if (!node?.uri) return;

    if (!this.panel) {
      this.createPanel();
      this.pending = node.uri;
      return;
    }

    this.panel.reveal(vscode.ViewColumn.Active, true);
    await this.send(node.uri);
  }

  createPanel() {
    this.panel = vscode.window.createWebviewPanel(
      'spineViewer',
      'Spine Viewer',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          this.context.extensionUri,
          ...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri),
        ],
      },
    );

    this.panel.onDidDispose(() => {
      this.panel = null;
      this.pending = null;
    });

    this.panel.webview.onDidReceiveMessage((message) => {
      if (message?.type === 'log') {
        this.log(`[webview] ${message.message}`);
        return;
      }
      if (message?.type === 'ready' && this.pending) {
        const uri = this.pending;
        this.pending = null;
        this.send(uri);
      }
    });

    this.panel.webview.html = this.getHtml();
  }

  async send(skeletonUri) {
    try {
      const payload = await buildPayload(this.panel.webview, skeletonUri);
      this.log(`Preview ${payload.name}: atlas=${payload.atlasName ?? 'missing'}`);
      await this.panel.webview.postMessage({ type: 'load', payload });
    } catch (error) {
      const reason = error?.message ?? String(error);
      this.log(`Preview failed for ${skeletonUri.fsPath}: ${reason}`);
      await this.panel.webview.postMessage({
        type: 'load',
        payload: { name: path.basename(skeletonUri.fsPath), error: reason },
      });
    }
  }

  getHtml() {
    const { webview } = this.panel;
    const nonce = getNonce();
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'viewer.css'),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'viewer.js'),
    );
    const runtimeUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'runtime.js'),
    );

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
    window.__SPINE_RUNTIME_URL__ = ${JSON.stringify(runtimeUri.toString())};
  </script>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// Read only what the selected skeleton needs. Nothing here runs during discovery.
async function buildPayload(webview, skeletonUri) {
  const atlasUri = await findAtlasForSkeleton(skeletonUri);
  const name = path.basename(skeletonUri.fsPath, '.json');
  const relativePath = vscode.workspace.asRelativePath(skeletonUri, true);

  if (!atlasUri) {
    return { name, relativePath, error: 'No .atlas file was found next to this skeleton.' };
  }

  const atlasDir = path.dirname(atlasUri.fsPath);
  const pages = await readAtlasPages(atlasUri);

  return {
    name,
    relativePath,
    skeletonUrl: webview.asWebviewUri(skeletonUri).with({ query: `v=${Date.now()}` }).toString(),
    atlasName: path.basename(atlasUri.fsPath),
    atlasText: await readText(atlasUri),
    atlasImages: Object.fromEntries(
      pages.map((page) => [
        page,
        webview
          .asWebviewUri(vscode.Uri.file(path.join(atlasDir, page)))
          .with({ query: `v=${Date.now()}` })
          .toString(),
      ]),
    ),
  };
}

async function findAtlasForSkeleton(skeletonUri) {
  const dir = path.dirname(skeletonUri.fsPath);
  const skeletonName = path.basename(skeletonUri.fsPath, '.json');
  const sameName = vscode.Uri.file(path.join(dir, `${skeletonName}.atlas`));

  if (await exists(sameName)) return sameName;

  const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
  const atlases = entries
    .filter(([name, type]) => type === vscode.FileType.File && name.toLowerCase().endsWith('.atlas'))
    .map(([name]) => name);

  if (atlases.length === 0) return null;

  const folderName = path.basename(dir);
  const picked =
    atlases.find((name) => path.basename(name, '.atlas') === folderName) ?? atlases[0];
  return vscode.Uri.file(path.join(dir, picked));
}

// Page names are the first line of the file and the first line after each blank
// separator. Region names also lack a colon, so position is the only signal.
async function readAtlasPages(uri) {
  const text = await readText(uri);
  const pages = [];
  let expectPageName = true;

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line) {
      expectPageName = true;
      continue;
    }
    if (expectPageName) {
      pages.push(line);
      expectPageName = false;
    }
  }

  return pages;
}

async function readText(uri) {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString('utf8');
}

async function exists(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
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

module.exports = { activate, deactivate };

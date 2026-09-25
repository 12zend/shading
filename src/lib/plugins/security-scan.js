import {decodeText} from './archive';

// Static checks run on every file of a plugin before the user decides to install it. Plugins run with the same
// privileges as the editor, so this cannot prove a plugin safe: it points out code that reaches outside the editor
// (network, storage, navigation, desktop bridge), loads further code, or is hard to review. Obfuscated code can
// evade any static check; the review dialog says so.

/* eslint-disable max-len */
const SEVERITY_ORDER = {none: 0, low: 1, medium: 2, high: 3};

const MAX_OCCURRENCES_PER_RULE = 20;
const MAX_TEXT_SCAN_BYTES = 16 * 1024 * 1024;
const SCRIPT_FILE = /\.(c?js|mjs)$/i;
const MARKUP_FILE = /\.(html?|svg|xhtml|xml)$/i;
const STYLE_FILE = /\.css$/i;
const EXECUTABLE_FILE = /\.(exe|dll|so|dylib|bat|cmd|sh|bash|zsh|ps1|psm1|vbs|jar|app|scr|msi|node|pkg|dmg|command)$/i;

// Namespace and licence URLs that commonly appear in harmless code.
const BENIGN_URL = /^https?:\/\/(www\.)?(w3\.org|opensource\.org|github\.com\/[^/]+\/[^/]+\/(blob|tree)\/|creativecommons\.org|spdx\.org|shading\.app)/i;

/**
 * Each rule: id, severity, permission (the manifest permission that declares the capability, if any),
 * files (which file types it applies to), pattern, and messages.
 */
const RULES = [
    {
        id: 'dynamic-code',
        severity: 'high',
        permission: 'dynamic-code',
        files: 'script',
        pattern: /\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(\s*['"`]|\bset(?:Timeout|Interval)\s*\(\s*['"`]/g,
        en: 'Runs code built from strings (eval / new Function), which hides what it executes.',
        ja: '文字列からコードを生成して実行します（eval / new Function）。実行内容を隠すことができます。'
    },
    {
        id: 'remote-code',
        severity: 'high',
        permission: 'network',
        files: 'script',
        pattern: /\bimport\s*\(|\bimportScripts\s*\(/g,
        en: 'Loads additional code at run time (dynamic import).',
        ja: '実行時に追加のコードを読み込みます（動的import）。'
    },
    {
        id: 'script-injection',
        severity: 'high',
        permission: 'dom',
        files: 'script',
        pattern: /createElement\s*\(\s*['"`]script['"`]\s*\)|document\s*\.\s*write(?:ln)?\s*\(/g,
        en: 'Injects <script> elements or writes directly into the page.',
        ja: '<script>要素を挿入、またはページに直接書き込みます。'
    },
    {
        id: 'markup-script',
        severity: 'high',
        permission: 'dom',
        files: 'markup',
        pattern: /<script\b|\bon(?:load|error|click|mouseover|focus|begin|end)\s*=\s*["']|javascript:/gi,
        en: 'An HTML/SVG file contains scripts or event handlers.',
        ja: 'HTML/SVGファイルにスクリプトやイベントハンドラーが含まれています。'
    },
    {
        id: 'network',
        severity: 'medium',
        permission: 'network',
        files: 'script',
        pattern: /\bfetch\s*\(|\bXMLHttpRequest\b|\bnew\s+WebSocket\b|\bEventSource\b|\bnavigator\s*\.\s*sendBeacon\b|\bRTCPeerConnection\b/g,
        en: 'Communicates over the network. Project data could be sent to another server.',
        ja: 'ネットワーク通信を行います。プロジェクトのデータが外部に送信される可能性があります。'
    },
    {
        id: 'external-url',
        severity: 'medium',
        permission: 'network',
        files: 'text',
        pattern: /\b(?:https?|wss?|ftp):\/\/[^\s'"`<>)\\]+/gi,
        filter: match => !BENIGN_URL.test(match),
        en: 'Contains addresses of external servers.',
        ja: '外部サーバーのアドレスが含まれています。'
    },
    {
        id: 'browser-storage',
        severity: 'medium',
        permission: 'storage',
        files: 'script',
        pattern: /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bcaches\s*\.\s*open\b|\bdocument\s*\.\s*cookie\b/g,
        en: 'Reads or writes browser storage, which also holds your installed plugins and restore points.',
        ja: 'ブラウザの保存領域を読み書きします（インストール済みプラグインや復元ポイントも含まれます）。'
    },
    {
        id: 'credentials',
        severity: 'high',
        permission: null,
        files: 'text',
        pattern: /\bnavigator\s*\.\s*credentials\b|type\s*=\s*\\?["']password\\?["']|\.type\s*=\s*['"`]password['"`]/g,
        en: 'Asks for passwords or credentials. shading.app plugins never need your passwords.',
        ja: 'パスワードや認証情報を扱います。shading.appのプラグインがパスワードを必要とすることはありません。'
    },
    {
        id: 'navigation',
        severity: 'high',
        permission: 'navigation',
        files: 'script',
        pattern: /\b(?:window|top|parent|self|document)\s*\.\s*location\s*(?:=|\.\s*(?:href\s*=|assign\s*\(|replace\s*\())|\blocation\s*\.\s*href\s*=|\bwindow\s*\.\s*open\s*\(|\.\s*opener\b/g,
        en: 'Navigates away from the editor or opens other windows (unsaved work could be lost).',
        ja: 'エディターから別ページへ移動、または別ウィンドウを開きます（未保存の作業が失われる可能性があります）。'
    },
    {
        id: 'desktop-bridge',
        severity: 'high',
        permission: 'desktop',
        files: 'script',
        pattern: /\bshadingDesktop\b|\bipcRenderer\b|\brequire\s*\(\s*['"`](?:child_process|fs|os|net|http|https|electron|vm|worker_threads|module)['"`]\s*\)|\bprocess\s*\.\s*(?:env|exit|binding|versions|platform)\b/g,
        en: 'Uses desktop-app or Node.js interfaces that can reach files on your computer.',
        ja: 'デスクトップアプリやNode.jsの機能を使います。パソコン上のファイルに触れる可能性があります。'
    },
    {
        id: 'global-hooks',
        severity: 'high',
        permission: null,
        files: 'script',
        pattern: /\bwindow\s*\.\s*(?:fetch|XMLHttpRequest|WebSocket|open|alert|confirm|prompt)\s*=[^=]|\b(?:Object|Array|Function|String|Promise|JSON)\s*\.\s*prototype\s*\.\s*\w+\s*=[^=]|\bJSON\s*\.\s*(?:parse|stringify)\s*=[^=]/g,
        en: 'Replaces built-in browser functions, which can intercept data from the whole editor.',
        ja: 'ブラウザ標準の関数を書き換えます。エディター全体のデータを横取りできます。'
    },
    {
        id: 'service-worker',
        severity: 'high',
        permission: null,
        files: 'script',
        pattern: /\bserviceWorker\s*\.\s*register\b/g,
        en: 'Registers a service worker that keeps running after the plugin is removed.',
        ja: 'プラグイン削除後も動き続けるService Workerを登録します。'
    },
    {
        id: 'mining',
        severity: 'high',
        permission: null,
        files: 'text',
        pattern: /coinhive|cryptonight|stratum\+tcp|\bxmrig\b|webminer/gi,
        en: 'Contains cryptocurrency-mining signatures.',
        ja: '暗号通貨マイニングの特徴が含まれています。'
    },
    {
        id: 'media-access',
        severity: 'medium',
        permission: 'media',
        files: 'script',
        pattern: /\bgetUserMedia\b|\bgetDisplayMedia\b|\bgeolocation\b|\bnavigator\s*\.\s*(?:bluetooth|usb|serial|hid)\b/g,
        en: 'Requests camera, microphone, screen, location or device access.',
        ja: 'カメラ・マイク・画面・位置情報・デバイスへのアクセスを要求します。'
    },
    {
        id: 'clipboard',
        severity: 'medium',
        permission: 'clipboard',
        files: 'script',
        pattern: /\bnavigator\s*\.\s*clipboard\b|execCommand\s*\(\s*['"`](?:copy|paste|cut)/g,
        en: 'Reads or writes the clipboard.',
        ja: 'クリップボードを読み書きします。'
    },
    {
        id: 'wasm',
        severity: 'medium',
        permission: 'wasm',
        files: 'script',
        pattern: /\bWebAssembly\b/g,
        en: 'Runs WebAssembly, which cannot be reviewed as source code.',
        ja: 'WebAssemblyを実行します（ソースコードとして確認できません）。'
    },
    {
        id: 'workers',
        severity: 'medium',
        permission: 'workers',
        files: 'script',
        pattern: /\bnew\s+(?:Shared)?Worker\s*\(/g,
        en: 'Starts background workers.',
        ja: 'バックグラウンドのWorkerを起動します。'
    },
    {
        id: 'iframe',
        severity: 'medium',
        permission: 'dom',
        files: 'text',
        pattern: /createElement\s*\(\s*['"`]iframe['"`]\s*\)|<iframe\b|\.srcdoc\s*=/gi,
        en: 'Embeds other pages (iframes).',
        ja: '他のページを埋め込みます（iframe）。'
    },
    {
        id: 'window-messaging',
        severity: 'low',
        permission: null,
        files: 'script',
        pattern: /\bpostMessage\s*\(/g,
        en: 'Sends messages to other windows or workers.',
        ja: '他のウィンドウやWorkerにメッセージを送ります。'
    },
    {
        id: 'html-injection',
        severity: 'low',
        permission: 'dom',
        files: 'script',
        pattern: /\.innerHTML\s*=[^=]|\.outerHTML\s*=[^=]|insertAdjacentHTML\s*\(/g,
        en: 'Inserts raw HTML into the page.',
        ja: 'ページに生のHTMLを挿入します。'
    },
    {
        id: 'encoded-strings',
        severity: 'low',
        permission: null,
        files: 'script',
        pattern: /\batob\s*\(|\bString\s*\.\s*fromCharCode\s*\(|\bunescape\s*\(|\bdecodeURIComponent\s*\(\s*escape\s*\(/g,
        en: 'Decodes encoded strings at run time (sometimes used to hide code).',
        ja: '実行時にエンコードされた文字列を復元します（コードの隠蔽に使われることがあります）。'
    },
    {
        id: 'css-import',
        severity: 'low',
        permission: 'network',
        files: 'style',
        pattern: /@import\s+url\(\s*['"]?https?:|url\(\s*['"]?https?:/gi,
        en: 'Style sheet loads resources from external servers.',
        ja: 'スタイルシートが外部サーバーからリソースを読み込みます。'
    }
];

/* eslint-enable max-len */

const lineIndex = text => {
    const starts = [0];
    for (let index = 0; index < text.length; index++) {
        if (text.charCodeAt(index) === 10) starts.push(index + 1);
    }
    return offset => {
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1; // eslint-disable-line no-bitwise
            if (starts[middle] <= offset) low = middle;
            else high = middle - 1;
        }
        return {line: low + 1, column: offset - starts[low] + 1, start: starts[low]};
    };
};

const snippetAt = (text, offset, length) => {
    const start = Math.max(0, offset - 40);
    const end = Math.min(text.length, offset + length + 40);
    return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')
        .trim()}${end < text.length ? '…' : ''}`.slice(0, 200);
};

const kindOf = path => {
    if (SCRIPT_FILE.test(path)) return 'script';
    if (MARKUP_FILE.test(path)) return 'markup';
    if (STYLE_FILE.test(path)) return 'style';
    return 'other';
};

const looksBinary = bytes => {
    const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
    let control = 0;
    for (const byte of sample) {
        if (byte === 0) return true;
        if (byte < 9 || (byte > 13 && byte < 32)) control++;
    }
    return sample.length > 0 && control / sample.length > 0.1;
};

const addFinding = (findings, rule, declared, file, text, match) => {
    const key = `${rule.id}\0${file}`;
    let finding = findings.get(key);
    if (!finding) {
        finding = {
            rule: rule.id,
            severity: rule.severity,
            permission: rule.permission,
            declared,
            file,
            count: 0,
            occurrences: [],
            en: rule.en,
            ja: rule.ja
        };
        findings.set(key, finding);
    }
    finding.count++;
    if (text !== null && match && finding.occurrences.length < MAX_OCCURRENCES_PER_RULE) {
        finding.occurrences.push({
            line: match.position.line,
            column: match.position.column,
            snippet: snippetAt(text, match.index, match.value.length),
            value: match.value.slice(0, 120)
        });
    }
};

const scanObfuscation = (findings, file, text) => {
    const lines = text.split('\n');
    const longest = lines.reduce((maximum, line) => Math.max(maximum, line.length), 0);
    if (text.length > 20000 && longest > 5000) {
        addFinding(findings, {
            id: 'minified',
            severity: 'low',
            permission: null,
            en: 'Minified or generated code that is hard to review by eye.',
            ja: '圧縮・自動生成されたコードで、目視での確認が困難です。'
        }, true, file, null, null);
    }
    const base64 = text.match(/['"`][A-Za-z0-9+/=]{2000,}['"`]/g);
    if (base64) {
        addFinding(findings, {
            id: 'embedded-blob',
            severity: 'medium',
            permission: null,
            en: 'Contains large encoded data inside the code.',
            ja: 'コード内に大きなエンコード済みデータが埋め込まれています。'
        }, true, file, null, null);
    }
    const escapes = text.match(/\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}/g);
    if (escapes && escapes.length > 200 && escapes.length > text.length / 200) {
        addFinding(findings, {
            id: 'escaped-code',
            severity: 'medium',
            permission: null,
            en: 'Uses many escaped characters, a common way to disguise code.',
            ja: 'エスケープ文字を多用しています（コードを偽装する一般的な手口です）。'
        }, true, file, null, null);
    }
};

/**
 * Scan a plugin archive.
 * @param {object} archive Result of readPluginArchive.
 * @returns {object} {level, findings, summary, undeclaredPermissions, files}
 */
const scanPlugin = archive => {
    const declaredPermissions = new Set(archive.manifest.permissions || []);
    const findings = new Map();
    const files = [];
    for (const [path, bytes] of archive.files) {
        const kind = kindOf(path);
        files.push({path, size: bytes.length, kind});
        if (EXECUTABLE_FILE.test(path)) {
            addFinding(findings, {
                id: 'executable-file',
                severity: 'high',
                permission: null,
                en: 'Contains a program file for your operating system. shading.app never runs it, ' +
                    'but plugins do not need one.',
                ja: 'OS用の実行ファイルが含まれています。shading.appは実行しませんが、プラグインには不要なファイルです。'
            }, true, path, null, null);
            continue;
        }
        if (/\.wasm$/i.test(path)) {
            addFinding(findings, {
                id: 'wasm-binary',
                severity: 'medium',
                permission: 'wasm',
                en: 'Contains a WebAssembly binary.',
                ja: 'WebAssemblyのバイナリが含まれています。'
            }, declaredPermissions.has('wasm'), path, null, null);
            continue;
        }
        if (bytes.length > MAX_TEXT_SCAN_BYTES || looksBinary(bytes)) {
            if (kind === 'script' || kind === 'markup') {
                addFinding(findings, {
                    id: 'unscannable',
                    severity: 'medium',
                    permission: null,
                    en: 'A code file is too large or not plain text, so it could not be checked.',
                    ja: 'コードファイルが大きすぎるかテキストではないため、検査できませんでした。'
                }, true, path, null, null);
            }
            continue;
        }
        if (kind === 'other' && !/\.(json|txt|md|glsl|frag|vert|fx|fxh|csv)$/i.test(path)) continue;
        const text = decodeText(bytes);
        const position = lineIndex(text);
        for (const rule of RULES) {
            // 'text' rules apply to every readable file, the others to one file kind.
            if (rule.files !== 'text' && rule.files !== kind) continue;
            rule.pattern.lastIndex = 0;
            let match = rule.pattern.exec(text);
            while (match) {
                if (!rule.filter || rule.filter(match[0])) {
                    const declared = !rule.permission || declaredPermissions.has(rule.permission);
                    addFinding(findings, rule, declared, path, text, {
                        index: match.index,
                        value: match[0],
                        position: position(match.index)
                    });
                }
                if (match[0].length === 0) rule.pattern.lastIndex++;
                match = rule.pattern.exec(text);
            }
        }
        if (kind === 'script') scanObfuscation(findings, path, text);
    }
    for (const path of archive.symlinks || []) {
        addFinding(findings, {
            id: 'symlink',
            severity: 'high',
            permission: null,
            en: 'Contains a symbolic link (ignored), which can point outside the plugin.',
            ja: 'シンボリックリンクが含まれています（無視されます）。プラグイン外を指す可能性があります。'
        }, true, path, null, null);
    }
    const list = Array.from(findings.values()).sort((a, b) => (
        (SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]) || a.rule.localeCompare(b.rule) ||
        a.file.localeCompare(b.file)
    ));
    const level = list.reduce((current, finding) => (
        SEVERITY_ORDER[finding.severity] > SEVERITY_ORDER[current] ? finding.severity : current
    ), 'none');
    const undeclared = new Set(list.filter(finding => finding.permission && !finding.declared)
        .map(finding => finding.permission));
    const summary = {high: 0, medium: 0, low: 0};
    for (const finding of list) summary[finding.severity]++;
    return {
        level,
        findings: list,
        summary,
        undeclaredPermissions: Array.from(undeclared).sort(),
        declaredPermissions: Array.from(declaredPermissions).sort(),
        files: files.sort((a, b) => a.path.localeCompare(b.path))
    };
};

export {RULES, SEVERITY_ORDER, scanPlugin};

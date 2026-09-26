# shading.app プラグイン仕様

プラグインは zip で配布する JavaScript のパッケージです。エフェクトに限らず、ブロックのカテゴリ、描画処理、
エディターのタブや UI、プロジェクトに保存するデータなどを追加できます。これまで本体に内蔵されていた
エフェクト（ぼかし、グロー、色調補正、LUT、Genshade など）は、公式プラグインとして
[shading-plugins](https://github.com/12zend/shading-plugins) に移りました。

## 読み込みと管理

- **読み込み**: コードエリア左下のボタン（旧「拡張機能を追加」）か、Plugins タブの「プラグインを追加」を押すと、
  zip の選択画面が開きます。zip は複数まとめて選択できます。選んだ zip は実行される前に検査され、
  インストール確認画面（セキュリティ検査の結果）にまとめて表示されます。個別にチェックを外して除外でき、
  依存関係のあるプラグインは依存先から順にインストールされます。
- **管理**: エディターの「Plugins」タブ（メニューの「編集」→「プラグイン…」でも開きます）で、インストール済み
  プラグインの一覧と削除ができます。各プラグインのオン／オフは「エディターを再読み込みしたときに読み込むか」の
  設定で、切り替えても実行中のプラグインはそのまま動き、再読み込み後に反映されます（タブの「今すぐ再読み込み」で反映）。
- インストールしたプラグインはブラウザ（IndexedDB）に保存され、次回起動時にプロジェクトより先に読み込まれます。
  保存された zip が確認時のハッシュと一致しない場合は読み込みません。

## zip の構成

```text
my-plugin.zip
└── my-plugin/                ← フォルダごと zip にしても、中身だけを zip にしてもよい
    ├── shading-plugin.json   ← 必須
    ├── main.js               ← 必須（manifest の main）
    ├── lib/…                 ← 任意の .js / .json
    └── shaders/…, assets/…   ← GLSL、画像、WebAssembly など任意のファイル
```

ビルドは不要です。フォルダを `zip -r my-plugin.zip my-plugin` するだけで読み込めます。

### shading-plugin.json

```json
{
  "format": "shading.app/plugin",
  "formatVersion": 1,
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What it adds.",
  "author": "Your name",
  "license": "MIT",
  "main": "main.js",
  "permissions": ["network"],
  "dependencies": [],
  "recommends": ["blur"],
  "locales": {"ja": {"name": "マイプラグイン", "description": "追加する機能の説明"}}
}
```

| フィールド | 必須 | 内容 |
| --- | --- | --- |
| `format` / `formatVersion` | はい | `shading.app/plugin` / `1` |
| `id` | はい | 小文字英数字と `-`、最大48文字。同じ id を読み込むと置き換え |
| `name`, `version`, `description`, `author`, `license`, `homepage` | 推奨 | 確認画面と管理画面に表示 |
| `main` | 任意 | 起動する .js（既定 `main.js`） |
| `permissions` | 任意 | 使う機能の申告。`network` `storage` `dynamic-code` `wasm` `workers` `dom` `navigation` `clipboard` `media` `desktop` |
| `dependencies` | 任意 | 先に有効化が必要なプラグイン id |
| `recommends` | 任意 | 併用を推奨するプラグイン id（管理画面に表示） |
| `locales` | 任意 | 言語ごとの `name` / `description` |

`permissions` は実行を制限するものではありません（プラグインはエディターと同じ権限で動きます）。
検査で見つかった機能が申告されていない場合、確認画面に「マニフェストで未申告」と表示されます。

## main.js

プラグインは CommonJS で書きます。`require('shading')` でプラグイン用 API を、`require('./lib/x.js')` や
`require('./data.json')` でプラグイン内のファイルを読み込めます。npm パッケージやネットワーク上のコードは
読み込めません（必要なら zip に同梱してください）。

```js
exports.activate = shading => {
    // 同期的にブロックなどを登録する。非同期の読み込みがある場合は Promise を返すと、
    // プロジェクトの読み込みはそれを待つ。
};
exports.deactivate = () => {}; // 任意
```

API で登録したもの（ブロック、タブ、スタイル、プロジェクトデータなど）は、プラグインを無効化・削除すると自動で元に戻ります。

## API（`shading`）

| API | 内容 |
| --- | --- |
| `shading.plugin` | id, name, version, manifest |
| `shading.vm` / `runtime` / `renderer` | Scratch VM と描画エンジン |
| `shading.scratch` | `ArgumentType`, `BlockType`, `Cast` |
| `shading.l10n.getLocale()`, `localize(locale, en, ja)` | 表示言語 |
| `shading.files.list()`, `has(path)`, `text(path)`, `json(path)`, `bytes(path)`, `url(path)` | zip 内のファイル（同期）。`url` は blob URL |
| `shading.extensions.register(extension)` | 独自カテゴリ（Scratch 拡張と同じ `getInfo()` 形式） |
| `shading.penfx.registerBlocks(package, options)` | Looks カテゴリへブロック群を追加（[shader package](PENFX_SHADER_PACKAGES.md) 形式、`implementation` で PenFX メソッドを呼ぶ） |
| `shading.penfx.addToolbox({id, order, label, blocks, menus})` | Looks カテゴリへ任意のブロック定義を追加 |
| `shading.penfx.extendPenFX(install)` | ブロックが呼ぶ PenFX メソッドを追加（`install({PenFX, vm})` 形式でも可） |
| `shading.penfx.extendEngine(install, {onResize})` | 描画エンジンにメソッドを追加 |
| `shading.penfx.registerProgram(name, glsl, {boundsPadding})` | エンジンで使う fragment program を登録 |
| `shading.penfx.helpers`, `vertexShader`, `createPreviewRenderer()` | 引数変換ヘルパー、頂点シェーダー、サムネイル用の描画 |
| `shading.blocks.define(categoryId, (ScratchBlocks, {locale, vm}) => …)` | ブロック定義のカスタマイズ（独自フィールドなど） |
| `shading.blocks.filterToolboxXML(categoryId, xml => xml)` | ツールボックス XML の調整 |
| `shading.ui.definePresetMenuBlock(ScratchBlocks, options)` | サムネイル付きプリセット選択メニュー |
| `shading.gui.addTab({id, label, icon, component \| mount})` | コスチューム・音などと並ぶタブ。React コンポーネントか DOM の `mount(container)` |
| `shading.gui.addStyle(css)`, `addMenuItem({label, onClick})`, `notify(message)` | CSS、管理画面のコマンド、通知 |
| `shading.gui.react` | エディターの React / ReactDOM / `AssetPanel` など |
| `shading.project.registerData(key, {serialize, deserialize})` | プロジェクトに保存するデータ。`deserialize` はブロックの読み込み前に待たれる |
| `shading.project.onLoad(callback)`, `markChanged()` | プロジェクト読み込みの前処理、変更通知 |
| `shading.plugins.whenReady(id)`, `isActive(id)`, `getExports(id)` | 他のプラグインとの連携 |
| `shading.runWithoutWaiting(promise)` | ブロックから非同期処理を開始する |
| `shading.onDispose(callback)` | 無効化時の後処理 |

### ブロックの規則

[AGENTS.md](../AGENTS.md) の規則はプラグインのブロックにも適用されます。

- コマンドブロックは待たずに戻り、Scratch VM に `Promise` を返さないこと。非同期処理は `shading.runWithoutWaiting` で開始する。
- 画像やフォントなど非同期の資源は、プラグインの有効化時や `registerData` の `deserialize` で準備しておく。
- 描画ループ内で使われるブロックは、1 tick の中で完結し、途中のフレームを表示しないこと。

### 例: Looks にエフェクトを 1 つ追加する

```js
// main.js
exports.activate = shading => {
    const {mixAmount} = shading.penfx.helpers;
    shading.penfx.registerProgram('invert', shading.files.text('invert.glsl'));
    shading.penfx.extendEngine({
        invert (mix, blendMode) {
            this._singlePass(this._program('invert'), {u_mix: mix}, [], blendMode);
        }
    });
    shading.penfx.extendPenFX({
        invert (args) {
            this._safe(engine => engine.invert(mixAmount(args.MIX), this.blendMode));
        }
    });
    shading.penfx.registerBlocks({
        id: 'invert',
        name: 'Invert',
        blocks: [{
            id: 'invert',
            text: 'invert mix: [MIX] %',
            implementation: {type: 'penfx', opcode: 'invert'},
            inputs: [{id: 'MIX', type: 'number', defaultValue: 100}]
        }]
    });
};
```

### 例: 独自カテゴリとタブを追加する

```js
exports.activate = shading => {
    const {BlockType, ArgumentType} = shading.scratch;
    shading.extensions.register({
        getInfo: () => ({
            id: 'texttools',
            name: 'Text Tools',
            blocks: [{
                opcode: 'shout',
                blockType: BlockType.REPORTER,
                text: 'shout [TEXT]',
                arguments: {TEXT: {type: ArgumentType.STRING, defaultValue: 'hi'}}
            }]
        }),
        shout: args => `${String(args.TEXT).toUpperCase()}!`
    });
    shading.gui.addTab({
        id: 'notes',
        label: {en: 'Notes', ja: 'メモ'},
        mount: container => {
            container.textContent = 'Hello from a plugin';
        }
    });
};
```

## プロジェクトとの互換性

- プロジェクトを保存すると、使用しているプラグイン（ブロック・独自カテゴリ・保存データの提供元）が
  `shadingPlugins` に記録されます。プラグイン本体はプロジェクトに含めません。
- 必要なプラグインがない状態でプロジェクトを開くと、不足しているプラグイン名が表示されます。
  そのブロックは灰色のプレースホルダーとして表示・保存され、プラグインのデータもそのまま保存されます。
  プラグインをインストールすると元のブロックに戻ります。
- プラグイン導入前に作られたプロジェクトの Looks ブロック（`penfx_gaussianBlur` など）は、
  必要な公式プラグイン名が表示されます。
- `targets`、`penFXShaders`、`movie…` などの本体のキーはプラグインデータに使えません。

## セキュリティ

プラグインはサンドボックスなしで、エディターと同じ権限で動作します。任意の JavaScript を実行できるため、
**読み込むかどうかの判断と責任はユーザーにあります**。そのうえで、インストール前に次の確認を行います。

1. zip の検証: パス（`../`、絶対パス、シンボリックリンク）、ファイル数と展開後サイズ（zip bomb）、manifest。
2. 静的セキュリティ検査: すべてのファイルを調べ、該当箇所をファイル名・行番号・抜粋付きで表示します。

| 重大度 | 主な検出内容 |
| --- | --- |
| 高 | `eval` / `new Function`、動的 `import`、`<script>` 挿入、HTML/SVG 内のスクリプト、パスワード入力、別ページへの移動、デスクトップアプリ・Node.js の機能、標準関数の書き換え、Service Worker、マイニング、OS の実行ファイル |
| 注意 | ネットワーク通信、外部 URL、ブラウザ保存領域（IndexedDB など）、カメラ・マイク・位置情報、クリップボード、WebAssembly、Worker、iframe、大きな埋め込みデータ、難読化 |
| 低 | `postMessage`、`innerHTML`、文字列のデコード、圧縮されたコード |

「高」の項目がある場合は、「リスクを理解し、このプラグインの作者を信頼します」にチェックを入れるまで
インストールできません。検査は既知のパターンを探すもので、偽装されたコードを検出できない場合があることも
確認画面に明記しています。インストール後も、保存された zip のハッシュが確認時と異なる場合は読み込みません。

### 公式プラグインの署名

公式プラグインには `shading-plugin.sig`（ECDSA P-256 の署名）が入っています。署名の対象は、
`shading-plugin.sig` を除くプラグイン内の全ファイルの SHA-256 です。そのため、フォルダをどう zip にしても
検証でき、ファイルを 1 つでも変更・追加・削除すると署名は無効になります。

| 表示 | 意味 |
| --- | --- |
| 公式・署名済み | 本体に組み込まれた公開鍵（`src/lib/plugins/signature.js` の `OFFICIAL_KEYS`）で検証できた |
| 非公式 | 署名がない。サードパーティのプラグイン |
| 署名が無効 | 署名はあるがファイルと一致しない、または未知の鍵。改変された公式プラグインの可能性があるため「高」リスクとして扱う |

- 確認画面と Plugins タブに表示します。署名は起動時にも毎回検証し直します（保存済みの判定結果は信用しません）。
- `/install` の一括インストールは、有効な公式署名のあるプラグインしか保存しません。
- 署名が示すのは配布元だけです。署名済みでも、プラグインがエディターと同じ権限で動くことは変わりません。
- 署名は shading-plugins の `node scripts/sign.mjs` で作成します（手順は shading-plugins の README を参照）。
  秘密鍵はリポジトリに含めません。鍵を追加・失効させる場合は、`OFFICIAL_KEYS` と shading-plugins の
  `signing-keys.json` を両方更新してください。

## 公式プラグイン

| id | 内容 |
| --- | --- |
| `color-adjust` | コントラスト・明るさ・彩度・トーンマップ・クロマキー・グラデーションオーバーレイなど |
| `color-grading` | 手動カラーグレーディングとワンクリック・ルック（サムネイル付き） |
| `lut` | LUT ブロックと LUT タブ |
| `blur` | ガウス・方向・放射・レンズぼかし、被写界深度 |
| `glow` | ブルーム、ディープグロー |
| `stylize` | 縁取り、エッジ検出、シャープ、FXAA、DoG、桑原フィルター |
| `film` | RGBずれ、フィルム粒子、ディザ、網点、アスキー、ブラウン管、VHS、グリッチ |
| `lens` | 色収差、レンズ歪み、ビネット、構図ガイド、フレーム、ズーム、深度フォグ |
| `distort` | 波、パルス、ピクセル化、ストレッチ、ミラー、変形、ディスプレイスメント |
| `fractal-noise` | フラクタルノイズ |
| `pixel-sort` | ピクセルソート |
| `blob-tracking` | ブロブ検出と追跡枠 |
| `buffer-stack` | フレームの蓄積（残像・長時間露光） |
| `genshade` | ReShade FX エフェクト（コンパイラーとテクスチャを同梱） |
| `easy` | ワンクリックのルック（他のエフェクトプラグインを組み合わせる） |

テスト（`test/unit/plugins`、`test/unit/util/pen-fx*.test.js`）は、隣に置いた shading-plugins の
チェックアウト（または環境変数 `SHADING_PLUGINS_DIR`）から公式プラグインを読み込んで実行します。

## 公式プラグインの一括インストール

`https://shading.app/install` で公式プラグインをまとめて検査・保存できます。
一覧の検査内容を確認し、作者を信頼するチェックを入れて「すべてを保存」を押してください。
保存は一つのIndexedDBトランザクションで行います。同じIDは更新・有効化し、それ以外のプラグインは維持します。
保存後にエディターを開くと、既存の読み込み処理が依存関係を解決して有効化します。

`npm run build` / `npm start` はNode.jsの `scripts/build-official-plugins.cjs` を実行し、
GitHubの `12zend/shading-plugins` のデフォルトブランチを一時フォルダーに浅くcloneします（Gitが必要です）。
直下の `shading-plugin.json` を持つ全フォルダーをZIP化し、SHA-256付きの一覧とともに
`build/official-plugins/` に20MiB以下の分割ファイルとして出力します（ブラウザで結合後に検証）。ZIP・プラグインソースは本体リポジトリにはコミットしません。
配信は同一オリジンの静的ファイルなので、実行時のGitHub APIやCORS設定は不要です。
新しい公式プラグインや更新の反映にはサイトの再ビルド・再デプロイが必要です。

ローカルのチェックアウトや固定コミットを使う場合は、
`SHADING_PLUGINS_DIR=/path/to/shading-plugins npm run build` を指定してください。
生成だけ行う場合は `npm run build:plugins` を使います。
Cloudflareの静的アセットは `/install` を生成済みの `install.html` に解決します。

# プラグインシステム 実装仕様

本書は、shading.app 本体に実装されたプラグインシステム（PR #5 / #6、`feature/plugin-system`）の**内部の仕組み**を
まとめた仕様書です。プラグイン作者向けの使い方（zip の作り方、API 一覧、例）は [PLUGINS.md](PLUGINS.md) を参照してください。
本書は本体側の実装を変更・レビューする人を対象にしています。

- 対象コード: `src/lib/plugins/`、`src/containers/plugin-host.jsx`、`src/containers/plugins-tab.jsx`、
  `src/components/plugin-*`、`src/playground/install.jsx`、`scripts/build-official-plugins.cjs`、
  および PenFX 側の `scratch-vm/src/lib/pen-fx/custom-shaders.js`、`scratch-render/src/pen-fx/engine.js`
- 公式プラグイン本体: 別リポジトリ [12zend/shading-plugins](https://github.com/12zend/shading-plugins)

## 1. 概要

| 項目 | 内容 |
| --- | --- |
| 配布形式 | zip（`shading-plugin.json` + CommonJS の `.js` + 任意の資源） |
| 実行モデル | サンドボックスなし。エディターと同じ JS コンテキストで `new Function` により評価 |
| 保存先 | ブラウザの IndexedDB（DB `shading-plugins` / store `plugins`）に zip のバイト列そのものを保存 |
| 信頼モデル | インストール前の静的検査 + ユーザー確認。公式プラグインは ECDSA P-256 署名で配布元を証明 |
| 読み込みタイミング | エディター起動時、プロジェクトの読み込みより前（`vm.deserializeProject` が待つ） |
| プロジェクトとの関係 | プラグイン本体はプロジェクトに含めず、依存関係だけを `shadingPlugins` キーに記録 |

### モジュール構成

```text
src/lib/plugins/
├── manager.js            ShadingPluginManager（中核。状態管理・レジストリ・プロジェクト連携）
├── archive.js            zip の読み込み・検証、manifest の正規化、アーカイブのハッシュ
├── security-scan.js      静的セキュリティ検査
├── signature.js          公式署名の検証（OFFICIAL_KEYS）
├── module-loader.js      zip 内 CommonJS モジュールの評価（require の実装）
├── api.js                プラグインに渡す API オブジェクト（require('shading')）と後始末
├── storage.js            IndexedDB / メモリの保存層
├── missing-blocks.js     未インストールプラグインのブロック用プレースホルダー
├── official-installer.js /install ページ用の公式プラグイン一括取得・検証・保存
├── legacy-plugin-opcodes.json  旧内蔵 Looks opcode → 公式プラグイン id の対応表
└── ui/                   プラグインから使う共通 UI（プリセットピッカー、サムネイル描画）
```

## 2. ライフサイクル全体

```text
[zip 選択] ─ inspect() ─► readPluginArchive ─► scanPlugin ─► verifyPluginSignature
                                   │                                     │
                                   └────────── review データ ◄───────────┘
                                                   │  ('review' イベント → 確認モーダル)
                                          ユーザーが承認
                                                   ▼
                          install() ─► storage.put(zip bytes, hash, scan 要約)
                                   ─► _createRecord ─► _activate
                                                          │
                              createPluginAPI + createModuleSystem
                                                          │
                                   require(main) ─► exports.activate(api)
                                                          │
                                 state: active（readyPromise は非同期読み込みの完了）

[次回起動] installPluginManager ─► init() ─► storage.list()
             ─► 各 zip を再検証（ハッシュ一致・署名再検証）─► _activateAll（依存順）
             ─► ready 解決 ─► vm.deserializeProject が続行
```

## 3. zip アーカイブ（`archive.js`）

`readPluginArchive(data, fileName)` は zip を展開・検証するだけで、中身は一切実行しません。

### 3.1 制限値

| 定数 | 値 | 意味 |
| --- | --- | --- |
| `MAX_ARCHIVE_BYTES` | 256 MB | zip 自体のサイズ |
| `MAX_EXPANDED_BYTES` | 768 MB | 展開後の合計サイズ（宣言値で事前チェック + 実展開中にも累積チェック） |
| `MAX_FILES` | 8000 | ファイル数 |
| `MAX_MANIFEST_BYTES` | 64 KB | `shading-plugin.json` のサイズ |

### 3.2 処理手順

1. ディレクトリと `__MACOSX/`、`.DS_Store`、`Thumbs.db` を除外。
2. ファイル数と、各エントリの**宣言上の**展開サイズ合計を検査（zip bomb を展開前に拒否）。
3. 各エントリ名を `normalizeEntryPath` で正規化。`\` → `/`、NUL 文字・絶対パス（`/…`、`C:/…`）・`..` を含む名前はエラー。
4. `shading-plugin.json` を探し、最も浅いものを採用。深さが 2 を超える（2 段以上のフォルダ内）場合はエラー。
   その親フォルダをプレフィックスとし、プレフィックス外のファイルは無視。
5. Unix パーミッションがシンボリックリンクのエントリは読まずに `symlinks` に記録（検査で「高」になる）。
6. 同じ相対パスが 2 回現れたらエラー。
7. manifest を JSON として解析し `normalizeManifest` で正規化。`main` のファイルが存在しなければエラー。
8. アーカイブ全体のハッシュを計算。

戻り値: `{manifest, files: Map<path, Uint8Array>, hash, size, expandedSize, fileName, symlinks, bytes}`

### 3.3 manifest の正規化

| フィールド | 規則 | 既定値 |
| --- | --- | --- |
| `format` | `"shading.app/plugin"` 必須 | — |
| `formatVersion` | `1` のみ | `1` |
| `id` | `/^[a-z0-9][a-z0-9-]{0,47}$/` | — |
| `name` | 文字列 ≤64 | `id` |
| `version` | 文字列 ≤32 | `"0.0.0"` |
| `description` / `author` / `license` / `homepage` | 文字列 ≤500 / 100 / 64 / 300 | `""` |
| `main` | パス正規化後、`.js` / `.cjs` | `"main.js"` |
| `permissions` | 下記の列挙値のみ。重複除去 | `[]` |
| `dependencies` / `recommends` | id の配列（≤64 件）。重複除去 | `[]` |
| `locales` | `{locale: {name, description}}`、最大 32 言語 | `{}` |

`permissions` の列挙値: `network` `storage` `dynamic-code` `wasm` `workers` `dom` `navigation` `clipboard` `media` `desktop`。
これは**申告**であり実行時の制限ではありません。検査結果との突き合わせ（未申告の表示）にのみ使います。

### 3.4 アーカイブのハッシュ

`hashArchive(bytes)` は WebCrypto が使えれば `sha256-<hex>`、使えない環境（非セキュアコンテキスト等）では
2 系統の FNV-1a 風ハッシュ `fnv1a-<16 hex>` を返します。このハッシュは「ユーザーが確認した zip そのもの」を識別する
ためのもので、保存時に記録し、起動時の改ざん検出に使います（§7.2）。

## 4. 静的セキュリティ検査（`security-scan.js`）

`scanPlugin(archive)` は全ファイルを正規表現ベースで検査します。偽装されたコードを検出できないことは前提で、
確認画面にもそう明記しています。

### 4.1 ファイル種別

| 種別 | 拡張子 | 適用されるルール |
| --- | --- | --- |
| `script` | `.js` `.cjs` `.mjs` | `files: 'script'` と `'text'` のルール + 難読化検査 |
| `markup` | `.html` `.htm` `.svg` `.xhtml` `.xml` | `'markup'` と `'text'` |
| `style` | `.css` | `'style'` と `'text'` |
| `other` | 上記以外 | `.json .txt .md .glsl .frag .vert .fx .fxh .csv` のみ `'text'` ルール。その他は読まない |

特別扱い:

- OS 実行ファイルの拡張子（`.exe` `.dll` `.sh` `.jar` `.node` など）→ `executable-file`（高）。中身は読まない。
- `.wasm` → `wasm-binary`（注意、permission `wasm`）。
- 16 MB 超またはバイナリに見えるファイルが script / markup の場合 → `unscannable`（注意）。
- シンボリックリンク → `symlink`（高）。

### 4.2 ルール

| 重大度 | ルール id（対応 permission） |
| --- | --- |
| 高 | `dynamic-code`(dynamic-code), `remote-code`(network), `script-injection`(dom), `markup-script`(dom), `credentials`, `navigation`(navigation), `desktop-bridge`(desktop), `global-hooks`, `service-worker`, `mining`, `executable-file`, `symlink` |
| 注意 | `network`(network), `external-url`(network), `browser-storage`(storage), `media-access`, `clipboard`, `wasm`, `workers`, `iframe`, `embedded-blob`, `escaped-code`, `wasm-binary`(wasm), `unscannable` |
| 低 | `window-messaging`, `html-injection`, `encoded-strings`, `css-import`, `minified` |

- `external-url` は w3.org、opensource.org、GitHub の blob/tree、creativecommons.org、spdx.org、shading.app を除外。
- 難読化検査（script のみ）: 20,000 文字超かつ 5,000 文字超の行 → `minified`、2,000 文字以上の Base64 風文字列 →
  `embedded-blob`、`\xNN` / `\uNNNN` が 200 個超かつ密度 0.5% 超 → `escaped-code`。
- 同じルール × ファイルは 1 件にまとめ、出現箇所は最大 20 件（行・列・抜粋付き）。

### 4.3 結果

```js
{
  level: 'none' | 'low' | 'medium' | 'high',   // 最も高い重大度
  findings: [...],                              // 重大度 → ルール → ファイル順
  summary: {high, medium, low},
  undeclaredPermissions: [...],                 // 検出されたが manifest に申告のない permission
  declaredPermissions: [...],
  files: [{path, size, kind}]
}
```

## 5. 公式署名（`signature.js`）

### 5.1 署名ファイル

公式プラグインはルートに `shading-plugin.sig`（JSON）を持ちます。

```json
{
  "format": "shading.app/plugin-signature",
  "version": 1,
  "algorithm": "ECDSA-P256-SHA256",
  "keyId": "official-2026",
  "signature": "<base64>"
}
```

### 5.2 署名対象（payload）

```text
shading.app/plugin-signature/1\n
<sha256 hex> <path>\n      ← shading-plugin.sig 以外の全ファイル、パスのバイト順ソート
...
```

- zip の構造ではなく**ファイル内容**に対する署名なので、どう zip 化しても検証できます。
- ファイルの変更・追加・削除のいずれでも無効になります。
- パスに制御文字（改行など）を含む場合は行の偽造を防ぐため検証失敗とします。

### 5.3 判定

| status | 条件 |
| --- | --- |
| `official` | `OFFICIAL_KEYS` の鍵で検証成功 |
| `unsigned` | 署名ファイルがない、または WebCrypto が使えない |
| `invalid` | JSON 不正、形式不明、未知の `keyId`、検証失敗 |

- 信頼する公開鍵は本体の `OFFICIAL_KEYS`（JWK）にハードコードされ、shading-plugins の `signing-keys.json` と一致させます。
  鍵の追加・失効は両方を更新します。
- 署名は起動時にも毎回検証し直します。保存済みレコードに判定結果は保存しません。
- `invalid` は確認モーダル側で「高」リスクとして扱われ、承認チェックが必須になります（`plugin-review-modal.jsx` の
  `highestLevel`）。**検査結果（`scan.level`）自体には反映されません。** また、起動時の再検証で `invalid` になっても
  読み込みは止めず、状態表示にのみ使います（ハッシュ不一致の場合は §7.2 のとおり読み込みません）。

## 6. モジュールローダー（`module-loader.js`）

`createModuleSystem({pluginId, files, api})` が zip 内のファイルから CommonJS を評価します。

- `require('shading')` → そのプラグイン専用の API オブジェクト。
- 相対・絶対（プラグインルート基準）パスのみ許可。bare specifier（npm パッケージ名等）はエラー。
  `..` でプラグイン外に出るとエラー。
- 解決候補: `path` → `path.js` → `path.json` → `path/index.js`。
- `.json` は `JSON.parse`、`.js` / `.cjs` は
  `new Function('module', 'exports', 'require', '__filename', '__dirname', source + sourceURL)` で評価。
  `//# sourceURL=shading-plugin://<id>/<path>` によって DevTools でファイルとして表示されます。
- モジュールはプラグインごとにキャッシュされ、循環 require は CommonJS と同様に部分的な `exports` を返します。
  評価中に例外が出たモジュールはキャッシュから外します。
- ネットワーク取得や `<script>` 要素は使いません（CSP を変更せずに済む）。

## 7. 保存（`storage.js`）

### 7.1 レコード形式

IndexedDB `shading-plugins`（version 1）の object store `plugins`（keyPath `id`）:

```js
{
  id: 'blur',
  data: ArrayBuffer,          // ユーザーが確認した zip のバイト列そのもの
  hash: 'sha256-…',           // 確認時のアーカイブハッシュ
  fileName: 'blur.zip',
  enabled: true,              // 次回起動時に読み込むか
  installedAt: 1790000000000, // 更新時も初回の値を維持
  scan: {level, summary, undeclaredPermissions}
}
```

- `list()` は `installedAt` の昇順。
- `putAll(records)` は 1 トランザクションで保存（/install の一括保存用）。
- IndexedDB がない環境では `MemoryPluginStorage`（セッション限り）にフォールバック。`MemoryPluginStorage` には
  `putAll` がありません（/install は IndexedDB を直接使うため現状は問題なし）。

### 7.2 起動時の再検証

`init()` は保存済みの各レコードについて:

1. `readPluginArchive(entry.data)` で再度展開・検証。
2. `entry.hash` と再計算したハッシュが異なれば `The stored plugin does not match the reviewed archive.` として
   `state: 'error'` にし、実行しません（保存領域の改ざん対策）。
3. 署名を再検証してレコードに付与。

読めなかったレコードも `state: 'error'` のダミーレコードとして一覧に残り、管理画面から削除できます。

## 8. プラグインマネージャー（`manager.js`）

### 8.1 取り付け

`src/containers/gui.jsx` の `componentDidMount` で `installShadingFeatures(vm)` の直後に
`installPluginManager(vm, {guiContext})` を呼びます。

- `vm.shadingPlugins` にマネージャーを保存（二重取り付けはしない）。
- コンストラクタ内で `installProjectHooks()`（§10）を実行し、`init()` で保存済みプラグインの読み込みを開始。
- `vm.emit('SHADING_PLUGINS_ATTACHED', manager)` を発行（先にマウントされた `PluginHost` が購読している）。
- `guiContext` は `{React, ReactDOM, components: {AssetPanel}, icons: {fileUpload}, downloadBlob}` を凍結したもので、
  `shading.gui.react` として公開。

### 8.2 レコードと状態

```text
            _activate()                activate() が同期で戻る
inactive ───────────────► loading ───────────────────────► active
   ▲                          │ 同期例外 / 依存不足              │
   │                          ▼                                │
   │                        error ◄── (install 時の依存解決で    │
   │                                   inactive に戻して再試行)  │
   └───────────────────── _deactivate() ◄──────────────────────┘
```

レコードの主なフィールド: `id, manifest, files, hash, size, scan, signature, enabled, installedAt, fileName,
state, error, dispose, exports, readyPromise, stored`。

- `enabled` は「起動時に読み込むか」の保存値、`state` は現在の実行状態で、両者は独立です。
- `getPlugins(locale)` の `pendingReload` は `enabled` と実行状態が食い違っている（再読み込みで変わる）ことを示します。

### 8.3 有効化（`_activate`）

1. 既に `active` / `loading` なら何もしない。
2. `manifest.dependencies` のうち未有効化で `enabled` なものを先に `_activate`。それでも不足があれば
   `state: 'error'`、`error: 'Requires plugin: …'`。
3. `createPluginAPI(manager, record)` で API と `dispose` を作成。
4. `createModuleSystem` で `./<main>` を require。エクスポートが関数ならそれを、そうでなければ `exports.activate` を
   `activate(api)` として呼ぶ。
5. 同期例外 → `dispose()` で途中までの登録を取り消し、`state: 'error'`。
6. 同期で戻った時点で `state: 'active'`（ブロックはすぐ使える）。戻り値の Promise は `readyPromise` になり、
   - 解決 → `_afterActivation`（§10.3 の不足プラグイン解消）
   - 拒否 → `error` を記録するが `active` のまま。同期部分の登録は維持される。

`_activateAll()` は全レコードを依存先優先の DFS で並べ、`enabled` かつ `error` でないものを有効化し、
全 `readyPromise` を待ちます。依存の循環は `visiting` 集合で打ち切られ、循環の片側が「依存不足」で失敗します。

### 8.4 無効化（`_deactivate`）

1. `exports.deactivate()` を呼ぶ（例外はログのみ）。
2. `dispose()` で API 経由の登録をすべて逆順に取り消し、blob URL を revoke。
3. `state: 'inactive'`。
4. このプラグインに依存する他のプラグインも再帰的に無効化。

### 8.5 インストール・更新・削除

| メソッド | 動作 |
| --- | --- |
| `inspect(file)` | zip 読み込み + 検査 + 署名検証。何も実行しない。`existing: {version, sameArchive}` を付ける |
| `install(review)` | 同じ id があれば無効化して置換。`storage.put` 後に有効化。`installedAt` は引き継ぐ。保存に失敗してもセッション中は動作する。この id を待って `error` だったプラグインを再有効化 |
| `installAll(reviews)` | 依存先優先で順に `install`。失敗しても残りを続け `{installed, failed}` を返す |
| `loadArchive(archive)` | 確認・保存なしでセッション限りに有効化（テストや組み込み用） |
| `setLoadOnStartup(ids, enabled)` | 保存値だけ変更。実行中のプラグインには触れない（Plugins タブが使用） |
| `setEnabled(id, enabled)` | 保存値を変更し、即時に有効化／無効化 |
| `uninstall(id)` | 無効化してレコードと保存データを削除 |

### 8.6 イベント

| イベント | 発行元 | 主な購読者 |
| --- | --- | --- |
| `changed` | 状態変化全般 | Plugins タブ |
| `review` / `reviewLoading` / `reviewError` / `reviewClosed` | `requestReview` ほか | `PluginHost`（確認モーダル・トースト） |
| `openManager` | メニュー「編集 → プラグイン…」 | `PluginHost`（Plugins タブを開く） |
| `missingPlugins` | プロジェクト読み込み後・不足解消時 | `PluginHost`（タブを開く）、Plugins タブ |
| `tabsChanged` | `addTab` / 取り消し | `containers/gui.jsx` |
| `menuChanged` | `addMenuItem` / 取り消し | Plugins タブ |
| `toolboxChanged`（+ VM の `SHADING_PLUGINS_TOOLBOX_CHANGED`） | ツールボックスフィルター変更 | `containers/blocks.jsx` |
| `notify` | `shading.gui.notify` | `PluginHost`（6 秒のトースト） |

## 9. プラグイン API と登録の仕組み（`api.js`）

API 一覧は [PLUGINS.md](PLUGINS.md#apishading) にあります。ここでは実装上の約束を記します。

### 9.1 共通規則

- `createPluginAPI` は API オブジェクト（`Object.freeze` 済み、`apiVersion: 1`）と `dispose` を返します。
- 登録系 API は `assertActive()` で無効化後の呼び出しを拒否し、戻り値の取り消し関数を `track()` で記録します。
  `dispose` 後に `track` されたものは即座に取り消されます。
- プラグインが戻り値の取り消し関数を自分で呼んでもよく、各取り消し関数は二重実行に耐えます。
- `files.url(path)` の blob URL は無効化時にまとめて revoke。MIME は拡張子から推定。
- `runWithoutWaiting(promise)` は `runtime.movieAssetManager.runWithoutWaiting` に委譲（なければ catch だけ付ける）。
  AGENTS.md の「ブロックは Promise を VM に返さない」規則のための入口です。

### 9.2 レジストリ別の仕組み

| API | 登録先 | 取り消し時の挙動 |
| --- | --- | --- |
| `penfx.registerProgram` | engine の `programRegistry`（名前ごとのスタック）。コアのプログラム名は予約 | スタックから外し、稼働中エンジンに直前の登録（またはなし）を同期 |
| `penfx.extendEngine` | 全 PenFX Engine クラス（後から作られるものも含む）の prototype | 後から登録された同名メソッドがあればそれを、なければ元の値に戻す |
| `penfx.extendPenFX` | PenFX インスタンスの prototype。名前ごとのスタックを `manager.penFXMethods` で管理 | スタックの次を戻すか削除。**本体の既存メソッドは上書き不可** |
| `penfx.registerBlocks` | `customShaders.registerPluginPackage`（`pluginPackages`）。`file` 指定の GLSL は zip から読み込む | パッケージを外して Looks を再構築 |
| `penfx.addToolbox` | `customShaders.addToolboxContribution` | 同上 |
| `extensions.register` | 拡張プロキシ（§9.3） | プロキシの委譲先を外し、カテゴリを空にする |
| `blocks.define` | `manager.blockDefiners`（カテゴリ id ごと） | カテゴリを再定義 |
| `blocks.filterToolboxXML` | `manager.toolboxFilters` | ツールボックス再構築 |
| `gui.addTab` / `addMenuItem` | `manager.tabs` / `menuItems` | 一覧から外してイベント発行 |
| `gui.addStyle` | `<style data-shading-plugin="id">` を `<head>` に追加 | 要素を削除 |
| `project.registerData` / `onLoad` | `manager.projectData` / `loadListeners` | §10.2 の orphan データとして値を保持 |

`extendPenFX` / `extendEngine` は `{name: fn}` のオブジェクトか、`install({PenFX, vm})` / `install({Engine})` 形式の
関数を受け取ります。関数形式には記録用のダミー `prototype` を渡し、代入されたメソッドを回収してから登録します。

### 9.3 独自カテゴリの拡張プロキシ

`extensions.register` はプラグインの拡張オブジェクトを直接 VM に登録せず、**id ごとに 1 つのプロキシ**を
`extensionManager.addBuiltinExtension` + `loadExtensionIdSync` で登録し、そこへ委譲します。

- プロキシは VM に登録されたまま残り、無効化時は委譲先を外すだけ。`getInfo()` は
  `{id, name: '<名前> (plugin disabled)', blocks: [], menus: {}}` を返します。
- 一度見たブロック関数名・動的メニュー関数名は覚えておき、委譲先がない間は `() => null` を返します（実行中の
  スクリプトが例外で止まらない）。未知のプロパティは `undefined`（dispatch が `isRemote` を worker と誤認しないため）。
- 拡張 id は英数字のみ。本体や他の拡張が使っている id、別プラグインが登録中の id はエラー。
- プロジェクトが要求するプラグインが無い場合も、`shadingPlugins[].extensions` からプロキシを先に作り、ブロックの
  デシリアライズが失敗しないようにします。

### 9.4 GUI との接続点

- `containers/blocks.jsx`
  - カテゴリのブロック定義後に `plugins.defineBlocks(categoryId, ScratchBlocks, {locale, vm})` を呼ぶ。
  - ツールボックス XML 生成時に各カテゴリへ `plugins.filterToolboxXML` を適用。
  - `SHADING_PLUGINS_TOOLBOX_CHANGED` でツールボックスを再要求。`penfx` とプラグインのカテゴリは
    `blocksInfoUpdate` 時に強制再構築。
  - ワークスペース XML の読み込み前に `defineMissingBlockPlaceholders`（§10.4）。
- `components/gui/gui.jsx`: `PluginHost` を常時マウント。プラグインタブは組み込みタブの後ろ
  （`PLUGIN_TABS_START_INDEX = 8`、Plugins タブ自体は `PLUGINS_TAB_INDEX = 7`）に並び、表示中のものだけ
  `PluginTabPanel` をマウント。`component` は `{vm, locale}` を props に、`mount(container, {vm, locale})` は
  戻り値をクリーンアップ関数として扱います。エラーはタブ内に表示し、エディター全体には波及させません。
- `containers/gui.jsx`: タブが消えて選択中インデックスが範囲外になったらコードタブへ戻す。コードエリア左下の
  追加ボタンは `openImportPicker()`（旧拡張機能ライブラリは削除済み）。
- `menu-bar.jsx`: 「編集 → プラグイン…」で `openManager()`。

## 10. プロジェクトとの連携

`installProjectHooks()` が `vm.toJSON` と `vm.deserializeProject` をラップします。

### 10.1 保存（`vm.toJSON`）

プロジェクト全体の保存時（`targetId` なし）:

1. 各 `registerData` の `serialize()` の戻り値を `project[key]` に書く（`undefined` ならキーを削除）。
2. orphan データ（§10.2）をそのまま書き戻す。
3. `collectReferences(project)` で依存プラグインを求め、`project.shadingPlugins` に書く（空なら削除）。
4. 変更があれば `markMovieProject` で `movie` 形式情報を更新（`shadingPlugins` があると feature `plugins` が付く）。

スプライト単体の書き出し（`targetId` あり）では 1〜2 を行わず、参照の記録だけ行います。

`shadingPlugins` の要素:

```json
{"id": "blur", "name": "Blur", "version": "1.0.0", "dataKeys": [], "extensions": []}
```

参照と判定する条件:

- プロジェクト内の `penfx_<name>` opcode が、プラグインの `extendPenFX` メソッド（スタック最上位の所有者）または
  `registerBlocks` のパッケージに属する。
- `<拡張id>_` で始まる opcode があり、その拡張プロキシの所有者がプラグイン（→ `extensions` に記録）。
- `registerData` のキーがプロジェクトに存在する（→ `dataKeys` に記録）。
- 読み込み時に記録されていて、まだ有効化されていないプラグインの参照は保存し直しても消さない。

`RESERVED_PROJECT_KEYS`（`targets` `monitors` `extensions` `extensionURLs` `extensionStorage` `meta` `customFonts`
`shadingPlugins` `penFXShaders` `movie` `movieAssets` `movieTimeline` `timeline`）と `movie` で始まるキーは
プラグインデータに使えません。キーは `/^[A-Za-z][A-Za-z0-9_]{1,63}$/`、1 キーにつき 1 プラグイン。

### 10.2 orphan データ

プラグインが無い・無効な状態でもプロジェクト内のデータを失わないための仕組みです。

- 読み込み時、`shadingPlugins[].dataKeys` のうち登録者のいないキーの値を `orphanData` に保持し、保存時にそのまま書き戻す。
- `registerData` の取り消し時は、その時点の `serialize()` 結果を `orphanData` に移す。
- 後から同じキーが `registerData` されたら、保持していた値で `deserialize` して引き渡す。

### 10.3 読み込み（`vm.deserializeProject`）

1. `await manager.ready`（起動時の全プラグイン有効化を待つ）。
2. `orphanData` をクリアし、`shadingPlugins` を `projectReferences` として記録。
3. 未有効化の参照を「不足プラグイン」とし、その `extensions` のプロキシを用意。
4. **旧プロジェクト対応**: 本体にもプラグインにも無い `penfx_*` opcode（`penfx_menu_*`、`shader_*`、本体の PenFX
   メソッドは除く）を `legacy-plugin-opcodes.json` で所有プラグインに対応付け、不足プラグインに加える
   （`^gs[a-z0-9]+$` は `genshade`、対応が無いものは id `unknown`）。
5. 登録済みの `deserialize(project[key])` と `onLoad(projectJSON)` をすべて並行実行して待つ（例外はログのみ）。
6. 元の `deserializeProject` を実行し、`missingPlugins` イベントを発行（`PluginHost` が Plugins タブを開く）。

不足していたプラグインが後からインストールされると、`_afterActivation` が不足リストから外し、PenFX の
再構築完了後に `vm.emitWorkspaceUpdate()` でワークスペースを再読み込みします（プレースホルダーが本物のブロックに戻る）。

### 10.4 未知ブロックのプレースホルダー（`missing-blocks.js`）

scratch-blocks は定義の無いブロック型があるとワークスペース全体の読み込みを中断するため、XML 読み込み前に
未知の型ごとに灰色のプレースホルダー定義を `ScratchBlocks.Blocks[type]` に作ります。

- XML から `value` / `statement` / `field` の名前を集め、同じ入力・フィールド構成で定義（値はそのまま保持・保存される）。
- `shadow` または `value` 内にあればレポーター形、そうでなければスタック形。
- ラベルは `⚠ <opcode のカテゴリ接頭辞を除いた部分>`、定義に `shadingPlaceholder: true` を付与。

## 11. UI

### 11.1 インストール確認モーダル（`plugin-review-modal.jsx`）

- `requestReview(files)` が複数 zip をまとめて `inspect` し、読めたものを `review` イベントで渡す。同じ id が複数
  あれば最後に選んだものを採用。読めなかったものは `errors` として一緒に表示（全滅時は `reviewError`）。
- 各プラグインのチェックを外して除外できる。
- 選択中のうち最も高いリスク（署名 `invalid` は「高」扱い）が「高」の場合、「リスクを理解し、作者を信頼します」の
  チェックが必須。
- ファイル選択ダイアログのダブルクリックで誤って確定しないよう、表示から 750ms はボタンを無効化。
- 承認で `confirmReview(ids)` → `installAll`。結果はトーストで表示。

### 11.2 Plugins タブ（`plugins-tab.jsx`）

- 一覧（状態、署名、検査レベル、依存、未導入の推奨プラグイン、エラー）、削除、プラグインのメニュー項目、不足プラグイン。
- オン／オフと「すべてオン／オフ」は `setLoadOnStartup`（次回起動時に反映）。`pendingReload` があれば
  「今すぐ再読み込み」を表示し、未保存の変更がある場合は確認してから `location.reload()`。
- 削除は確認ダイアログの後 `uninstall`。ブロックはプロジェクト内に残る（§10.4）。

## 12. 公式プラグインの配布と一括インストール

### 12.1 ビルド（`scripts/build-official-plugins.cjs`）

`npm run build` / `npm start`（`prestart`）/ `npm run build:plugins` で実行。

1. `SHADING_PLUGINS_DIR` が無ければ `12zend/shading-plugins` を一時フォルダに `git clone --depth 1`。
2. 直下の `shading-plugin.json` を持つフォルダごとに:
   - id の形式と重複を検査。`shading-plugin.sig` が無ければ**ビルド失敗**（/install は署名必須のため）。
   - シンボリックリンクがあれば失敗。`.DS_Store` / `__MACOSX` を除外。
   - 日付を 2000-01-01 に固定して DEFLATE で zip 化（再現性のため）し、SHA-256 を計算。
   - Cloudflare 静的アセットの上限に合わせ 20 MiB ごとに `<id>.zip.part<N>` に分割。
3. `build/official-plugins/catalog.json` に `[{id, name, version, fileName, hash, parts}]` を出力。

プラグインのソースや zip は本体リポジトリにコミットしません。

### 12.2 /install ページ（`src/playground/install.jsx`、`official-installer.js`）

webpack の別エントリ `install`（`install.html`）。開発サーバーと Cloudflare では `/install` をこれに解決します。

`prepareOfficialPlugins(fetch)`:

1. `/official-plugins/catalog.json` を `cache: 'no-store'` で取得。
2. 各エントリの id 形式・重複・`fileName === <id>.zip`・`parts` の命名と数（≤13）を検証。
3. 分割ファイルを取得して結合（合計 256 MB まで）し `readPluginArchive`。
4. manifest の id とアーカイブハッシュがカタログと一致することを確認。
5. カタログと zip は同じサーバーから来るため、**有効な公式署名（`official`）が無いものは拒否**。
6. 検査結果を付けて返す。

ユーザーが「作者を信頼する」にチェックして保存すると、`saveOfficialPlugins` が `putAll` で 1 トランザクションに保存
（同じ id は更新して `enabled: true`、`installedAt` は維持、他のプラグインはそのまま）。有効化は行わず、次に
エディターを開いたときの `init()` が依存順に有効化します。

## 13. PenFX 側の受け口

エフェクトを本体から取り除いたため、PenFX に次の受け口が追加されています。

- `scratch-render/src/pen-fx/engine.js`
  - `registerEngineProgram(name, glsl, {boundsPadding})`: 名前付き fragment program を登録。`boundsPadding` は
    近傍だけを読むプログラムの余白（グループ化されたエフェクトを描画範囲内だけで処理するため）。
  - `registerEngineExtension({methods, onResize})`: 既存・将来の全 Engine クラスにメソッドを追加。
    `onResize` は作業バッファ再作成時に呼ばれる。
- `scratch-vm/src/lib/pen-fx/custom-shaders.js`
  - `registerPluginPackage(package, options)`: `shading.app/penfx-shader` 形式のパッケージを信頼済み（`trusted`）として
    Looks カテゴリに追加。`order`、`label`、`menuNamespace`（旧メニュー名 `penfx_menu_shader_penfx_builtins_*` の維持）、
    `translations`、`legacyMenus`、`menus`、`before` / `after` を受け付ける。opcode の衝突やプロジェクト内カスタム
    シェーダーとの id 衝突はエラー。
  - `addToolboxContribution({id, order, label, blocks, menus})`: 任意のブロック定義を Looks に追加。
  - `getPluginOpcodes()`: プラグイン id → 提供 opcode（`penfx_` なし）。参照の収集と旧 opcode 判定に使用。

## 14. テスト

| ファイル | 内容 |
| --- | --- |
| `test/unit/plugins/plugin-archive.test.js` | zip 検証、パス、manifest |
| `test/unit/plugins/plugin-security-scan.test.js` | 検査ルール |
| `test/unit/plugins/plugin-signature.test.js` | 署名の成功・改ざん・未知の鍵 |
| `test/unit/plugins/plugin-manager.test.js` | 有効化・依存・無効化、プロジェクトの保存／読み込み、orphan データ、不足プラグイン |
| `test/unit/plugins/official-installer.test.js` | カタログ検証、分割結合、署名必須 |
| `test/unit/plugins/official-plugins.test.js` | 公式プラグインの読み込み |
| `test/unit/util/pen-fx*.test.js` | 各エフェクト（公式プラグインを読み込んで実行） |

`test/helpers/official-plugins.js` が隣の `../shading-plugins`（または `SHADING_PLUGINS_DIR`）から公式プラグインを
読み込みます。Genshade のコンパイラーとテクスチャは実ブラウザが必要なため、ブロックと設定のみテストします。

## 15. 既知の制約・注意点

- **サンドボックスが無い**: プラグインは `window`、VM、レンダラー、IndexedDB（他プラグインの保存データを含む）に
  自由にアクセスできます。検査・署名・確認はリスクの提示であり、隔離ではありません。
- **permissions は強制されない**: 申告と検査結果の突き合わせのみです。
- **署名 `invalid` の扱いは UI 依存**: 確認モーダルでは「高」扱いですが、`scan.level` と起動時の読み込み可否には
  影響しません。
- **ハッシュのフォールバック**: WebCrypto の無い環境では FNV ベースのハッシュになり、改ざん検出は衝突耐性を持ちません
  （署名も `unsigned` 扱いになります）。
- **有効／無効の切り替えは再読み込み後に反映**（Plugins タブ）。実行中のプロジェクトからブロックが途中で消えるのを
  避けるためです。即時切り替えの `setEnabled` は API としてのみ存在します。
- **非同期読み込みの失敗**: `activate` が返した Promise が拒否されても、同期部分の登録は残り `active` のままです
  （`error` にメッセージが入る）。
- **拡張プロキシは解除されない**: 一度登録されたカテゴリ id は、セッション中 VM に（空のカテゴリとして）残ります。
- **ブロックの実行規則**: AGENTS.md のブロック規則（Promise を返さない、render ループ内で途中フレームを出さない、
  作成系ブロックの冪等性など）はプラグインのブロックにも適用されます。
- 旧 Looks opcode と `penfx_menu_shader_penfx_builtins_*` のメニュー名は保存済みプロジェクトが参照しているため、
  変更しないでください。`legacy-plugin-opcodes.json` は shading-plugins から生成されたものです。

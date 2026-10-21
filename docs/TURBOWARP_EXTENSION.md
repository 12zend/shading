# TurboWarp 拡張機能としてのビルド

shading.app 全体を 1 つの JavaScript ファイルにまとめ、TurboWarp のカスタム拡張機能として読み込めるようにします。
読み込むと TurboWarp のページが shading.app のエディターに置き換わります。

## ビルド

```bash
npm run build:extension
```

`build-extension/shading-app.js` ができます。公式プラグインも同梱されます（`SHADING_PLUGINS_DIR` か `../shading-plugins`、
なければ `build/official-plugins`、それもなければ shading-plugins を clone して使います）。

- `--no-official-plugins`：公式プラグインを同梱しない
- `--exclude-plugins=genshade,lut`：指定したプラグインを除く（genshade だけで約 57 MiB あります）

```bash
npm run build:extension -- --exclude-plugins=genshade
```

## 使い方

1. TurboWarp のエディターで「拡張機能を追加」→「カスタム拡張機能」を開く
2. 「ファイル」タブで `shading-app.js` を選ぶ
3. 「サンドボックスなしで実行する」にチェックを入れて「読み込む」

サンドボックスありで読み込んだ場合は、ブロックパレットに注意書きが出るだけで何もしません（URL タブから読み込むと常にサンドボックスになります）。
TurboWarp のタブを再読み込みすると TurboWarp に戻ります。そのときは拡張機能をもう一度読み込んでください。

## 仕組み

- `webpack.config.js` の `BUILD_MODE=extension`：エディター・プラグインインストーラー・アドオン設定の 3 ページを
  1 つのスクリプト（`src/playground/extension.jsx`）にまとめ、画像・フォント・WebAssembly・Worker もすべて埋め込みます。
  `process.env.SHADING_EXTENSION` が `true` になり、iframe 内でも「埋め込み不可」画面を出さず、URL を書き換えない `static` ルーターを使います。
- `scripts/extension/host.js`：TurboWarp のページで動く拡張機能本体。TurboWarp の VM を止めて画面を隠し、
  blob: URL の iframe で shading.app を開きます。iframe は turbowarp.org と同じオリジンですが、独立した JavaScript 環境です。
  新しいタブで開くページ（プラグインインストーラー、アドオン設定）はエディターの上に重ねて表示します。
- `scripts/extension/preamble.js`：各ページの最初に実行され、
  - localStorage / sessionStorage / IndexedDB / BroadcastChannel の名前に `shading.app:` を付け、TurboWarp 自身の設定やデータと混ざらないようにします。
  - blob: URL では相対パスを解決できないため、ブロックの画像や公式プラグインなどの静的ファイルをメモリから返します
    （`fetch`、`XMLHttpRequest`、`src` / `href` 属性、`Audio`、スタイルシートの `url()`）。
  - サイト内ページへのリンクと `window.open` を host.js に渡します。

保存したプロジェクトやインストールしたプラグインは turbowarp.org のブラウザストレージに保存され、shading.app 本体とは共有されません。

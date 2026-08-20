# Cloudflare 共同編集の構成

Shading は静的アセットを Cloudflare Workers Static Assets から配信し、共同編集だけを Durable Objects の WebSocket で同期します。常駐サーバー、独自DB、OSの管理は不要です。

## 構成

- URL: `https://shading.app/<team_id>`
- 静的GUI: Workers Static Assets の `build/`
- リアルタイム同期: `TEAM_ROOMS` Durable Object（チームIDごとに1インスタンス）
- 永続データ: メンバー、チャット、メモ、変更履歴、同期用プロジェクトコピー
- 認可: チームを作成したタブだけが初回管理者としてチームを確定できる。以後は管理者が発行する1回限りの招待URLが必要

新規チームのURLは、ブラウザー内で作る256-bitの作成シークレットからSHA-256で導出します。サーバーは最初のWebSocket接続時に作成シークレットとチームIDの対応を検証するため、推測した未使用パスを先に開いただけでは管理者になれません。作成シークレットはチーム確定後に破棄します。

チームIDのパス自体はパスワードではありません。以後の権限は、招待トークンとブラウザーごとの参加トークンで検証します。招待トークンはURLフラグメントに置かれるため、HTTPリクエスト、アクセスログ、Refererには送信されません。サーバーにはSHA-256ハッシュだけを保存し、有効期限は7日、使用後は直ちに削除します。また、新しく招待された参加者には、保存済みの古いコピーではなく、オンライン中の管理者から取得した最新プロジェクトだけを初回同期します。同期が終わるまではブロック編集を拒否します。

## デプロイ

1. Cloudflare にログインします。

   ```sh
   npx wrangler login
   ```

2. 本番ビルドとデプロイを実行します。

   ```sh
   npm run deploy:cloudflare
   ```

`cloudflare/wrangler.jsonc` が、静的アセット、Durable Object、SQLiteストレージ、`shading.app/*` のルートをまとめて設定します。初回デプロイ時に `TeamRoom` が自動作成されます。

### Git連携（Workers Builds）

この構成はPages単体ではなく、Durable Objectsを持つWorkersプロジェクトとして接続してください。Workers & Pages > Create > Import a repository で、次を設定します。

| 項目 | 値 |
| --- | --- |
| Root directory | `/`（リポジトリ直下） |
| Build command | `npm run build:cloudflare` |
| Deploy command | `npx wrangler deploy --config cloudflare/wrangler.jsonc` |
| Non-production deploy command | `npx wrangler versions upload --config cloudflare/wrangler.jsonc` |
| Node.js | `.node-version` により `22.16.0` |

ビルドコマンドに `npm run deploy:cloudflare` を入れないでください。これはローカル向けに「ビルド＋デプロイ」を連続実行するスクリプトなので、Workers Buildsではデプロイが二重になります。Wranglerは`package.json`と`package-lock.json`で`4.121.0`に固定しています。

Cloudflare Pagesへ静的部分だけを置く場合の設定値は Build command `npm run build:cloudflare`、Build output directory `build` ですが、それだけではWebSocketとDurable Objectsが動きません。本番は上記のWorkers Builds構成を使用してください。

ローカルで Worker を含めて確認する場合は、通常の開発サーバーを停止してから次を実行します。ビルド後、Wranglerが `http://localhost:8601` で静的GUIとDurable Objectの両方を起動します。

```sh
npm run start:cloudflare
```

通常の `npm start`（ポート8601）はGUIだけを配信し、共同編集サーバーは起動しません。別タブとの同期確認には必ず `npm run start:cloudflare` を使用してください。2人目は同じチームURLを複製するのではなく、管理者が「メンバー招待」または「閲覧者招待」で発行したURLを別タブで開きます。招待URLから参加したタブにはタブ単位の参加情報を保存するため、同じブラウザーでも別の役割を確認できます。

## Cloudflare ダッシュボード設定

### DNS とルート

1. `shading.app` を Cloudflare のゾーンとして追加します。
2. DNS レコードをプロキシ有効（オレンジの雲）にします。
3. Workers & Pages で `shading-app` を開き、Custom Domains に `shading.app` が表示されることを確認します。
4. Pages の別プロジェクトを同じホスト名へ割り当てないでください。SPA配信もこの Worker が担当します。

### セキュリティ

- SSL/TLS モード: `Full (strict)`
- Edge Certificates: `Always Use HTTPS` を有効
- TLS: 最小バージョン `1.2`、可能なら `1.3` を有効
- Security > WAF: Cloudflare Managed Rules を有効
- Bot対策: 利用プランに応じて Bot Fight Mode または Super Bot Fight Mode を有効
- Rate limiting rule: `http.request.uri.path matches "^/api/teams/"` を対象に、同一IPから10秒間に30回を超える新規接続を Managed Challenge または Block
- Cache rule: `/api/*` はキャッシュしない。`/js/pentapod/*` は長期キャッシュ可能

WebSocket接続後の操作には、Worker内でも接続単位で1分240メッセージの制限、31 MiBの同期コピー上限、1 MiBの変更イベント上限を設けています。

### 環境変数

本番の `ALLOWED_ORIGINS` は原則として次だけにします。

```text
https://shading.app
```

リポジトリの既定値は本番オリジンだけです。`npm run start:cloudflare` はWranglerがローカルでWebSocketへ付ける `http://shading.app` をコマンドライン変数で一時的に許可しますが、この値は本番設定には保存されません。通常のlocalhostオリジンもローカル開発用としてWorkerが許可します。プレビュー用ホストを使う場合だけ、その完全なオリジンを追加します。ワイルドカードは使わないでください。

## 運用上の注意

- 管理者を渡す前に、相手が「メンバー」であることを確認してください。移譲後、元の管理者はメンバーになります。
- URLを知るだけでは既存チームへ参加できません。ただし招待URLは権限を付与するため、公開場所へ貼らないでください。
- チャットとプロジェクトコピーはエンドツーエンド暗号化ではありません。Cloudflare側で保存される内容を完全に秘匿する用途には使わないでください。
- Durable Objectの保存量とリクエスト数にはCloudflareプランの上限があります。大規模プロジェクトでは利用量を監視してください。

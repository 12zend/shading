# エンジンのバージョン管理

shading.app のエディター（エンジン）のリリースは、リポジトリ直下の `engine-versions.json` に一覧として記録します。

```json
{
  "current": "1.0.0",
  "versions": [
    {
      "version": "1.0.0",
      "name": "Shading 1.0.0",
      "commit": "<そのバージョンのエンジンをビルドするコミット ID（40 桁）>",
      "date": "2026-10-21"
    }
  ]
}
```

- `current`：このコミットのエンジンのバージョン。保存した `.shade` ファイルの `project.json` に `"shading": {"version": ...}` として書き込まれます。
  `scratch-vm/src/lib/project-format.js` の `SHADING_PROJECT_VERSION` と同じ値にしてください（ユニットテストで確認しています）。
- `versions`：これまでのバージョンとコミット ID の一覧。`name` はエンジンを切り替える確認ダイアログに出る表示名です。

## エンジンの切り替え

- 最新のエンジンはサイトのルート（`ROOT`）、古いエンジンは `ROOT/engines/<version>/` で公開します。
- ファイルを開くと、まず `.shade` のバージョンを読みます（バージョンのない古い `.shade` は 1.0.0）。
  開いているエンジンと違うバージョンで、そのエンジンが一覧にあれば、そのエンジンで開くか確認します。
  「キャンセル」を選ぶと今のエンジンで開きます（保存すると今のバージョンになります）。
- ファイルは IndexedDB（`shading-engine-handoff`）に一時保存して、`?engine_handoff=<id>` 付きでそのエンジンのページへ移ります。
  受け取ったエンジンはファイルを取り出して削除し、タイトルと保存先（File System Access API のハンドル）も引き継ぎます。
- 古いエンジンもサイトルートの `engine-versions.json` を読むので、新しいバージョンのファイルを開くと最新のエンジンへ移ります。
- 同じオリジンなので、設定・プラグイン・復元ポイントはすべてのエンジンで共有されます。
- TurboWarp 拡張機能版と `file://` で開いたページでは切り替えません（切り替え先のページがないため）。

## 新しいバージョンを出すとき

1. 今のバージョン（例: 1.0.0）の最後のコミット ID を、`versions` の 1.0.0 の `commit` に書きます。
2. `versions` に新しいバージョン（例: 1.1.0）を追加し、`current` と `SHADING_PROJECT_VERSION` を 1.1.0 にします。
   新しいバージョンの `commit` は、そのバージョンを出したコミットにしておき、次のリリースのときに最後のコミットに更新します。
3. `npm run build` のあとに同じ `ROOT` で `npm run build:engines` を実行すると、古いバージョンがそれぞれのコミットから
   `build/engines/<version>/` にビルドされます（`npm run build:cloudflare` と GitHub Pages のデプロイは自動で実行します）。
   - コミットは `.engine-cache/<commit>/` に git worktree として取り出し、`npm ci` してビルドします（2 回目からは再利用）。
   - `--only=1.0.0` で一部だけビルドできます。
   - エンジン切り替えの受け取り処理（`src/lib/engine-handoff.js`）がないコミットや、`current` が一覧と食い違うコミットはエラーになります。

## 互換性

- `.sb3` / `.sb2` / `.sb` / `.mb3` は開けません。
- メジャーバージョンが今のエンジンより新しいファイルは、そのバージョンのエンジンが一覧にない限り開けません。

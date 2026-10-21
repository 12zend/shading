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

機能（`feat` コミット）を追加した作業の最後に、新しいバージョンを出します（バグ修正だけのときは出しません）。

1. 機能を `feat(...)` としてコミットしたあと、`npm run release:engine` を実行します（`-- --dry-run` で書き込まずに確認できます）。
   - 今のバージョン（例: 1.0.0）の `commit` を、そのバージョンの最後のコミット（一覧が最後に変わってから最初の `feat` コミットの親）にします。
   - `versions` の末尾に新しいバージョン（既定は次のマイナー、例: 1.1.0）を、最新の `feat` コミットとその日付で追加します。
   - `current` と `SHADING_PROJECT_VERSION` を新しいバージョンにします。
   - バージョンは `npm run release:engine -- 2.0.0`、表示名は `--name=...`、コミットは `--base=` / `--commit=` で指定できます。
   - そのバージョンのエンジンとしてビルドできないコミット（`current` が違う、`src/lib/engine-handoff.js` がない）は拒否します。
2. `engine-versions.json` と `scratch-vm/src/lib/project-format.js` だけを `chore(engine): release Shading 1.1.0` としてコミットします。
   新しいバージョンの `commit` は、次のリリースのときにそのバージョンの最後のコミットに更新されます。
3. `npm run build` のあとに同じ `ROOT` で `npm run build:engines` を実行すると、古いバージョンがそれぞれのコミットから
   `build/engines/<version>/` にビルドされます（`npm run build:cloudflare` と GitHub Pages のデプロイは自動で実行します）。
   - コミットは `.engine-cache/<commit>/` に git worktree として取り出し、`npm ci` してビルドします（2 回目からは再利用）。
   - `--only=1.0.0` で一部だけビルドできます。
   - エンジン切り替えの受け取り処理（`src/lib/engine-handoff.js`）がないコミットや、`current` が一覧と食い違うコミットはエラーになります。

## 互換性

- `.sb3` / `.sb2` / `.sb` / `.mb3` は開けません。
- メジャーバージョンが今のエンジンより新しいファイルは、そのバージョンのエンジンが一覧にない限り開けません。

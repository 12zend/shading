# 時間評価モデルとシミュレーション

Shading 1.11.0 で入った時間の扱いの設計メモです。仕様の正は [SHADING_SPECIFICATION.md](SHADING_SPECIFICATION.md) の
「時間コンテキスト」「時間軸エフェクト」「シミュレーション」の章で、ここでは考え方と実装の対応をまとめます。

## 不変条件

> フレーム N の画像は、プロジェクト・素材・N・fps・解像度だけで決まり、直前に何を表示していたかに依存しない。

これを守るために、評価を 2 種類に分けています。

| 評価 | 式 | 例 |
| --- | --- | --- |
| 純粋評価 | `v(t) = f(project, t)` | キーフレーム、easing、Objects のレポーター、PenFX |
| シミュレーション | `S0 = init()`、`S(k+1) = step(S(k), t0 + k·dt, dt)`、`S(t)` は `k = floor((t − t0)/dt)` と `k + 1` の補間（`t < t0` なら `S0`） | 物理、パーティクル、累積する値 |

描画は `image(N) = render(f, S, t)`、`t = N / fps` です。`render frame` は S を読むだけで書きません。
dt はシミュレーション自身の刻み（hat の「刻み」、既定 120 Hz、1〜1000）で、書き出し fps とは無関係です。
fps を 30 から 60 にしても、同じ時刻の状態は同じです。

`render frame` の中で通常の変数を積分するスクリプト（毎フレーム x を 1 ずつ変えるなど）は、今も以前と同じ動作で、
どのフレームを先に評価したかで結果が変わります。そうした状態はシミュレーションに移してください。

## 時間コンテキスト

時刻は全体の時計ではなく、評価中のスレッドが持つ時間スコープとして渡します。時刻を読むものはすべて
`getEvaluationTime(runtime, util, {reader})`（`scratch-vm/src/lib/object-animation.js`）を通ります。

| reader | 基準の時刻 | 適用するスコープ | 使うもの |
| --- | --- | --- | --- |
| `objects`（既定） | タイムライン時刻（描画は `configuration.evaluationTime`） | すべて（legacy を含む） | Objects のレポーター、描画の時間範囲、ビデオ、シミュレーションの読み取り、剛体の姿勢、`shading.objects.getTime` |
| `timer` | プロジェクトタイマー | legacy 以外 | `operator_easing` |
| `timeline` | タイムライン時刻 | legacy 以外 | PenFX の `u_time` / `u_frame` |

- 非表示の旧時間ブロック（`objects_timeOffset`、`timeRange`、`timeScale`、`timeLoop`、`timeFreeze`、`timeReverse`、
  `timeRemap`、`repeat` の時間オフセット）のスコープは `legacy: true` です。easing と PenFX は legacy スコープを無視するので、
  既存プロジェクトの easing と PenFX の値は変わりません。
- シミュレーションのステップの中では、どの reader もステップのシミュレーション時刻を返します。
- PenFX の `u_time` はブロックが実行された時点で計算し、uniform として frame graph のエフェクトに入ります。
  後で flush されても、そのブロックのスレッドの時刻のままです。
- 新しいスコープ（ローカル時間、時間サンプリング）の中の描画は、すべて `evaluationTime` を持ちます。

## ローカル時間（`objects_localTime`）

`時間 [MODE] (A) (B) で`。中のスタックを `t′` で評価します。入れ子は外側から順に適用します。

| MODE | t′ | B |
| --- | --- | --- |
| offset | `t − A` | 使わない |
| speed | `B + (t − B)·A` | 速度の基準時刻 |
| posterize | `floor(t·A + 1e-9) / A`（A ≤ 0 なら t） | 使わない |
| freeze | `A` | 使わない |
| loop | `B + ((t − B) mod |A|)` | ループの開始時刻 |
| reverse | `|A| − t` | 使わない |
| remap | カーブ文字列 A（`objects_timeRemap` と同じ書式） | 使わない |

## 時間サンプリング（`objects_motionBlur`、`objects_echo`）

中のスタックを複数の時刻で評価し、サンプルごとの独立レイヤーを重み付きで蓄積して 1 枚にします。

- モーションブラー: サンプル i（0〜K−1）の時刻は `t + (phase + angle·(i + 0.5)/K) / 360 / fps`、重みは `1/K`（AE と同じ角度の定義）。
- エコー: i 番目（0 が今）の時刻は `t + i·interval`、不透明度は `decay^i`。合成は「後ろに合成」「前に合成」「加算」「最大」。
- サンプル数は 1〜64。1 サンプルなら C ブロックが無い場合と同じに評価します（画像も一致）。
- **ブラーがかかるのは、C ブロックの中で時刻を読んだ値だけです。** C ブロックの外で計算して変数に入れた値は
  全サンプルで同じになり、ぶれません。AE のレイヤー単位のモーションブラーと同じく、包んだ範囲が対象です。
- 基準サンプル（モーションブラーはシャッター中心に最も近いもの、エコーは i = 0）を最後に評価します。
  音（`sound_playattime`、ビデオ音声）は基準サンプルの評価中だけ鳴り、中で書き換えた変数は基準サンプルの値で終わります。
- 描画コストはサンプル数倍です。

実装: 各サンプルは `legacy: false` のオフセットスコープ付きで `runGroupingBranch` され、frame graph の
`TimeSample` ノードの下の Group（`sample: {weight, operation, order, reference}`）に集まります。
実行時は `executeFrameGraphTimeSample` がサンプルごとに `beginLayer` / `endLayer` で描き、PenFX エンジンの
`accumulateLayer` で蓄積バッファーへ足し、`endAccumulation` で一度だけ合成します。蓄積バッファーは WebGL2 で
`EXT_color_buffer_float` が使えれば RGBA16F、使えなければ RGBA8 です（`getAccumulationPrecision()`）。

## シミュレーション

### ブロック（Simulation カテゴリ）

- `シミュレーション [NAME] を初期化するとき 開始 (START) 秒 刻み (RATE) Hz` と
  `シミュレーション [NAME] を 1 ステップ進めるとき`。どちらも通常の起動経路（緑の旗、`event_renderframe`、
  ブロードキャスト）では起動しない EVENT hat で、シミュレーションランタイムだけが実行します。
  START と RATE は数値リテラルとして読み、レポーターが入っていれば定義を集めるときに 1 回評価します。
- 状態: `状態 [KEY] を … にする / ずつ変える`、`状態 [KEY]`、状態リストの追加・置き換え・取得・長さ・全削除。
  値は数値・文字列・真偽値とそのリストです。書き込みはシミュレーションの中だけで、外では何もせず 1 回だけ警告します。
- 時間: シミュレーション時間（ステップ k の開始時刻 `t0 + k·dt`）、ステップ番号、dt。
- `シード (SEED) の乱数 (FROM) から (TO)`: ステップの中では (名前, シード, ステップ番号, 呼び出し順) から、
  `render frame` では (シード, 評価時刻, そのフレームでの呼び出し順) から決まります。`pick random` もステップの中では
  同じ仕組みの乱数になります。
- 読み取り: `シミュレーション [NAME] の [KEY] 時刻 (TIME)`、リスト版。TIME が空なら評価時刻です。

### ステップの実行

- 各ステップは warp のスレッドで最後まで同期実行します（インタープリター）。待つブロック、描画、PenFX、
  スプライト・カメラ・音・ブロードキャスト、時間ブロックなどを含むシミュレーションは計算せず、診断エラー
  （`simulationError`、コンソール）を出します。途中で yield したら、その計算を中止してエラーにします。
- ステップの中で読む通常の変数とリストは、`initialize` 完了時点の値のコピーです。書き込みはそのステップの中だけで消えます。
- タイマー・マウス・キーは固定値（0 / false）を返します。

### キャッシュ（`scratch-vm/src/lib/simulation/`）

- ライブ状態（最も先まで計算した状態）を前に進めます。
- 0.5 秒ごとのチェックポイント（S0 は常に保持）と、ライブ状態から過去 2 秒分の全ステップのリングバッファー。
- ライブ状態から離れた時刻は、直前のスナップショットを一時カーソルに復元して計算し、その時刻のステップだけを保持します
  （ライブ状態は動かしません）。
- メモリ上限 256 MB（全シミュレーションで分け合う）。超えたら、ライブ状態から離れたステップ、チェックポイント
  （S0 以外）、リングバッファーの古いものの順に、最近使っていないものから捨てます。そのフレームで要求中のステップは捨てません。
- 補間: 数値は線形、`angle` 型は最短弧、`quaternion` 型は球面線形補間、`pose` 型は位置が線形で回転が球面線形補間。
  文字列・真偽値・リストの長さは補間しません。
- ハッシュ: 両 hat 以下のブロック木（opcode・入力・フィールド、ブロック ID は含めない）、呼ぶカスタムブロック定義、
  hat の入力値、参照する通常変数の初期化時の値。ハッシュが変わったシミュレーションだけ計算し直します。
  `render frame` だけの編集ではハッシュは変わりません。

### フレームの処理順

1. フレーム番号から t を決める（`getFrameTime` / `getFrameIndexAtTime`。プレビューも書き出しも同じ）。
2. 各シミュレーションを t（と、前の評価で読まれた時刻）まで計算する。1 tick の予算はプレビュー約 8 ms、
   書き出し約 50 ms。間に合わなければ `waitingForSimulation` で同じフレームを次の tick に回す（時刻は進めない）。
3. staging frame を始めて `event_renderframe` を起動する。
4. 読み取りが未計算の時刻だったら、近い計算済みの値を返し、その時刻を記録する（`requestTime`）。
5. frame graph と保留中の描画が終わったら、記録された時刻があれば staging frame を commit せずに破棄し
   （音声イベントも捨てる）、その時刻を計算してから同じフレームを最初からやり直す。計算済みの時刻は増える一方なので、
   新しい時刻が出なければ必ず commit できます（安全のため 16 回で打ち切って警告）。
6. 記録がなければ commit する。

フレームキャッシュのキーには全シミュレーションのハッシュが入ります。シーク・停止・一時停止・書き出し開始は、
計算中の一時カーソルを捨てますが、計算済みのステップは残します。タイムラインには計算済み範囲のバーが出ます
（`simulationCacheChanged`）。

## ソルバー（プラグイン）

物理などの専門機能はプラグインです。`shading.simulation.registerSolver(solver)` で次を実装したソルバーを登録します。

```js
{
    id,                                   // 'rapier3d' など
    create(settings) -> world,
    beforeStep(world, ctx), step(world, dt),
    snapshot(world) -> Uint8Array, restore(bytes) -> world, dispose(world),
    readPose(world, bodyName) -> {position: {x, y, z}, quaternion: {x, y, z, w}}
}
```

- 初期化のスクリプトで `context.createWorld(solverId, settings)` を呼ぶとワールドができ、状態の一部になります。
- 各ステップは `beforeStep` → ユーザーの step スクリプト → `step(world, dt)` の順に自動で進みます。
- 状態ストアの `handles`（剛体名 → ハンドル）に登録した剛体は、各ステップの後に姿勢を `pose:<名前>`
  （`pose` 型）として記録し、ほかの値と同じく補間されます。`shading.simulation.readPose` はこれを読みます。
- スナップショットにはソルバーの `snapshot` のバイト列が入り、`restore` で一時カーソルが作られます。

公式プラグイン `physics`（`shading-plugins`）は Rapier 0.21.0 の決定的ビルド（`@dimforge/rapier3d-deterministic-compat`）
を同梱した `rapier3d` ソルバーです。単位はステージ座標で、内部では 100 = 1 m、重力の既定は下向き 980。
回転は移動ブロックと同じ（度、X→Y→Z）です。90 度の倍数の回転は正確な sin / cos を使いますが、それ以外の回転の
初期値は `Math.sin` に依存するため、ブラウザー間で完全に一致するとは限りません（Rapier の計算自体は決定的です）。

## 決定性の確かめ方

- `test/unit/util/movie-determinism.test.js`: 先頭からの書き出し・途中からの書き出し・シーク・再生して停止・
  フレーム再利用の 5 通りで、commit された frame graph が一致することを jest で確かめます（`test/helpers/timeline-driver.js`）。
- `node scripts/frame-hash/render-frame-hashes.cjs [project] [frames]`: 同じ 5 通りを headless Chromium と実際の
  renderer で行い、framebuffer の SHA-256 を比べます。`--blur-check` はモーションブラーを個別のサンプル時刻の平均と比べ、
  `--physics-benchmark` は剛体 100 個・10 秒・120 Hz の計算時間と描画時間を測ります。

## 対象外

- 前のフレームの画像を次のフレームが読むフィードバック（不変条件と両立しないため）。残像はエコーで代用します。
- 速度バッファー方式のブラー。サンプル方式で代用します。
- シミュレーションのキャッシュの保存（いつでも計算し直せるため）。重いシミュレーションのベイクは将来の課題です。

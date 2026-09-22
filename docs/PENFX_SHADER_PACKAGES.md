# PenFX shader package 仕様

shading.app の `Looks` カテゴリにある `Import shader` から、PenFX 用の shader package（zip）を読み込めます。Custom Shader（PenFX）がメインのシェーダー機能です。

組み込みPenFXは [`default-shader-package/`](../scratch-vm/src/lib/pen-fx/default-shader-package/) の
manifest・翻訳と [`scratch-render/src/pen-fx/shaders/`](../scratch-render/src/pen-fx/shaders/) のソースを
直接読み込みます。zipの生成・展開は不要です。60個の既定ブロックと27個のfragment programを同期登録し、
必要なプログラムは描画時にコンパイルします。外部のカスタムシェーダーは引き続きzipから読み込めます。

## LUT画像

Shadersの右のLUTタブでPNGを追加・名前変更・削除・書き出しできます。元PNGをプロジェクトに保存し、
コスチュームの解像度やステージサイズは使用しません。プレビューの「100%」と「全体表示」は表示だけを変えます。

PenFXの `LUT [LUT] 適用量: [MIX] %` で追加した画像を選択します。0%は元の色、100%はLUTの色です。
RGBの三線形補間を行い、透明度は維持します。ドロップダウンは名前変更に追従するIDを保存します。
画像の追加・プロジェクト復元時にデコードとGPUへの転送を済ませるので、ブロックはPromiseを返しません。

画像はN×Nのスライスを青軸順に左から右、上から下へ並べたPNGです。各スライスの横軸が赤、縦軸が緑です。
N²×Nの横長画像（例: Tempestの16384×128）、縦長画像、512×512の64³タイルなどを自動判定します。
画像に余白は付けず、透明ピクセルは含めないでください。Nは2〜256、PNGは32MB以下、1プロジェクト32個までです。
GPU用にはスライスを画素単位でタイル配置し直し、縮小しません。PNG書き出しは読み込み時のバイト列を保持します。

## 最小構成

manifest を使わない場合、zip 内のすべての `.glsl` が引数なしのコマンドブロックになります。ファイル名がブロック名になります。

```text
my-shaders.zip
├── soft-glow.glsl
└── distort.glsl
```

この方式では GLSL から uniform の型や初期値を推測しません。ブロックに入力欄を追加する場合は manifest を使ってください。

## 推奨構成

```text
tint-wave.zip
└── tint-wave/
    ├── shading-shader.json
    └── tint-wave.glsl
```

`shading-shader.json` と `.glsl` は zip の直下に置いても構いません。manifest からの `file` は manifest のあるディレクトリを基準に解決されます。ひとつの zip に含められる manifest は 1 個です。

### manifest の例

```json
{
  "format": "shading.app/penfx-shader",
  "version": 1,
  "id": "tint-wave",
  "name": "Tint Wave",
  "blocks": [
    {
      "id": "tint-wave",
      "name": "tint wave",
      "text": "tint wave amount: [AMOUNT] tint: [TINT] mode: [MODE] mix: [MIX] %",
      "file": "tint-wave.glsl",
      "inputs": [
        {
          "id": "AMOUNT",
          "label": "amount",
          "type": "number",
          "defaultValue": 8,
          "uniform": "u_amount"
        },
        {
          "id": "TINT",
          "label": "tint",
          "type": "color",
          "defaultValue": "#6b56d9",
          "uniform": "u_tint"
        },
        {
          "id": "MODE",
          "label": "mode",
          "type": "menu",
          "items": ["soft", "hard"],
          "defaultValue": "soft",
          "uniform": "u_mode"
        },
        {
          "id": "MIX",
          "label": "mix",
          "type": "number",
          "defaultValue": 100,
          "scale": 0.01,
          "uniform": "u_mix"
        }
      ]
    }
  ]
}
```

### package フィールド

| フィールド | 必須 | 内容 |
| --- | --- | --- |
| `format` | はい | `shading.app/penfx-shader` 固定 |
| `version` | はい | single-pass は `1` または `2`。複数 program／PenFX adapter は `2` |
| `id` | はい | 小文字英数字と `-`、最大 48 文字。同じ id を再読込すると置き換え |
| `name` | はい | ツールボックスに表示するパッケージ名 |
| `blocks` | はい | 1〜64 個のブロック定義 |
| `programs` | v2 のみ | PenFX adapter から差し替える fragment program。最大64個 |

### block フィールド

| フィールド | 必須 | 内容 |
| --- | --- | --- |
| `id` | はい | package 内で一意の小文字英数字と `-` |
| `name` | 推奨 | `text` を省略したときの先頭ラベル |
| `text` | 任意 | Scratch ブロックの表示文。入力は `[INPUT_ID]` で配置 |
| `file` | single-pass では必須 | `.glsl` への相対パス。`implementation` block では省略可能 |
| `inputs` | 任意 | 最大 24 個。省略時は引数なし |
| `blockType` | 任意 | `command`（既定）または、`implementation` block の `reporter` |
| `implementation` | v2 のみ | 既存 PenFX pipeline へ接続する adapter 定義 |
| `groupEffectScope` | 任意 | `expanded` の場合、grouping 内でも全画面を入力として effect を実行 |
| `separatorBefore` | 任意 | `true` の場合、このブロックの前に palette separator を表示 |

`text` を書く場合、すべての input id を 1 回以上含め、定義していない placeholder を置かないでください。`text` を省略すると `name label: [ID] ...` の順で自動生成されます。

通常の block は grouping の描画内容だけを `u_image` に渡します。座標を変形したり、grouping の外側へサンプルを広げたりする block は、`groupEffectScope` に `expanded` を指定してください。この場合は grouping 開始前の Pen layer と grouping の描画内容を合成した全画面が入力になります。省略時は従来どおり grouping 内の透明レイヤーだけを入力にします。

たとえば、座標やテクスチャを画面全体の範囲で扱う `zigzag` block は次のように指定します。

```json
{
  "id": "zigzag",
  "groupEffectScope": "expanded"
}
```

### input の型

| `type` | ブロック UI | GLSL uniform | 値 |
| --- | --- | --- | --- |
| `number` | 数値 | `float` | `value * scale + offset` |
| `integer` | 数値 | `int` | 変換後に四捨五入 |
| `angle` | 角度 | `float` | 度数 |
| `color` | カラーピッカー | `vec3` | RGB を 0〜1 に正規化 |
| `boolean` | 真偽値 | `int` | false=`0`、true=`1` |
| `menu` | メニュー | `int` | `items` の 0 始まり index |
| `string` | 文字列 | adapter にそのまま渡す | `implementation` block のみ |
| `costume` | コスチューム | adapter にそのまま渡す | `implementation` block のみ |

`id` は `A-Z`、`0-9`、`_` を使用します。`uniform` は `u_` から始めてください。省略した場合は `AMOUNT` → `u_amount` のように作られます。

`number`、`integer`、`angle` では `scale`（初期値 1）と `offset`（初期値 0）を利用できます。たとえば UI の 0〜100% を GLSL の 0〜1 に渡すには `"scale": 0.01` を指定します。

## schema version 2: program と PenFX adapter

single-pass だけでは、Gaussian blur の複数 pass、depth texture、displacement costume、前 frame、CPU pixel sort、buffer stack
などを同じ意味で表現できません。version 2 では fragment program 群と、既存の同期 PenFX orchestration を結ぶ
`implementation` を宣言できます。

```json
{
  "format": "shading.app/penfx-shader",
  "version": 2,
  "id": "my-gaussian-variant",
  "name": "My Gaussian Variant",
  "programs": [
    {
      "id": "gaussian",
      "file": "gaussian.glsl",
      "bind": "gaussian"
    }
  ],
  "blocks": [
    {
      "id": "gaussian-blur",
      "name": "gaussian blur",
      "text": "gaussian blur type: [TYPE] value: [VALUE] mix: [MIX] %",
      "implementation": {"type": "penfx", "opcode": "gaussianBlur"},
      "inputs": [
        {"id": "TYPE", "label": "type", "type": "menu", "items": ["normal", "horizontal", "vertical"]},
        {"id": "VALUE", "label": "value", "type": "number", "defaultValue": 5},
        {"id": "MIX", "label": "mix", "type": "number", "defaultValue": 100}
      ]
    }
  ]
}
```

`programs[].bind` は既定 PenFX pipeline が公開している program slot に限られます。block の実行時だけ、その package の program
が slot に割り当てられます。他の package や既定ブロックの shader をグローバルに上書きしません。

`implementation.opcode` も既定フォルダが公開する60個の PenFX block opcode に限られます。任意の JavaScript 関数は呼べません。
既定パッケージだけは既存 project と同じ `penfx_contrast` などの block id を保つため、予約済み compatibility `opcode` を持ちます。
外部 package は package 固有の opcode になり、`penfx-builtins` という package id は使用できません。

組み込みシェーダーを変更するときは上記のソースフォルダを直接編集します。

## GLSL の契約

PenFX は WebGL 1 の GLSL ES 1.00 fragment shader を使います。完全な fragment shader を `.glsl` に書いてください。`#version 300 es`、`in` / `out`、`texture()` など WebGL 2 専用構文は使えません。

次の uniform と varying は PenFX が用意します。

```glsl
precision highp float;

varying vec2 v_uv;          // 左下 (0, 0) から右上 (1, 1)
uniform sampler2D u_image;  // 現在の Pen レイヤー
uniform vec2 u_resolution;  // Pen レイヤーの pixel サイズ
uniform float u_time;       // Movie timeline の秒数
uniform int u_frame;        // timeline time × frame rate
```

`u_image`、`u_resolution`、`u_time`、`u_frame` は予約名なので manifest の input には指定できません。`u_time` と `u_frame` は実時間ではなく Movie timeline 由来のため、同じ frame は同じ値になります。

Pen レイヤーの色は premultiplied alpha です。RGB を処理するときは一度 straight color に戻し、出力時に alpha を掛け直すと透明な輪郭が汚れにくくなります。

Objects の `grouping` 内では、`u_image` はグループ専用の透明な描画バッファです。single-pass のカスタムシェーダーの出力 alpha は入力画像の alpha を上限とするため、`alpha = 1` を出力してもグループ外の背景を塗りつぶしません。半透明の入力をそのまま返した場合も alpha を二重に掛けません。変形などで元の描画範囲外へ出力する場合は、この制限に注意してください。

manifest の block に `"groupEffectScope": "expanded"` を指定した場合は、既存の拡張範囲エフェクトと同じく背景を含む画像を入力とし、この alpha 制限を適用しません。グループ外での実行は従来どおり Pen レイヤー全体が対象です。

```glsl
precision highp float;

varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_time;
uniform int u_frame;
uniform float u_amount;
uniform vec3 u_tint;
uniform int u_mode;
uniform float u_mix;

vec3 straightColor(vec4 pixel) {
  return pixel.a > 0.00001 ? pixel.rgb / pixel.a : vec3(0.0);
}

void main() {
  vec4 pixel = texture2D(u_image, v_uv);
  vec3 original = straightColor(pixel);
  float wave = sin((v_uv.y * 24.0) + u_time * 2.0) * u_amount * 0.01;
  float strength = u_mode == 0 ? 0.5 : 1.0;
  vec3 changed = original + (u_tint * wave * strength);
  vec3 result = mix(original, changed, clamp(u_mix, 0.0, 1.0));
  gl_FragColor = vec4(clamp(result, 0.0, 1.0) * pixel.a, pixel.a);
}
```

## zip の作成と読込

サンプルは [`examples/penfx-shader-packages/tint-wave`](../examples/penfx-shader-packages/tint-wave) にあります。そのディレクトリで次を実行すると zip を作れます。

```sh
zip -r tint-wave.zip shading-shader.json tint-wave.glsl
```

shading.app で `Looks` → `Custom Shaders` → `Import shader` を押し、作成した zip を選択します。GLSL は読込時に WebGL で compile/link 検証され、成功した block がその場でツールボックスに追加されます。block の実行は既定 PenFX と同様に同一 VM tick 内で完了し、Promise や待ち時間を Scratch VM に返しません。

読み込んだ manifest と GLSL 本文は `.shade` 内の `penFXShaders` に保存されます。そのため、元の zip がなくてもプロジェクトを開き直せます。常に存在する既定 ZIP は project へ重複保存しません。custom shader を含むプロジェクトは Movie 専用機能として扱われます。

## 制限と安全性

- zip は 10 MB 以下、展開後の shader 全体は 2 MB 以下です。
- 1 shader は 512 KB 以下、shader 全体は 4 MB 以下、1 package は最大64 blocks／64 programs、1 block は最大24 inputs です。
- zip 内の JavaScript、HTML、画像などは実行も読込もしません。
- GLSL は GPU 上で実行されます。複雑すぎる loop や極端に重い sampling は描画停止や GPU reset の原因になります。信頼できない zip は読み込まないでください。
- schema version 1 は single-pass effect です。version 2 の adapter は許可された PenFX pipeline だけを利用でき、package 由来の JavaScript は実行しません。

## よくあるエラー

- `Shader file not found in zip`: manifest の位置を基準にした `file` の相対パスを確認します。
- `text placeholders must match`: `inputs[].id` と `text` 内の `[ID]` を一致させます。
- compile/link error: WebGL 1 構文、uniform の型、`varying vec2 v_uv`、`void main()` を確認します。
- 同名 package が置き換わる: `id` が同じ package は更新として扱われます。別 package にする場合は別の `id` を使います。

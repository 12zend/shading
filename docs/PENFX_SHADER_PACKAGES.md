# PenFX shader package 仕様

shading.app の `Looks` カテゴリにある `Import shader` から、PenFX 用の shader package（zip）を読み込めます。読み込んだパッケージは `My Blocks Shader` とは独立した PenFX の機能です。

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
| `version` | はい | 現在は `1` |
| `id` | はい | 小文字英数字と `-`、最大 48 文字。同じ id を再読込すると置き換え |
| `name` | はい | ツールボックスに表示するパッケージ名 |
| `blocks` | はい | 1〜32 個のブロック定義 |

### block フィールド

| フィールド | 必須 | 内容 |
| --- | --- | --- |
| `id` | はい | package 内で一意の小文字英数字と `-` |
| `name` | 推奨 | `text` を省略したときの先頭ラベル |
| `text` | 任意 | Scratch ブロックの表示文。入力は `[INPUT_ID]` で配置 |
| `file` | はい | `.glsl` への相対パス |
| `inputs` | 任意 | 最大 12 個。省略時は引数なし |

`text` を書く場合、すべての input id を 1 回以上含め、定義していない placeholder を置かないでください。`text` を省略すると `name label: [ID] ...` の順で自動生成されます。

### input の型

| `type` | ブロック UI | GLSL uniform | 値 |
| --- | --- | --- | --- |
| `number` | 数値 | `float` | `value * scale + offset` |
| `integer` | 数値 | `int` | 変換後に四捨五入 |
| `angle` | 角度 | `float` | 度数 |
| `color` | カラーピッカー | `vec3` | RGB を 0〜1 に正規化 |
| `boolean` | 真偽値 | `int` | false=`0`、true=`1` |
| `menu` | メニュー | `int` | `items` の 0 始まり index |

`id` は `A-Z`、`0-9`、`_` を使用します。`uniform` は `u_` から始めてください。省略した場合は `AMOUNT` → `u_amount` のように作られます。

`number`、`integer`、`angle` では `scale`（初期値 1）と `offset`（初期値 0）を利用できます。たとえば UI の 0〜100% を GLSL の 0〜1 に渡すには `"scale": 0.01` を指定します。

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

読み込んだ manifest と GLSL 本文は `.shade` 内の `penFXShaders` に保存されます。そのため、元の zip がなくてもプロジェクトを開き直せます。custom shader を含むプロジェクトは Movie 専用機能として扱われます。

## 制限と安全性

- zip は 10 MB 以下、展開後の shader 全体は 2 MB 以下です。
- 1 shader は 512 KB 以下、1 package は最大 32 blocks、1 block は最大 12 inputs です。
- zip 内の JavaScript、HTML、画像などは実行も読込もしません。
- GLSL は GPU 上で実行されます。複雑すぎる loop や極端に重い sampling は描画停止や GPU reset の原因になります。信頼できない zip は読み込まないでください。
- package は PenFX の single-pass effect です。複数 pass、外部 texture、JavaScript primitive は schema version 1 では扱いません。

## よくあるエラー

- `Shader file not found in zip`: manifest の位置を基準にした `file` の相対パスを確認します。
- `text placeholders must match`: `inputs[].id` と `text` 内の `[ID]` を一致させます。
- compile/link error: WebGL 1 構文、uniform の型、`varying vec2 v_uv`、`void main()` を確認します。
- 同名 package が置き換わる: `id` が同じ package は更新として扱われます。別 package にする場合は別の `id` を使います。

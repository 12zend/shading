# Shading

Shading（[shading.app](https://shading.app)）は、ブロックでアニメーションや映像を作るためのエディターです。
[TurboWarp](https://turbowarp.org/) をフォークしており、Scratch と同じ操作感のまま、タイムライン、動画素材、3D モデル、
カメラ、シェーダーエフェクト、フレーム単位の書き出しといった映像制作向けの機能を追加しています。

Shading は scratch.mit.edu で動くことを最優先にした Scratch MOD ではありません。Shading 専用のブロックや素材を
使ったプロジェクトは `.shade` 形式で保存されます（通常の Scratch プロジェクトは `.sb3` のまま読み書きできます）。

## 主な機能

- **タイムライン**: 決定的な再生とレンダリング。同じ時刻・同じフレームなら同じ画像になります。
- **Objects**: 動画、テキスト、2.5D スプライト、3D モデルを 1 つのシーンに描画・合成
- **3D**: GLB / PMX / FBX / OBJ（MTL）モデルの読み込み、VMD モーション・VPD ポーズ、カメラとライト
- **Looks（PenFX）**: ぼかし、グロー、色調補正などのシェーダーエフェクト。独自の GLSL シェーダーパッケージも読み込めます。
- **プラグイン**: ブロック、エフェクト、エディターのタブなどを zip で追加できます。エフェクトの多くは公式プラグインとして配布しています。
- **書き出し**: MP4、WebM（透過対応）、PNG 連番、1 フレームの PNG、音声のみの WAV
- **デスクトップアプリ**: macOS / Windows 用の Electron アプリ

## ドキュメント

| 文書 | 内容 |
| --- | --- |
| [PRODUCT.md](PRODUCT.md) | プロダクトの目的と方針、互換性のルール |
| [AGENTS.md](AGENTS.md) | ブロック実装の規則（コーディングエージェントと開発者向け） |
| [docs/SHADING_SPECIFICATION.md](docs/SHADING_SPECIFICATION.md) | 現行機能の仕様（ブロック、PenFX、タイムライン、3D、書き出し、プロジェクト形式） |
| [docs/PLUGINS.md](docs/PLUGINS.md) | プラグインの作り方と API |
| [docs/PLUGIN_SYSTEM_SPECIFICATION.md](docs/PLUGIN_SYSTEM_SPECIFICATION.md) | プラグインシステムの内部実装 |
| [docs/PENFX_SHADER_PACKAGES.md](docs/PENFX_SHADER_PACKAGES.md) | PenFX シェーダーパッケージの形式 |
| [docs/MOVIE_RENDERER_MIGRATION.md](docs/MOVIE_RENDERER_MIGRATION.md) ほか | レンダラーと描画性能に関するメモ |

## 開発

Node.js 24（[.nvmrc](.nvmrc)）と Git が必要です。`scratch-vm` と `scratch-render` はこのリポジトリ内にあり、
`file:` 依存として読み込まれます。

```bash
npm ci
npm start
```

[http://localhost:8601/](http://localhost:8601/) でエディターが開きます。

### 公式プラグイン

エフェクトなどの公式プラグインは別リポジトリ [12zend/shading-plugins](https://github.com/12zend/shading-plugins) にあります。
`npm start` と `npm run build` は、その前に `npm run build:plugins` で shading-plugins を一時フォルダーに clone し、
署名済みの zip と一覧を `build/official-plugins/` に作ります。起動したエディターの `/install` から、公式プラグインを
まとめてインストールできます。

手元のチェックアウトを使う場合は `SHADING_PLUGINS_DIR` を指定します。

```bash
SHADING_PLUGINS_DIR=../shading-plugins npm start
```

### ビルドとデプロイ

| コマンド | 内容 |
| --- | --- |
| `npm run build` | `build/` に本番ビルドを出力（公式プラグインの生成を含む） |
| `npm run build:cloudflare` | Cloudflare 向けの本番ビルド |
| `npm run start:cloudflare` | Cloudflare Workers（wrangler）でローカル実行 |
| `npm run deploy:cloudflare` | Cloudflare へデプロイ（`cloudflare/wrangler.jsonc`） |

### テスト

```bash
npm run test:lint
npm run test:unit
npx jest test/unit/plugins test/unit/util
```

`npm run test:unit` は addons のテストのみを実行します。プラグインとエフェクトのテストは、隣に置いた
shading-plugins のチェックアウト（または `SHADING_PLUGINS_DIR`）から公式プラグインを読み込みます。

## Shading Desktop

デスクトップアプリはこのリポジトリにあり、Web 版と同じ `build` の出力を使います。Electron はその出力を固定の
localhost オリジンから配信するため、ブラウザ版のプロジェクトファイル、IndexedDB のデータ、プロジェクト形式と互換性があります。
共同編集はどちらのアプリでも有効になっていません。

```bash
npm ci
npm run build:desktop
npm run electron:start
```

開発時は `npm run electron:dev` で webpack-dev-server と Electron を一緒に起動できます。

`npm run package:desktop` で macOS と Windows のパッケージを作成します。出力先は `release/` で、macOS の `.dmg` / `.zip`、
Windows の NSIS インストーラー `.exe`、ポータブル版 `.exe` が含まれます。展開済みのアプリフォルダーが必要な場合は
`npm run package:desktop:dir` を使います。

プロジェクトファイルは、アプリ内での選択、コマンドライン引数、OS のファイル関連付けのいずれでも開けます。保存は一時ファイルに
書いてから置き換えるため途中で壊れず、未保存のプロジェクトを閉じるときは確認します。

macOS では、起動前に Chromium の ANGLE Metal バックエンドを選択します。Scratch レンダラー、PenFX、Three.js のモデル描画が
使う WebGL の経路はすべてこれで動きます。`--use-gl`、`--use-angle`、`--disable-gpu` を明示した場合はそちらを優先します。

## License

TurboWarp's modifications to Scratch are licensed under the GNU General Public License v3.0. See LICENSE or https://www.gnu.org/licenses/ for details.

The following is the original license for scratch-gui, which we are required to retain. This is NOT the license of this project.

```
Copyright (c) 2016, Massachusetts Institute of Technology
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

src/lib/default-project/dango.svg is based on [Twemoji](https://twemoji.twitter.com/) and is licensed under CC BY 4.0 https://creativecommons.org/licenses/by/4.0/

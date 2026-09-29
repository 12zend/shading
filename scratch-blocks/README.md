# TurboWarp/scratch-blocks

## Playgrounds

 - **Vertical blocks**: https://turbowarp.github.io/scratch-blocks/tests/vertical_playground_compressed.html

## Local development

Requires Node.js (16 or later), Python (2 or 3), and Java. It is known to work in these environments but should work in many others:

 - Windows 10, Python 3.12.1 (Microsoft Store), Node.js 20.10.0 (nodejs.org installer), Java 11 (Temurin-11.0.21+9)
 - macOS 14.2.1, Python 3.11.6 (Apple), Node.js 20.10.0 (installed manually), Java 21 (Temurin-21.0.1+12)
 - Ubuntu 22.04, Python 3.10.12 (python3 package), Node.js 20.10.0 (installed manually), Java 11 (openjdk-11-jre package)

Install dependencies:

```sh
npm ci
```

Open tests/vertical_playground.html in a browser for development. You don't need to rebuild compressed versions for most changes. Open tests/vertical_playground_compressed.html instead to test if the compressed versions built properly.

To re-build compressed versions, run:

```sh
npm run prepublish
```

scratch-gui development server must be restarted to update linked scratch-blocks.

<!--
#### Scratch Blocks is a library for building creative computing interfaces.
[![CircleCI](https://dl.circleci.com/status-badge/img/gh/LLK/scratch-blocks/tree/develop.svg?style=shield)](https://dl.circleci.com/status-badge/redirect/gh/LLK/scratch-blocks/tree/develop)

![](https://cloud.githubusercontent.com/assets/747641/15227351/c37c09da-1854-11e6-8dc7-9a298f2b1f01.jpg)

<!--
## Introduction
Scratch Blocks is a fork of Google's [Blockly](https://github.com/google/blockly) project that provides a design specification and codebase for building creative computing interfaces. Together with the [Scratch Virtual Machine (VM)](https://github.com/LLK/scratch-vm) this codebase allows for the rapid design and development of visual programming interfaces. Unlike [Blockly](https://github.com/google/blockly), Scratch Blocks does not use [code generators](https://developers.google.com/blockly/guides/configure/web/code-generators), but rather leverages the [Scratch Virtual Machine](https://github.com/LLK/scratch-vm) to create highly dynamic, interactive programming environments.

*This project is in active development and should be considered a "developer preview" at this time.*

## Two Types of Blocks
![](https://cloud.githubusercontent.com/assets/747641/15255731/dad4d028-190b-11e6-9c16-8df7445adc96.png)

Scratch Blocks brings together two different programming "grammars" that the Scratch Team has designed and continued to refine over the past decade. The standard [Scratch](https://scratch.mit.edu) grammar uses blocks that snap together vertically, much like LEGO bricks. For our [ScratchJr](https://scratchjr.org) software, intended for younger children, we developed blocks that are labelled with icons rather than words, and snap together horizontally rather than vertically. We have found that the horizontal grammar is not only friendlier for beginning programmers but also better suited for devices with small screens.

## Documentation
The "getting started" guide including [FAQ](https://scratch.mit.edu/developers#faq) and [design documentation](https://github.com/LLK/scratch-blocks/wiki/Design) can be found in the [wiki](https://github.com/LLK/scratch-blocks/wiki).

## Donate
We provide [Scratch](https://scratch.mit.edu) free of charge, and want to keep it that way! Please consider making a [donation](https://secure.donationpay.org/scratchfoundation/) to support our continued engineering, design, community, and resource development efforts. Donations of any size are appreciated. Thank you!
-->

# 枠（レイアウトボックス）

一太郎2026で本文と独立した文字の入れ物は「レイアウトボックス」（レイアウト枠）です。公開マクロ `LayoutboxCreateMode`・`LayoutboxStart`・`LayoutboxEnd`・`CreateLayoutbox` で作成し、`FrameName` で名前を付け、`SelectFrameName` で選び直して読み戻します。実装は [frames.mjs](../src/frames.mjs) です。

## 外部要求API

`paragraphs` 文書の `frames`（`layout-frame`）に、1ページ目の固定枠を1..3個指定します。[公開例](../examples/agent/18-layout-frames.json)のように、各枠は名前、用紙左上からの位置・大きさ（mm）、短い枠内文字、枠内の縦書き・横書き、枠飾りの有無を持ちます。枠どうしは7mm以上離します。正確な値域は[公開能力表](generated/sample-capabilities.md)を参照してください。

## 実装上の知見（実機プローブ）

- `CreateLayoutbox` の直後は枠内の編集中です。そのまま `Insert` で枠内文字を入れ、`LayoutboxEditMode(2)` で編集を終えてから `SelectFrame()` で選択し、`FrameName` を呼びます。編集中に `FrameName` を呼ぶと名前は付かず、`LayoutboxEditMode(1)` はエラーになります（[プローブ1](../tmp/probe-frame-v1.mjs)、[プローブ2](../tmp/probe-frame-v2.mjs)）。
- 枠の辺はレイアウトのグリッドへ吸着します。基準文書（10.5pt、字間1%、行間60%）で実測した差は最大1.25mm（例：左端50→48.75mm、高さ30→31.08mm）でした。要求値は2mm以内であることを確認し、実測値は保存前と再読込後で完全一致することを確認します。
- 枠を置くと、`GetString` が本文の一部に空白を1つ余分に返します。`GetCharacter` で1文字ずつ読むと本文は変わっていません（[プローブ3](../tmp/probe-frame-v3.mjs)）。そのため枠の試料では本文を空白なしの段落に限り、全文字を `GetCharacter` で照合し、`GetString` の比較では空白を除きます。

## 検証内容と限界

保存前と再読込後に、各枠について次を照合します。

- 名前（`GetFrameName`）、ページ、位置・大きさ（`GetFramePosition`）
- 文字組（`GetFrameStyleLayout`）、基準位置が固定であること（`GetFrameAlignment`）、枠飾りの有無（`GetFrameDecoration`）
- 枠内文字（編集モードでの `GetString`）
- 本文の全文字（`GetCharacter`）

文書内の枠の総数、枠内の文字書式、枠のフォント、回り込み、背景、枠飾りの詳細は検証していません。行・文字に付く枠、2ページ目以降、他の構造要素との組合せは未対応です。

## 実機確認

内部Recipe [layout-frames.json](../examples/layout-frames.json) の4試料（枠なしの基準、1枠、縦書き＋枠飾り、3枠）がverified（[run](../runs/2026-10-14T02-30-13-122Z-630f932b/index.html)）。外部要求の3要求・6試料もverified（[結果](../tmp/public-frames-20261014/execution-results.json)）。

最初の内部実行（[run](../runs/2026-10-14T02-25-57-266Z-ef7ee9c5/index.html)）は、枠自体の検証は通ったものの、`GetString` の余分な空白で本文が不一致となりsavedで停止しました。上記の文字単位照合へ変更して再実行しています。

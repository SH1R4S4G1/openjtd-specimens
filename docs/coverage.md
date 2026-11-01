# 拡張設定と組合せ生成（v0.3）

`samples` の `features` に、文書スタイルの追加設定を指定できます。`settings: {}` は引き続き必要です。各試料は同じ基準JTDから独立して作り、指定した設定の一致と、全観測項目の保存前・再読込後の一致を検査します。

```json
{"id":"font-12","settings":{},"features":{"font":{"size":12}}}
```

| グループ | 指定できるキー |
|---|---|
| `font` | `japaneseName`, `japaneseStyle`, `westernName`, `westernStyle`, `digitFont`, `size`, `sizeUnit`, `scaleY`, `scaleX` |
| `paper` | `name` |
| `columns` | `gap`, `rule`, `twoEnabled`, `twoGap`, `twoSpacing`, `twoChars`, `threeEnabled`, `threeGap`, `threeSpacing`, `threeChars`, `gapUnit`, `spacingUnit` |
| `layout` | `orientation` |

フォント名・スタイル・用紙名は、インストール環境で有効な名前を使用します。欧文フォントは `10` で和文フォント、数字フォントは `10` が和文・`11` が欧文です。サイズの入力ガードは5～50、拡大率は50～200％。サイズ単位は1=mm、2=inch、3=pt。文字組方向は1=横書き、2=縦書きです。実際に受け入れられた値はgetterで確認します。

段組の有効設定は0/1、段間罫線は0=なし・1～15=線種、段間単位は1=mm・2=inch、字間単位は1=mm・2=inch・3=pt・100=％です。二段組・三段組が未設定のとき、関連するgetterの空値は `null` として記録します。`null` を要求値として指定することはできません。これは文書スタイルの段組設定であり、本文に段組区間を挿入する機能ではありません。

実機では有効フラグだけでは反映されませんでした。二段組は `{"twoEnabled":1,"twoGap":7,"twoChars":19}`、三段組は `{"threeEnabled":1,"threeGap":7,"threeChars":12}` で保存前後の一致を確認しました。字間は一太郎の調整値を読み戻します。字数と字間を両方指定すると両立しない場合があり、要求不一致として停止します。

用紙、フォント、段組、文字組、8数値の順に適用します。サイズや方向の変更に連動して、余白・字間・行間なども変化することがあります。「一項目を要求した」ことと「観測値が一項目だけ変化した」ことは区別してください。基準のフォント・用紙等は新規文書の環境設定を継承し、全試料で記録します。拡張設定を固定した基準テンプレートの指定は未対応です。

## 値の一覧からレシピを作る

```powershell
node bin/ichitaro-coverage.mjs examples/coverage-font.json tmp/font-recipe.json
node bin/ichitaro.mjs plan tmp/font-recipe.json
node bin/ichitaro-macro.mjs tmp/font-recipe.json runs
```

生成コマンドは一太郎を操作せず、確認可能な通常のレシピJSONを出力します。既存ファイルは上書きしません。

- `mode: "one-factor"`: 各軸の値を、一項目ずつ独立して指定。
- `mode: "cartesian"`: 各軸の全組合せを指定。
- `axes[].field`: `chars` 等の8数値、または `features.font.size` 等の拡張キー。
- `repeats`: 1～20。各反復には、基準JTDを変更せず別名保存する `control-rN` も入る。
- `layoutPriority`: 変種全体の優先モード。字間・行間の実験では必要に応じて `spacing` を指定。

基準・対照も含め最大200試料です。展開前に件数を検査し、上限超過、重複軸・値、未知のキー、無効な設定を拒否します。実行順は固定で、ランダム化はしません。反復間でも前の試料の編集は継承しません。ファイルのハッシュが異なるだけで設定差があるとは断定できないため、対照試料を使って保存時の変動を調べてください。

## 証跡と実装上の注意

拡張getterは23項目です（既存の方向値と重複する1項目を含む）。マクロ経路では、拡張設定を要求しない試料もこれらを保存前後で記録します。スクリーンショットの取得は追加していません。

正常完了した専用 `/M/` インスタンスは、試料を閉じて完了通知を保存してから `Application.Quit(3)` で終了します。生成マクロを手動編集中のインスタンスで実行しないでください。例外時は診断のため終了させず、タイムアウト時は自動再試行しません。既定の待機上限は120秒です。

実機と資料で差があった点：用紙getterは用紙名を持つ配列、段組getterの字数キーは「二段組文字数」「三段組文字数」でした。配布資料は参照のみで、DLL解析やJTDバイナリ改変は行っていません。

この文書の実機結果はv0.3の記録です。当時未対応だった罫線表は後続版で[限定実装](keisen-recipes.md)されています。段落属性、脚注、画像、本文の段組区間、ヘッダー・フッター、一般的な表編集は未対応です。現行の能力は [capabilities.json](../capabilities.json) を参照してください。各キーの全値域・全組合せの動作を保証するものではありません。

## 実機確認（2026年10月10日 JST）

| レシピ | run ID（UTC） | 試料数 | 全体時間 | 結果 |
|---|---|---:|---:|---|
| `examples/extended-style.json` | `2026-10-09T17-24-09-524Z-a5704045` | 11 | 36.997秒 | 全件verified、整合性検査成功 |
| `examples/coverage-font.json` から生成 | `2026-10-09T17-25-03-918Z-ffc6a8b0` | 11 | 33.627秒 | 全件verified、整合性検査成功 |

拡張設定の実機確認は、サイズ12pt、縦横拡大率120％、数字フォント、共通段間・罫線、二段組・三段組設定、縦書き、A4横方向です。組合せはサイズ10.5/12と横拡大率100/120の4条件を2反復し、基準1件と対照2件を加えました。各速度はこの環境での単回計測です。フォント名変更・別の単位・他の罫線種類等は入力と照合経路を実装済みですが、この実機確認には含めていません。

公開マクロヘルプの参照先：`DocumentStyleFont` / `GetDocumentStyleFont`（`t26m3px0` / `t26m1ppw`）、`DocumentStylePaper` / `GetDocumentStylePaper`（`t26m5icy` / `t26m75pu`）、`DocumentStyleColumns` / `GetDocumentStyleColumns`（`t26m6xdf` / `t26m0jub`）、`Application.Quit`（`t26o49nw`）。添付資料そのものは配布物に含めません。

文書全体の本文段組は後続の[構造試験](maintainer/document-structure-development.md)で別途扱う。文書スタイルの段組設定だけで本文の段数を検証したことにはならない。

## 2026-10-14 用紙と文字組の外部公開

本文文書に `page`（`document-paper`：A3/A4/A5/B4/B5の単票、縦横）と `writingMode`（`document-layout`：横書き／縦書き）を公開した。用紙名は内部の「<用紙> 単票・縦方向／横方向」へ変換する。10種類の用紙名はすべて受け付けられ、保存・再読込後も保持されることを[プローブrun](../runs/2026-10-14T02-13-25-339Z-4537fae5/index.html)で確認した。

用紙を変えると、一太郎は字数・行数・字間・行間・余白を用紙に合わせて調整する（A5縦では左右余白が0になった）。値を明示したい場合は `style` と組み合わせる。当初は用紙→余白→字数行数の順に1回だけ設定していたため、A5で余白20mmを要求すると、字数がまだ40のまま余白が1mmへ補正された（[1回目](../runs/2026-10-14T02-15-26-364Z-7c604746/index.html)、字数25に直した[2回目](../runs/2026-10-14T02-16-01-028Z-1ad1f582/index.html)とも、検証器が不一致を検出しsavedで停止）。余白と字数行数の設定を、値が異なる場合だけ再適用する2巡目付きに変更した。既に要求どおりなら呼出は発生しない。

[公開例](../examples/agent/17-paper-and-writing.json)の6要求・12試料が実機でverified（[結果](../tmp/public-paper-20261014-r3/execution-results.json)）。設定順序の変更後、style-matrix 8試料（[run](../runs/2026-10-14T02-17-37-965Z-a2d99bf1/index.html)）と公開例10・11（[結果](../tmp/regression-style-20261014/execution-results.json)、[結果](../tmp/regression-defaults-20261014/execution-results.json)）も再実行し、退行がないことを確認した。

## 2026-10-14 文書スタイルの段組書式の外部公開

`columnFormat`（`document-columns`）を本文文書と `paragraphs` 文書に公開した。共通段間（mm）、段間罫線（0..15）、2段組・3段組それぞれの段間と字数を指定する。v0.3の知見どおり有効フラグだけでは反映されないため、2段組・3段組の書式は段間と字数を必須とした。字間は一太郎が字数から計算するので要求値にせず、読み戻した値を記録する。

本文を段組にする `paragraphs` 文書の `columns`（`document-columns-body`）とは別物である。`columnFormat` は文書スタイルに保存される書式で、getterで厳密に照合する。`columns` は本文に適用した段数で、各文字の `GetColumns` で照合する。段組区間に適用された段間・字数を読み戻すgetterはないため、両方を指定しても「本文の段組がその書式で描画されたこと」は検証範囲外である。

[公開例](../examples/agent/21-column-format.json)の4要求・8試料が実機でverified（[結果](../tmp/public-column-format-20261014/execution-results.json)）。

## 2026-10-14 ページ番号の設定

文書スタイルのページ番号（`DocumentStylePage` / `GetDocumentStylePage`）を拡張設定の `page` グループとして追加し、`pageNumber`（`document-page`）として公開した。位置（付けない・左下・中央下・右下・左上・中央上・右上）、余白（mm）、開始番号、飾り文字列を指定する。ヘッダー／フッターの文字列とは別の設定で、同じ文書に両方を置ける。

実機の既定値は中央下・18mm・開始番号1・飾り「- ? -」だった（[プローブrun](../runs/2026-10-14T12-35-33-989Z-028e607f/index.html)）。飾り文字列は指定した「- # -」がそのまま保存・再読込される。印字されるページ番号の文字列を読むgetterはないため、番号の置き換え方や実際の表示は検証していない。縦書き時の漢数字とページ振り分けは未公開。

[公開例](../examples/agent/24-page-number.json)の4要求・8試料（右下・開始5、中央上・余白・飾り、付けない、フッターとの共存）が実機でverified（[結果](../tmp/public-page-number-20261014/execution-results.json)）。全試料の読み戻しにページ番号設定が加わったため、公開例01（[結果](../tmp/regression-minimal-20261014/execution-results.json)）と19（[結果](../tmp/regression-combinations-20261014/execution-results.json)）を再実行し、退行がないことを確認した。
